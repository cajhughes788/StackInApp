import { DateTime } from "luxon";
import { db } from "../admin";
import { PayStub, TaxProfile } from "@shared/schemas";
import { EntrySchema, type EntryType } from "@shared/schemas/entry";
import { SettingsDocSchema, type SettingsType, } from "@shared/schemas/settings";
import { calculateNetPay } from "@shared/tax/engine";
import { buildTaxProfileInput } from "@shared/tax/buildTaxProfileInput";
import { getCurrentPayPeriodAt, getMostRecentlyClosedPayPeriod } from "@shared/payPeriods";
const DEFAULT_TIME_ZONE = "America/Los_Angeles";
function round2(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
}
function sumEntryGross(entry: EntryType) {
    return round2(Number(entry.totals?.dayTotal ?? 0));
}
function sumEntryTips(entry: EntryType) {
    return round2(Number(entry.w2?.tips ?? 0));
}
function sumEntryReportedCash(entry: EntryType) {
    return round2(Number(entry.w2?.reportedCash ?? 0));
}
function sumEntryUnreportedCash(entry: EntryType) {
    return round2(Number(entry.w2?.unreportedCash ?? 0));
}
function sumEntryCustomDeductions(entry: EntryType) {
    return round2(Number(entry.totals?.customDeductionsAmount ?? 0));
}
function sumEntryBreakDeductions(entry: EntryType) {
    return round2(Number(entry.totals?.breakDeductionAmount ?? 0));
}
function getEntryUpdatedAt(entry: EntryType): string | null {
    return entry.updatedAtLocal ?? entry.createdAtLocal ?? null;
}
function maxIso(a: string | null, b: string | null) {
    if (!a)
        return b;
    if (!b)
        return a;
    return a > b ? a : b;
}
async function getWorkspaceSettings(workspaceId: string): Promise<SettingsType> {
    const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get();
    if (!snap.exists) {
        throw new Error("Settings not found");
    }
    const parsed = SettingsDocSchema.safeParse(snap.data());
    if (!parsed.success) {
        throw new Error("Invalid settings data");
    }
    return parsed.data;
}
async function getWorkspaceCreatedAt(workspaceId: string): Promise<number | null> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get();
  if (!snap.exists) {
    return null;
  }
  const createdAt = snap.data()?.createdAt;
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    return createdAt;
  }
  if (createdAt instanceof Date) {
    const millis = createdAt.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (
    createdAt &&
    typeof createdAt === "object" &&
    typeof (createdAt as { toMillis?: unknown }).toMillis === "function"
  ) {
    const millis = (createdAt as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}
function getEarliestEligiblePayStubPeriodEnd(settings: SettingsType, workspaceCreatedAt: number | null): string | null {
    if (workspaceCreatedAt == null) {
        return null;
    }
    const tz = settings.common?.timeZone || DEFAULT_TIME_ZONE;
    const workspaceCreatedAtDt = DateTime.fromMillis(workspaceCreatedAt, { zone: tz });
    if (!workspaceCreatedAtDt.isValid) {
        return null;
    }
    return getCurrentPayPeriodAt(settings, workspaceCreatedAtDt).end;
}
function isEligiblePayStubPeriod(periodEnd: string, earliestEligiblePeriodEnd: string | null): boolean {
    if (!earliestEligiblePeriodEnd) {
        return true;
    }
    return periodEnd >= earliestEligiblePeriodEnd;
}
async function getWorkspaceTaxProfile(workspaceId: string): Promise<TaxProfile.Type | null> {
    const snap = await db.doc(`workspaces/${workspaceId}/taxProfile/current`).get();
    if (!snap.exists)
        return null;
    const parsed = TaxProfile.Schema.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
}
async function getPreviousPayStub(workspaceId: string, currentPeriodStart: string): Promise<any | null> {
    const snap = await db
        .collection(`workspaces/${workspaceId}/payStubs`)
        .where("periodEnd", "<", currentPeriodStart)
        .orderBy("periodEnd", "desc")
        .limit(1)
        .get();
    if (snap.empty) return null;
    return snap.docs[0].data();
}
async function getWorkspaceEntries(workspaceId: string): Promise<EntryType[]> {
    const snap = await db.collection(`workspaces/${workspaceId}/entries`).get();
    return snap.docs
        .map((doc) => {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) {
            return null;
        }
        return parsed.data;
    })
        .filter((entry): entry is EntryType => entry !== null && entry.workspace === "w2");
}
function buildTaxBreakdownFromNetPay(result: ReturnType<typeof calculateNetPay>) {
    const pretax401k = round2(result.breakdown.pretaxDeductions?.traditional401k ?? 0);
    const pretaxInsurance = round2(result.breakdown.pretaxDeductions?.insurancePreTax ?? 0);
    const posttax401k = round2(result.breakdown.posttaxDeductions?.roth401k ?? 0);
    const posttaxInsurance = round2(result.breakdown.posttaxDeductions?.insurancePostTax ?? 0);
    const customDeductions = round2(result.breakdown.customDeductions ?? 0);
    return {
        federalTax: round2(result.breakdown.federal),
        medicareTax: round2(result.breakdown.medicare),
        ficaTax: round2(result.breakdown.fica),
        stateTax: round2(result.breakdown.state),
        localTax: round2(result.breakdown.local),
        marylandLocalTax: round2(result.breakdown.local),
        retirement401k: round2(pretax401k + posttax401k),
        insurance: round2(pretaxInsurance + posttaxInsurance),
        retirement: round2(pretax401k + posttax401k),
        federal: round2(result.breakdown.federal),
        medicare: round2(result.breakdown.medicare),
        fica: round2(result.breakdown.fica),
        state: round2(result.breakdown.state),
        local: round2(result.breakdown.local),
        socialSecurity: round2(result.breakdown.socialSecurity),
        customDeductions,
        insurancePreTax: pretaxInsurance,
        insurancePostTax: posttaxInsurance,
        roth401k: posttax401k,
        traditional401k: pretax401k,
    };
}
function computeYtdTotals(params: {
    currentGrossIncome: number;
    currentNetIncome: number;
    currentEntries: EntryType[];
    previousStub: any | null;
    periodStart: string;
    settings: SettingsType;
}) {
    const { currentGrossIncome, currentNetIncome, currentEntries, previousStub, periodStart, settings } = params;
    const tz = settings.common?.timeZone || DEFAULT_TIME_ZONE;
    const startOfYear = DateTime.fromISO(periodStart, { zone: tz }).startOf("year").toISODate()!;

    // If the previous stub is from a prior year, YTD resets — only the current period counts.
    const prevYtd = (previousStub && previousStub.periodEnd >= startOfYear)
        ? previousStub.ytdTotals ?? null
        : null;

    const grossIncome = round2((prevYtd?.grossIncome ?? 0) + currentGrossIncome);
    const netIncome = round2((prevYtd?.netIncome ?? 0) + currentNetIncome);
    const totalDeductions = round2(grossIncome - netIncome);

    const tips = round2(
        (prevYtd?.tips ?? 0) +
        currentEntries.reduce((sum, e) => sum + sumEntryTips(e), 0)
    );
    const reportedCash = round2(
        (prevYtd?.reportedCash ?? 0) +
        currentEntries.reduce((sum, e) => sum + sumEntryReportedCash(e), 0)
    );
    const unreportedCash = round2(
        (prevYtd?.unreportedCash ?? 0) +
        currentEntries.reduce((sum, e) => sum + sumEntryUnreportedCash(e), 0)
    );

    return { grossIncome, netIncome, totalDeductions, tips, reportedCash, unreportedCash };
}
function buildPayStubDocument(params: {
    uid: string;
    workspaceId: string;
    settings: SettingsType;
    taxProfile: TaxProfile.Type | null;
    entries: EntryType[];
    previousStub: any | null;
    start: string;
    end: string;
    periodId: string;
    previousVersion?: number;
}) {
    const { uid, workspaceId, settings, taxProfile, entries, previousStub, start, end, periodId } = params;
    console.log("[payStubsService.buildPayStubDocument] inputs", JSON.stringify({
        workspaceId,
        uid,
        periodId,
        start,
        end,
        payFrequency: settings.w2?.payFrequency ?? null,
        autoTaxCalculation: settings.w2?.autoTaxCalculation ?? null,
        entryCount: entries.length,
        entrySummaries: entries.map((entry) => ({
            id: entry.id ?? null,
            date: entry.date,
            totalsDayTotal: Number(entry.totals?.dayTotal ?? 0),
            totalsTaxableTotal: Number(entry.totals?.taxableTotal ?? 0),
            totalsCustomDeductions: Number(entry.totals?.customDeductionsAmount ?? 0),
            paidHours: Number(entry.totals?.paidHours ?? 0),
            w2Hours: Number(entry.w2?.hours ?? 0),
            w2Rate: entry.w2?.rate ?? null,
            w2Tips: Number(entry.w2?.tips ?? 0),
            reportedCash: Number(entry.w2?.reportedCash ?? 0),
            unreportedCash: Number(entry.w2?.unreportedCash ?? 0),
        })),
        summedDayTotal: round2(entries.reduce((sum, entry) => sum + Number(entry.totals?.dayTotal ?? 0), 0)),
        summedTaxableTotal: round2(entries.reduce((sum, entry) => sum + Number(entry.totals?.taxableTotal ?? 0), 0)),
        summedTips: round2(entries.reduce((sum, entry) => sum + Number(entry.w2?.tips ?? 0), 0)),
        summedReportedCash: round2(entries.reduce((sum, entry) => sum + Number(entry.w2?.reportedCash ?? 0), 0)),
        summedUnreportedCash: round2(entries.reduce((sum, entry) => sum + Number(entry.w2?.unreportedCash ?? 0), 0)),
        summedCustomDeductions: round2(entries.reduce((sum, entry) => sum + Number(entry.totals?.customDeductionsAmount ?? 0), 0)),
        taxProfileSummary: taxProfile ? {
            filingStatus: taxProfile.filingStatus ?? null,
            dependents: taxProfile.dependents ?? null,
            state: taxProfile.state ?? null,
            residenceState: taxProfile.residenceState ?? null,
            workState: taxProfile.workState ?? null,
            insurancePremium: taxProfile.insurancePremium ?? null,
            insurancePreTax: taxProfile.insurancePreTax ?? null,
            retirement401kType: taxProfile.retirement401kType ?? null,
            retirement401kPercent: taxProfile.retirement401kPercent ?? null,
            retirement401kFlat: taxProfile.retirement401kFlat ?? null,
            additionalFederalWithholding: taxProfile.additionalFederalWithholding ?? null,
            additionalStateWithholding: taxProfile.additionalStateWithholding ?? null,
        } : null,
    }));
    const grossIncome = round2(entries.reduce((sum, entry) => sum + sumEntryGross(entry), 0));
    const customDeductions = round2(entries.reduce((sum, entry) => sum + sumEntryCustomDeductions(entry), 0));
    const breakDeductions = round2(entries.reduce((sum, entry) => sum + sumEntryBreakDeductions(entry), 0));
    const totalUnreported = round2(entries.reduce((sum, entry) => sum + sumEntryUnreportedCash(entry), 0));
    let netIncome = grossIncome;
    let breakdown: Record<string, number> = {};
    if (settings.w2?.autoTaxCalculation && taxProfile) {
        const result = calculateNetPay(buildTaxProfileInput(taxProfile, {
            grossIncome,
            payFrequency: settings.w2?.payFrequency ?? "biweekly",
            customDeductions: customDeductions + breakDeductions,
        }));
        console.log("[payStubsService.buildPayStubDocument] tax_result", JSON.stringify({
            workspaceId,
            uid,
            periodId,
            grossIncome,
            netIncome: result.netIncome,
            taxableIncome: result.taxableIncome,
            federal: result.breakdown.federal,
            state: result.breakdown.state,
            local: result.breakdown.local,
            socialSecurity: result.breakdown.socialSecurity,
            medicare: result.breakdown.medicare,
            fica: result.breakdown.fica,
            customDeductions: result.breakdown.customDeductions ?? 0,
            pretaxDeductions: result.breakdown.pretaxDeductions ?? null,
            posttaxDeductions: result.breakdown.posttaxDeductions ?? null,
        }));
        netIncome = round2(result.netIncome);
        breakdown = buildTaxBreakdownFromNetPay(result);
    }
    const ytdTotals = computeYtdTotals({
        currentGrossIncome: grossIncome,
        currentNetIncome: netIncome,
        currentEntries: entries,
        previousStub,
        periodStart: start,
        settings,
    });
    const latestSourceUpdatedAt = entries.reduce<string | null>((latest, entry) => maxIso(latest, getEntryUpdatedAt(entry)), null);
    const stub = PayStub.Schema.parse({
        uid,
        periodId,
        periodStart: start,
        periodEnd: end,
        grossIncome,
        netIncome,
        breakdown,
        totalUnreported,
        ytdTotals,
        entries,
        settings,
        taxProfile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUpdatedThrough: latestSourceUpdatedAt ?? undefined,
    } as any);
    return stub;
}
function isStubStale(existing: any, entries: EntryType[]) {
    const latestSourceUpdatedAt = entries.reduce<string | null>((latest, entry) => maxIso(latest, getEntryUpdatedAt(entry)), null);
    return (existing?.sourceUpdatedThrough ?? null) !== latestSourceUpdatedAt;
}
export async function listPayStubs(workspaceId: string, uid: string, opts?: {
    limit?: number;
    cursorId?: string;
    forceFull?: boolean;
}) {
    console.log("[payStubsService.listPayStubs] start", JSON.stringify({
        workspaceId,
        uid,
        opts: opts ?? null,
    }));
    const [settings, workspaceCreatedAt] = await Promise.all([
        getWorkspaceSettings(workspaceId),
        getWorkspaceCreatedAt(workspaceId),
    ]);
    const earliestEligiblePeriodEnd = getEarliestEligiblePayStubPeriodEnd(settings, workspaceCreatedAt);
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const col = db
        .collection(`workspaces/${workspaceId}/payStubs`)
        .orderBy("periodStart", "desc")
        .limit(limit);
    let q = col;
    if (opts?.cursorId) {
        const cur = await db.doc(`workspaces/${workspaceId}/payStubs/${opts.cursorId}`).get();
        if (cur.exists)
            q = col.startAfter(cur);
    }
    const snap = await q.get();
    const paystubs = snap.docs
        .map((doc) => {
        const parsed = PayStub.Schema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) {
            return null;
        }
        return parsed.data;
    })
        .filter((item): item is PayStub.Type => item !== null)
        .filter((item) => isEligiblePayStubPeriod(item.periodEnd, earliestEligiblePeriodEnd));
    console.log("[payStubsService.listPayStubs] result", JSON.stringify({
        workspaceId,
        uid,
        count: paystubs.length,
        nextCursor: snap.size ? snap.docs[snap.size - 1].id : null,
        earliestEligiblePeriodEnd,
        periodIds: paystubs.map((stub) => stub.periodId),
        periods: paystubs.map((stub) => ({
            periodId: stub.periodId,
            periodStart: stub.periodStart,
            periodEnd: stub.periodEnd,
        })),
    }));
    return {
        paystubs,
        nextCursor: snap.size ? snap.docs[snap.size - 1].id : null,
    };
}
export async function generatePayStub(workspaceId: string, uid: string, opts: {
    start: string;
    end: string;
    periodId: string;
    force?: boolean;
}) {
    console.log("[payStubsService.generatePayStub] start", JSON.stringify({
        workspaceId,
        uid,
        opts,
    }));
    const [settings, taxProfile, allEntries, workspaceCreatedAt, previousStub] = await Promise.all([
        getWorkspaceSettings(workspaceId),
        getWorkspaceTaxProfile(workspaceId),
        getWorkspaceEntries(workspaceId),
        getWorkspaceCreatedAt(workspaceId),
        getPreviousPayStub(workspaceId, opts.start),
    ]);
    const earliestEligiblePeriodEnd = getEarliestEligiblePayStubPeriodEnd(settings, workspaceCreatedAt);
    if (!isEligiblePayStubPeriod(opts.end, earliestEligiblePeriodEnd)) {
        console.log("[payStubsService.generatePayStub] skipped_ineligible", JSON.stringify({
            workspaceId,
            uid,
            periodId: opts.periodId,
            end: opts.end,
            earliestEligiblePeriodEnd,
        }));
        return { id: opts.periodId, ok: true, skipped: true };
    }
    const entriesForPeriod = allEntries
        .filter((entry) => entry.date >= opts.start && entry.date <= opts.end)
        .sort((a, b) => a.date.localeCompare(b.date));
    const ref = db.collection(`workspaces/${workspaceId}/payStubs`).doc(opts.periodId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() : null;
    if (!opts.force && existing && !isStubStale(existing, entriesForPeriod)) {
        console.log("[payStubsService.generatePayStub] reused_existing", JSON.stringify({
            workspaceId,
            uid,
            periodId: opts.periodId,
            entryCount: entriesForPeriod.length,
            existingSourceUpdatedThrough: existing?.sourceUpdatedThrough ?? null,
        }));
        return { id: opts.periodId, ok: true };
    }
    const stub = buildPayStubDocument({
        uid,
        workspaceId,
        settings,
        taxProfile,
        entries: entriesForPeriod,
        previousStub,
        start: opts.start,
        end: opts.end,
        periodId: opts.periodId,
    });
    await ref.set({
        ...stub,
        sourceUpdatedThrough: entriesForPeriod.reduce<string | null>((latest, entry) => maxIso(latest, getEntryUpdatedAt(entry)), null),
    }, { merge: true });
    console.log("[payStubsService.generatePayStub] persisted", JSON.stringify({
        workspaceId,
        uid,
        periodId: opts.periodId,
        entryCount: entriesForPeriod.length,
        grossIncome: stub.grossIncome,
        netIncome: stub.netIncome,
        totalUnreported: stub.totalUnreported,
        periodStart: stub.periodStart,
        periodEnd: stub.periodEnd,
    }));
    return { id: opts.periodId, ok: true };
}
export async function generateMostRecentlyClosedPayStub(workspaceId: string, uid: string, force = false) {
    const [settings, workspaceCreatedAt] = await Promise.all([
        getWorkspaceSettings(workspaceId),
        getWorkspaceCreatedAt(workspaceId),
    ]);
    const period = getMostRecentlyClosedPayPeriod(settings);
    const earliestEligiblePeriodEnd = getEarliestEligiblePayStubPeriodEnd(settings, workspaceCreatedAt);
    if (!isEligiblePayStubPeriod(period.end, earliestEligiblePeriodEnd)) {
        return { id: period.periodId, ok: true, skipped: true };
    }
    return generatePayStub(workspaceId, uid, {
        start: period.start,
        end: period.end,
        periodId: period.periodId,
        force,
    });
}
