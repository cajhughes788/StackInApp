// /functions/src/services/taxEstimateService.ts
// Gathers the year's records for the self-employed tax estimate and runs
// it. The math and the "is this safe to show" rules live in
// @shared/estimatedTax; this file only reads data.
import { DateTime } from "luxon";
import { db } from "../admin";
import { listActiveWorkspaces, type ActiveWorkspace } from "../lib/userWorkspaces";
import { listProfitLossStatements } from "./profitLossService";
import { EntrySchema } from "@shared/schemas/entry";
import type { ProfitLossStatement } from "@shared/schemas/profitLoss";
import {
    TaxEstimateProfileSchema,
    TaxPaymentSchema,
    emptyTaxEstimateProfile,
    rollTaxEstimateProfileToYear,
    type TaxEstimateProfile,
    type TaxEstimateProfilePatch,
    type TaxPayment,
    type TaxPaymentInput,
} from "@shared/schemas/taxEstimateProfile";
import { NotFoundError } from "../lib/httpErrors";
import { getEstimatedTaxYear } from "@shared/estimatedTax/years";
import { assessTaxDataHealth } from "@shared/estimatedTax/dataHealth";
import { computeQuarterlyEstimate, type MonthFigures } from "@shared/estimatedTax/quarterly";
import { taxYearForDate, type TaxEstimateResponse } from "@shared/estimatedTax/response";
import { round2 } from "@shared/estimatedTax/calculate";

// Same zone the P&L months use.
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

function profileRef(uid: string) {
    return db.doc(`users/${uid}/taxEstimate/profile`);
}

function paymentsCol(uid: string) {
    return db.collection(`users/${uid}/taxPayments`);
}

function currentTaxYear(): number {
    return taxYearForDate(DateTime.now().setZone(DEFAULT_TIME_ZONE).toISODate()!);
}

export async function listTaxPayments(uid: string, taxYear: number): Promise<TaxPayment[]> {
    const snap = await paymentsCol(uid).where("taxYear", "==", taxYear).get();
    return snap.docs
        .flatMap((doc) => {
            const parsed = TaxPaymentSchema.safeParse({ id: doc.id, ...doc.data() });
            return parsed.success ? [parsed.data] : [];
        })
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt));
}

// A payment counts toward the year it's for: payments made Jan 1–15 are
// usually the previous year's Q4.
export async function saveTaxPayment(uid: string, input: TaxPaymentInput): Promise<TaxPayment> {
    const taxYear = currentTaxYear();
    const ref = input.id ? paymentsCol(uid).doc(input.id) : paymentsCol(uid).doc();
    let createdAt = new Date().toISOString();
    let source: TaxPayment["source"] = "manual";
    if (input.id) {
        const existing = await ref.get();
        if (!existing.exists) throw new NotFoundError("Payment not found");
        createdAt = String(existing.data()?.createdAt ?? createdAt);
        source = existing.data()?.source === "carried_over" ? "carried_over" : "manual";
    }
    const payment = TaxPaymentSchema.parse({ id: ref.id, taxYear, amount: input.amount, paidOn: input.paidOn, source, createdAt });
    const { id: _id, ...data } = payment;
    await ref.set(data);
    return payment;
}

export async function deleteTaxPayment(uid: string, paymentId: string): Promise<void> {
    const ref = paymentsCol(uid).doc(paymentId);
    if (!(await ref.get()).exists) throw new NotFoundError("Payment not found");
    await ref.delete();
}

// The old single "paid so far" answer becomes one carried-over payment, so
// nobody loses what they entered. Deterministic id: safe to run twice.
async function carryOverLegacyPayments(uid: string, profile: TaxEstimateProfile): Promise<TaxEstimateProfile> {
    if (!(profile.estimatedPaymentsMade > 0)) return profile;
    const paidOn = (profile.updatedAt ?? new Date().toISOString()).slice(0, 10);
    const id = `carried-over-${profile.taxYear}`;
    await paymentsCol(uid).doc(id).set({
        taxYear: profile.taxYear,
        amount: profile.estimatedPaymentsMade,
        paidOn: paidOn.startsWith(`${profile.taxYear}-`) ? paidOn : `${profile.taxYear}-12-31`,
        source: "carried_over",
        createdAt: new Date().toISOString(),
    });
    const next = { ...profile, estimatedPaymentsMade: 0 };
    await profileRef(uid).set(next, { merge: true });
    return next;
}

async function loadProfile(uid: string, taxYear: number): Promise<TaxEstimateProfile> {
    const snap = await profileRef(uid).get();
    if (!snap.exists) return emptyTaxEstimateProfile(taxYear);
    const parsed = TaxEstimateProfileSchema.safeParse(snap.data());
    if (!parsed.success) return emptyTaxEstimateProfile(taxYear);
    return rollTaxEstimateProfileToYear(parsed.data, taxYear);
}

export async function saveTaxEstimateProfile(uid: string, patch: TaxEstimateProfilePatch): Promise<TaxEstimateProfile> {
    const taxYear = currentTaxYear();
    const current = await loadProfile(uid, taxYear);
    const next = TaxEstimateProfileSchema.parse({ ...current, ...patch, taxYear, updatedAt: new Date().toISOString() });
    await profileRef(uid).set(next);
    return next;
}

type BusinessYear = {
    months: Map<string, number>;
    tips: Map<string, number>;
    uncategorizedExpenseCount: number;
    firstRecordDate: string | null;
    pendingBankReviewCount: number;
    pendingImportCount: number;
};

function earliestDate(statement: ProfitLossStatement): string | null {
    const dates = [
        ...statement.income.categories.flatMap((category) => category.items.map((item) => item.date)),
        ...statement.income.refundItems.map((item) => item.date),
        ...statement.expenses.byCategory.flatMap((category) => category.items.map((item) => item.date)),
    ].filter(Boolean);
    return dates.length ? dates.sort()[0] : null;
}

async function loadBusinessYear(workspace: ActiveWorkspace, uid: string, taxYear: number): Promise<BusinessYear> {
    const [statements, pendingBank, importBatches] = await Promise.all([
        listProfitLossStatements(workspace.id, uid, "month"),
        db.collection(`workspaces/${workspace.id}/plaidPendingTransactions`).where("status", "==", "pending").count().get(),
        db.collection(`workspaces/${workspace.id}/importBatches`).get(),
    ]);
    const months = new Map<string, number>();
    const tips = new Map<string, number>();
    let uncategorizedExpenseCount = 0;
    let firstRecordDate: string | null = null;
    for (const statement of statements) {
        if (!statement.periodKey.startsWith(`${taxYear}-`)) continue;
        months.set(statement.periodKey, (months.get(statement.periodKey) ?? 0) + statement.netProfit);
        tips.set(statement.periodKey, (tips.get(statement.periodKey) ?? 0) + statement.income.tips);
        uncategorizedExpenseCount += statement.expenses.byCategory
            .filter((category) => category.category === "Uncategorized")
            .reduce((sum, category) => sum + category.count, 0);
        const earliest = earliestDate(statement);
        if (earliest && (!firstRecordDate || earliest < firstRecordDate)) firstRecordDate = earliest;
    }
    const pendingImportCount = importBatches.docs.reduce((sum, doc) => {
        const data = doc.data();
        if (data.status === "archived" || data.status === "completed") return sum;
        return sum + (Number(data.pendingCount) || 0);
    }, 0);
    return {
        months,
        tips,
        uncategorizedExpenseCount,
        firstRecordDate,
        pendingBankReviewCount: pendingBank.data().count,
        pendingImportCount,
    };
}

// The state on a W-2 workspace's paycheck tax profile, if any.
async function suggestStateCode(w2Workspaces: ActiveWorkspace[]): Promise<string | null> {
    for (const workspace of w2Workspaces) {
        const state = (await db.doc(`workspaces/${workspace.id}/taxProfile/current`).get()).data()?.state;
        if (typeof state === "string" && /^[A-Za-z]{2}$/.test(state.trim())) return state.trim().toUpperCase();
    }
    return null;
}

// W-2 gross pay by month (the W-2 Home total's taxable amount).
async function loadW2Year(workspace: ActiveWorkspace, taxYear: number): Promise<Map<string, number>> {
    const snap = await db
        .collection(`workspaces/${workspace.id}/entries`)
        .where("date", ">=", `${taxYear}-01-01`)
        .where("date", "<=", `${taxYear}-12-31`)
        .get();
    const months = new Map<string, number>();
    for (const doc of snap.docs) {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success || parsed.data.workspace !== "w2") continue;
        const month = parsed.data.date.slice(0, 7);
        months.set(month, (months.get(month) ?? 0) + Number(parsed.data.totals?.taxableTotal ?? 0));
    }
    return months;
}

export async function getTaxEstimate(uid: string, now = DateTime.now().setZone(DEFAULT_TIME_ZONE)): Promise<TaxEstimateResponse> {
    const today = now.toISODate()!;
    const taxYear = taxYearForDate(today);
    const workspaces = await listActiveWorkspaces(uid);
    const businesses = workspaces.filter((w) => w.type === "independent");
    if (businesses.length === 0) return { eligible: false, reason: "no_business_workspace" };

    const w2Workspaces = workspaces.filter((w) => w.type === "w2");
    const [loadedProfile, businessYears, w2Years] = await Promise.all([
        loadProfile(uid, taxYear),
        Promise.all(businesses.map((w) => loadBusinessYear(w, uid, taxYear))),
        Promise.all(w2Workspaces.map((w) => loadW2Year(w, taxYear))),
    ]);
    const suggestedStateCode = loadedProfile.stateCode ? null : await suggestStateCode(w2Workspaces);

    const profile = await carryOverLegacyPayments(uid, loadedProfile);
    const payments = await listTaxPayments(uid, taxYear);
    const paymentsTotal = round2(payments.reduce((sum, p) => sum + p.amount, 0));

    const monthKeys = Array.from({ length: 12 }, (_, i) => `${taxYear}-${String(i + 1).padStart(2, "0")}`);
    const months: MonthFigures[] = monthKeys.map((month) => ({
        month,
        profit: round2(businessYears.reduce((sum, b) => sum + (b.months.get(month) ?? 0), 0)),
        w2Wages: round2(w2Years.reduce((sum, w) => sum + (w.get(month) ?? 0), 0)),
        tips: round2(businessYears.reduce((sum, b) => sum + (b.tips.get(month) ?? 0), 0)),
    }));
    const firstRecordDate = businessYears
        .map((b) => b.firstRecordDate)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;

    const table = getEstimatedTaxYear(taxYear);
    const health = assessTaxDataHealth({
        today,
        taxYear,
        hasTaxYearTable: table != null,
        profile: {
            filingStatus: profile.filingStatus,
            qualifyingChildren: profile.qualifyingChildren,
            businessStartDate: profile.businessStartDate,
            situation: {
                spouseHasIncome: profile.spouseHasIncome,
                investmentOrRentalIncome: profile.investmentOrRentalIncome,
                itemizesDeductions: profile.itemizesDeductions,
            },
            priorYearTax: profile.priorYearTax,
        },
        firstRecordDate,
        uncategorizedExpenseCount: businessYears.reduce((sum, b) => sum + b.uncategorizedExpenseCount, 0),
        pendingBankReviewCount: businessYears.reduce((sum, b) => sum + b.pendingBankReviewCount, 0),
        pendingImportCount: businessYears.reduce((sum, b) => sum + b.pendingImportCount, 0),
    });

    const quarterly =
        table && profile.filingStatus && (health.canShowEstimate || health.canShowSafeHarbor)
            ? computeQuarterlyEstimate(table, {
                today,
                filingStatus: profile.filingStatus,
                qualifyingChildren: profile.qualifyingChildren ?? 0,
                months,
                priorYearTax: profile.priorYearTax,
                priorYearAgi: profile.priorYearAgi,
                ytdWithholding: profile.ytdWithholding,
                withholdingAsOf: profile.withholdingAsOf,
                estimatedPaymentsMade: paymentsTotal,
                occupationCode: profile.occupationCode,
                stateCode: profile.stateCode,
            })
            : null;

    return {
        eligible: true,
        taxYear,
        profile,
        health,
        quarterly,
        payments,
        suggestedStateCode,
        ytdProfit: round2(months.filter((m) => m.month <= today.slice(0, 7)).reduce((sum, m) => sum + m.profit, 0)),
        ytdTips: round2(months.filter((m) => m.month <= today.slice(0, 7)).reduce((sum, m) => sum + (m.tips ?? 0), 0)),
        generatedAt: new Date().toISOString(),
    };
}
