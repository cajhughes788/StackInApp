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
import { getIndependentCategorizedIncomeTotals } from "@shared/independentIncome";

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
    reversedExpenseCount: number;
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
    const [statements, pendingBank, importBatches, refundSnap, reversedSnap] = await Promise.all([
        listProfitLossStatements(workspace.id, uid, "month"),
        db.collection(`workspaces/${workspace.id}/plaidPendingTransactions`).where("status", "==", "pending").count().get(),
        db.collection(`workspaces/${workspace.id}/importBatches`).get(),
        db.collection(`workspaces/${workspace.id}/entries`).where("kind", "==", "refund").get(),
        db.collection(`workspaces/${workspace.id}/expenses`).where("flaggedReason", "==", "bank_reversed").get(),
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
    // The P&L's tips are what came in; refunds sit apart as one total. Take
    // refunded tips (negative; a won dispute's positive) back out here so the
    // tips deduction only counts tips that were kept.
    for (const doc of refundSnap.docs) {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success || parsed.data.workspace !== "independent" || !parsed.data.date.startsWith(`${taxYear}-`)) continue;
        const refundedTips = getIndependentCategorizedIncomeTotals(parsed.data.independent).tips;
        if (refundedTips === 0) continue;
        const month = parsed.data.date.slice(0, 7);
        tips.set(month, round2((tips.get(month) ?? 0) + refundedTips));
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
        reversedExpenseCount: reversedSnap.docs.filter((doc) => String(doc.data().date ?? "").startsWith(`${taxYear}-`)).length,
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

// W-2 gross pay by month (the W-2 Home total's taxable amount), and the
// tips within it reported to the employer (card tips + reported cash tips).
async function loadW2Year(workspace: ActiveWorkspace, taxYear: number): Promise<{ pay: Map<string, number>; tips: Map<string, number> }> {
    const snap = await db
        .collection(`workspaces/${workspace.id}/entries`)
        .where("date", ">=", `${taxYear}-01-01`)
        .where("date", "<=", `${taxYear}-12-31`)
        .get();
    const pay = new Map<string, number>();
    const tips = new Map<string, number>();
    for (const doc of snap.docs) {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success || parsed.data.workspace !== "w2") continue;
        const month = parsed.data.date.slice(0, 7);
        pay.set(month, (pay.get(month) ?? 0) + Number(parsed.data.totals?.taxableTotal ?? 0));
        const reportedTips = Number(parsed.data.w2?.tips ?? 0) + Number(parsed.data.w2?.reportedCash ?? 0);
        tips.set(month, (tips.get(month) ?? 0) + reportedTips);
    }
    return { pay, tips };
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

    // ---- W-2 income: recorded in 521, plus any the person says isn't ----
    // The question depends on whether they have W-2 workspaces, and is asked
    // again when those change (a workspace added or archived).
    const w2Key = w2Workspaces.map((w) => w.id).sort().join(",");
    const hasW2Workspace = w2Workspaces.length > 0;
    const w2Answered = hasW2Workspace
        ? profile.w2AllRecorded != null &&
          profile.w2WorkspaceKey === w2Key &&
          (profile.w2AllRecorded || profile.unrecordedW2Pay != null)
        : profile.hasW2Job != null && (!profile.hasW2Job || profile.unrecordedW2Pay != null);
    const hasUnrecordedW2 = w2Answered && (hasW2Workspace ? profile.w2AllRecorded === false : profile.hasW2Job === true);
    const unrecordedW2Pay = hasUnrecordedW2 ? profile.unrecordedW2Pay ?? 0 : 0;
    const unrecordedW2Tips = hasUnrecordedW2 ? Math.min(profile.unrecordedW2Tips ?? 0, unrecordedW2Pay) : 0;

    const monthKeys = Array.from({ length: 12 }, (_, i) => `${taxYear}-${String(i + 1).padStart(2, "0")}`);
    const months: MonthFigures[] = monthKeys.map((month) => ({
        month,
        profit: round2(businessYears.reduce((sum, b) => sum + (b.months.get(month) ?? 0), 0)),
        // Unrecorded pay is a yearly amount, spread evenly over the months.
        w2Wages: round2(w2Years.reduce((sum, w) => sum + (w.pay.get(month) ?? 0), 0) + unrecordedW2Pay / 12),
        w2Tips: round2(w2Years.reduce((sum, w) => sum + (w.tips.get(month) ?? 0), 0) + unrecordedW2Tips / 12),
        tips: round2(businessYears.reduce((sum, b) => sum + (b.tips.get(month) ?? 0), 0)),
    }));
    const thisMonth = today.slice(0, 7);
    const ytdTips = round2(months.filter((m) => m.month <= thisMonth).reduce((sum, m) => sum + (m.tips ?? 0), 0));
    const ytdW2Tips = round2(months.filter((m) => m.month <= thisMonth).reduce((sum, m) => sum + (m.w2Tips ?? 0), 0));

    // Each W-2 workspace's pay so far, scaled to the year, for the question.
    const inTaxYear = today.startsWith(`${taxYear}-`);
    const yearDays = DateTime.fromObject({ year: taxYear }).daysInYear;
    const elapsedDays = inTaxYear ? now.ordinal : yearDays;
    const w2WorkspacePay = w2Workspaces.map((workspace, i) => {
        const sinceJan = (map: Map<string, number>) =>
            [...map.entries()].filter(([month]) => month <= thisMonth).reduce((sum, [, amount]) => sum + amount, 0);
        const ytd = sinceJan(w2Years[i].pay);
        return {
            id: workspace.id,
            name: workspace.name,
            ytdPay: round2(ytd),
            projectedPay: round2((ytd * yearDays) / elapsedDays),
            ytdTips: round2(sinceJan(w2Years[i].tips)),
        };
    });
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
            stateCode: profile.stateCode,
            w2: { hasW2Workspace, answered: w2Answered },
            tipsNeedOccupation: ytdTips > 0 && !profile.occupationCode,
            w2TipsNeedOccupation: ytdW2Tips > 0 && !profile.w2OccupationCode,
            confirmedComplete: profile.confirmedComplete,
        },
        firstRecordDate,
        uncategorizedExpenseCount: businessYears.reduce((sum, b) => sum + b.uncategorizedExpenseCount, 0),
        pendingBankReviewCount: businessYears.reduce((sum, b) => sum + b.pendingBankReviewCount, 0),
        pendingImportCount: businessYears.reduce((sum, b) => sum + b.pendingImportCount, 0),
        reversedExpenseCount: businessYears.reduce((sum, b) => sum + b.reversedExpenseCount, 0),
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
                // Optional; only used with W-2 pay (quarterly.ts, "withholding").
                ytdWithholding: profile.ytdWithholding,
                withholdingAsOf: profile.withholdingAsOf,
                estimatedPaymentsMade: paymentsTotal,
                occupationCode: profile.occupationCode,
                w2OccupationCode: profile.w2OccupationCode,
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
        ytdTips,
        firstRecordDate,
        w2: { workspaces: w2WorkspacePay, key: w2Key },
        generatedAt: new Date().toISOString(),
    };
}
