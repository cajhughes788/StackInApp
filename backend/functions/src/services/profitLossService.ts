import { DateTime } from "luxon";
import { db } from "../admin";
import { findExpenseCategoryGuideEntry, getCpaExpenseCategory } from "@shared/expenseCategories";
import { EntrySchema, type EntryType, type IncomeCategory, } from "@shared/schemas/entry";
import { ExpenseSchema, type ExpenseType, } from "@shared/schemas/expense";
import type { ProfitLossDetailItem } from "@shared/schemas/profitLoss";
import { ProfitLossStatementSchema, ProfitLossStatementListSchema, type ProfitLossPeriodType, type ProfitLossStatement, } from "@shared/schemas/profitLoss";
const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const INCOME_CATEGORY_CONFIG: Array<{
    key: IncomeCategory;
    label: string;
}> = [
    { key: "services", label: "Services" },
    { key: "tips", label: "Tips" },
    { key: "products", label: "Products" },
    { key: "other", label: "Other" },
];
const PAYMENT_METHOD_LABELS = {
    cash: "Cash",
    card: "Card",
    venmo: "Venmo",
    apple_cash: "Apple Cash",
    zelle: "Zelle",
    pos: "POS",
    other: "Other",
};
type PeriodDescriptor = {
    id: string;
    periodType: ProfitLossPeriodType;
    periodKey: string;
    periodStart: string;
    periodEnd: string;
    label: string;
};
type WorkspaceFinancialData = {
    entries: EntryType[];
    expenses: ExpenseType[];
};
type ProfitLossTarget = {
    periodType: ProfitLossPeriodType;
    periodKey: string;
};
function roundCurrency(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
}
function normalizeDate(date: string) {
    return DateTime.fromISO(date, { zone: DEFAULT_TIME_ZONE });
}
function toIsoOrNull(value: string | undefined): string | null {
    if (!value)
        return null;
    const dt = DateTime.fromISO(value, { zone: DEFAULT_TIME_ZONE });
    return dt.isValid ? dt.toUTC().toISO() : null;
}
function maxIso(a: string | null, b: string | null): string | null {
    if (!a)
        return b;
    if (!b)
        return a;
    return a > b ? a : b;
}
function getStatementDocId(periodType: ProfitLossPeriodType, periodKey: string) {
    return `${periodType}_${periodKey}`;
}
function compareByDateThenLabel(a: {
    date: string;
    label: string;
}, b: {
    date: string;
    label: string;
}) {
    return a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
}
function buildIncomeCategories(entries: EntryType[]) {
    const grouped = new Map(INCOME_CATEGORY_CONFIG.map(({ key }) => [key, [] as ProfitLossDetailItem[]]));
    for (const entry of entries) {
        if (entry.workspace !== "independent")
            continue;
        const note = entry.notes.trim();
        for (const [breakdownIndex, breakdown] of (entry.independent?.incomeBreakdowns ?? []).entries()) {
            const paymentLabel = PAYMENT_METHOD_LABELS[breakdown.paymentMethod] ?? "Income";
            for (const { key } of INCOME_CATEGORY_CONFIG) {
                const amount = roundCurrency(Number(breakdown[key] ?? 0));
                if (amount <= 0)
                    continue;
                grouped.get(key)?.push({
                    id: `${entry.id ?? entry.date}-${breakdownIndex}-${key}`,
                    date: entry.date,
                    label: note || paymentLabel,
                    description: note ? paymentLabel : null,
                    amount,
                });
            }
        }
    }
    return INCOME_CATEGORY_CONFIG.map(({ key, label }) => {
        const items = [...(grouped.get(key) ?? [])].sort(compareByDateThenLabel);
        const amount = roundCurrency(items.reduce((sum, item) => sum + item.amount, 0));
        return {
            category: key,
            label,
            amount,
            count: items.length,
            items,
        };
    });
}
function buildExpenseCategories(expenses: ExpenseType[]) {
    const expenseByCategoryMap = new Map<string, {
        items: ProfitLossDetailItem[];
    }>();
    for (const expense of expenses) {
        const amount = roundCurrency(Number(expense.amount) || 0);
        const builtInCategory = findExpenseCategoryGuideEntry(expense.account ?? "");
        const key = builtInCategory
            ? getCpaExpenseCategory(builtInCategory.category)
            : (expense.account?.trim() || "Uncategorized");
        const current = expenseByCategoryMap.get(key) ?? { items: [] };
        current.items.push({
            id: expense.id,
            date: expense.date,
            label: expense.vendor || expense.description || key,
            description: expense.vendor && expense.description
                ? expense.description
                : expense.account ?? null,
            appCategory: expense.account ?? null,
            amount,
        });
        expenseByCategoryMap.set(key, current);
    }
    return [...expenseByCategoryMap.entries()]
        .map(([category, value]) => {
        const items = [...value.items].sort(compareByDateThenLabel);
        return {
            category,
            amount: roundCurrency(items.reduce((sum, item) => sum + item.amount, 0)),
            count: items.length,
            items,
        };
    })
        .sort((a, b) => a.category.localeCompare(b.category));
}
function getPeriodDescriptor(periodType: ProfitLossPeriodType, anchor: DateTime): PeriodDescriptor {
    if (periodType === "month") {
        const start = anchor.startOf("month");
        const end = anchor.endOf("month");
        const periodKey = start.toFormat("yyyy-MM");
        return {
            id: getStatementDocId(periodType, periodKey),
            periodType,
            periodKey,
            periodStart: start.toISODate()!,
            periodEnd: end.toISODate()!,
            label: start.toFormat("LLLL yyyy"),
        };
    }
    if (periodType === "quarter") {
        const start = anchor.startOf("quarter");
        const end = anchor.endOf("quarter");
        const quarterNumber = Math.ceil(start.month / 3);
        const periodKey = `${start.toFormat("yyyy")}-Q${quarterNumber}`;
        return {
            id: getStatementDocId(periodType, periodKey),
            periodType,
            periodKey,
            periodStart: start.toISODate()!,
            periodEnd: end.toISODate()!,
            label: `Q${quarterNumber} ${start.toFormat("yyyy")}`,
        };
    }
    const start = anchor.startOf("year");
    const end = anchor.endOf("year");
    const periodKey = start.toFormat("yyyy");
    return {
        id: getStatementDocId(periodType, periodKey),
        periodType,
        periodKey,
        periodStart: start.toISODate()!,
        periodEnd: end.toISODate()!,
        label: start.toFormat("yyyy"),
    };
}
function getDescriptorFromKey(periodType: ProfitLossPeriodType, periodKey: string): PeriodDescriptor {
    if (periodType === "month") {
        const parsed = DateTime.fromFormat(periodKey, "yyyy-MM", { zone: DEFAULT_TIME_ZONE });
        if (!parsed.isValid)
            throw new Error("Invalid monthly periodKey");
        return getPeriodDescriptor(periodType, parsed);
    }
    if (periodType === "quarter") {
        const match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
        if (!match)
            throw new Error("Invalid quarterly periodKey");
        const year = Number(match[1]);
        const quarter = Number(match[2]);
        return getPeriodDescriptor(periodType, DateTime.fromObject({ year, month: (quarter - 1) * 3 + 1, day: 1 }, { zone: DEFAULT_TIME_ZONE }));
    }
    if (!/^\d{4}$/.test(periodKey))
        throw new Error("Invalid yearly periodKey");
    return getPeriodDescriptor(periodType, DateTime.fromObject({ year: Number(periodKey), month: 1, day: 1 }, { zone: DEFAULT_TIME_ZONE }));
}
function getLastCompletedPeriodEnd(periodType: ProfitLossPeriodType, now = DateTime.now().setZone(DEFAULT_TIME_ZONE)): DateTime {
    if (periodType === "month")
        return now.startOf("month").minus({ days: 1 }).endOf("day");
    if (periodType === "quarter")
        return now.startOf("quarter").minus({ days: 1 }).endOf("day");
    return now.startOf("year").minus({ days: 1 }).endOf("day");
}
function getPeriodStart(periodType: ProfitLossPeriodType, anchor: DateTime): DateTime {
    if (periodType === "month")
        return anchor.startOf("month");
    if (periodType === "quarter")
        return anchor.startOf("quarter");
    return anchor.startOf("year");
}
function advancePeriod(periodType: ProfitLossPeriodType, cursor: DateTime): DateTime {
    if (periodType === "month")
        return cursor.plus({ months: 1 });
    if (periodType === "quarter")
        return cursor.plus({ quarters: 1 });
    return cursor.plus({ years: 1 });
}
function getSourceUpdatedAtEntry(entry: EntryType): string | null {
    return maxIso(toIsoOrNull(entry.updatedAtLocal), toIsoOrNull(entry.createdAtLocal));
}
function getSourceUpdatedAtExpense(expense: ExpenseType): string | null {
    return maxIso(toIsoOrNull(expense.updatedAt), toIsoOrNull(expense.createdAt));
}
async function ensureIndependentWorkspace(workspaceId: string) {
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get();
    if (!workspaceSnap.exists)
        throw new Error("Workspace not found");
    const data = workspaceSnap.data();
    if (data?.type !== "independent") {
        throw new Error("Profit & loss is only available for independent workspaces");
    }
}
async function loadWorkspaceFinancialData(workspaceId: string): Promise<WorkspaceFinancialData> {
    const [entriesSnap, expensesSnap] = await Promise.all([
        db.collection(`workspaces/${workspaceId}/entries`).get(),
        db.collection(`workspaces/${workspaceId}/expenses`).get(),
    ]);
    const entries = entriesSnap.docs
        .map((doc) => {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) {
            return null;
        }
        return parsed.data;
    })
        .filter((entry): entry is EntryType => entry !== null && entry.workspace === "independent");
    const expenses = expensesSnap.docs
        .map((doc) => {
        const parsed = ExpenseSchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) {
            return null;
        }
        return parsed.data;
    })
        .filter((expense): expense is ExpenseType => expense !== null);
    return { entries, expenses };
}
function filterEntriesForPeriod(entries: EntryType[], descriptor: PeriodDescriptor): EntryType[] {
    return entries.filter((entry) => entry.date >= descriptor.periodStart && entry.date <= descriptor.periodEnd);
}
function filterExpensesForPeriod(expenses: ExpenseType[], descriptor: PeriodDescriptor): ExpenseType[] {
    return expenses.filter((expense) => expense.date >= descriptor.periodStart && expense.date <= descriptor.periodEnd);
}
function buildPeriods(periodType: ProfitLossPeriodType, entries: EntryType[], expenses: ExpenseType[], opts: {
    includeInProgress?: boolean;
    now?: DateTime;
} = {}): PeriodDescriptor[] {
    const sourceDates = [
        ...entries.map((entry) => normalizeDate(entry.date)),
        ...expenses.map((expense) => normalizeDate(expense.date)),
    ].filter((dt) => dt.isValid);
    if (sourceDates.length === 0)
        return [];
    const firstSource = sourceDates.reduce((min, current) => current.toMillis() < min.toMillis() ? current : min);
    const lastSource = sourceDates.reduce((max, current) => current.toMillis() > max.toMillis() ? current : max);
    const now = opts.now ?? DateTime.now().setZone(DEFAULT_TIME_ZONE);
    const lastCompletedEnd = getLastCompletedPeriodEnd(periodType, now);
    const finalPeriodStart = opts.includeInProgress
        ? getPeriodStart(periodType, lastSource)
        : getPeriodStart(periodType, lastCompletedEnd);
    const firstPeriodStart = getPeriodStart(periodType, firstSource);
    if (firstPeriodStart.toMillis() > finalPeriodStart.toMillis())
        return [];
    const periods: PeriodDescriptor[] = [];
    let cursor = firstPeriodStart;
    while (cursor.toMillis() <= finalPeriodStart.toMillis()) {
        periods.push(getPeriodDescriptor(periodType, cursor));
        cursor = advancePeriod(periodType, cursor);
    }
    return periods.reverse();
}
function buildStatement(workspaceId: string, descriptor: PeriodDescriptor, entries: EntryType[], expenses: ExpenseType[], previousVersion = 0): ProfitLossStatement {
    // Single pass — derive top-level totals from the same computation that
    // builds the category line items, eliminating the redundant aggregateIndependentPnL pass.
    const incomeCategories = buildIncomeCategories(entries);
    const incomeTotals = new Map(incomeCategories.map((c) => [c.category, c.amount]));
    const incomeTotal = roundCurrency(incomeCategories.reduce((sum, c) => sum + c.amount, 0));

    const byCategory = buildExpenseCategories(expenses);
    const totalExpenses = roundCurrency(byCategory.reduce((sum, item) => sum + item.amount, 0));
    let sourceUpdatedThrough: string | null = null;
    for (const entry of entries) {
        sourceUpdatedThrough = maxIso(sourceUpdatedThrough, getSourceUpdatedAtEntry(entry));
    }
    for (const expense of expenses) {
        sourceUpdatedThrough = maxIso(sourceUpdatedThrough, getSourceUpdatedAtExpense(expense));
    }
    return ProfitLossStatementSchema.parse({
        id: descriptor.id,
        workspaceId,
        workspaceType: "independent",
        periodType: descriptor.periodType,
        periodKey: descriptor.periodKey,
        periodStart: descriptor.periodStart,
        periodEnd: descriptor.periodEnd,
        label: descriptor.label,
        income: {
            services: incomeTotals.get("services") ?? 0,
            tips: incomeTotals.get("tips") ?? 0,
            products: incomeTotals.get("products") ?? 0,
            other: incomeTotals.get("other") ?? 0,
            total: incomeTotal,
            categories: incomeCategories,
        },
        expenses: {
            byCategory,
            total: totalExpenses,
        },
        netProfit: roundCurrency(incomeTotal - totalExpenses),
        meta: {
            incomeEntryCount: entries.length,
            expenseCount: expenses.length,
            generatedAt: new Date().toISOString(),
            sourceUpdatedThrough,
            stale: false,
            version: previousVersion + 1,
        },
    });
}
async function upsertStatement(workspaceId: string, statement: ProfitLossStatement): Promise<ProfitLossStatement> {
    const ref = db.doc(`workspaces/${workspaceId}/profitLossStatements/${statement.id}`);
    await ref.set(statement, { merge: true });
    return statement;
}

async function markStatementStale(workspaceId: string, descriptor: PeriodDescriptor): Promise<void> {
    try {
        const ref = db.doc(`workspaces/${workspaceId}/profitLossStatements/${descriptor.id}`);
        await ref.set({ meta: { stale: true } }, { merge: true });
    } catch {
        // Best-effort — failure to mark stale is non-fatal
    }
}

async function loadWorkspaceFinancialDataForPeriod(
    workspaceId: string,
    descriptor: PeriodDescriptor
): Promise<WorkspaceFinancialData> {
    const [entriesSnap, expensesSnap] = await Promise.all([
        db.collection(`workspaces/${workspaceId}/entries`)
            .where("date", ">=", descriptor.periodStart)
            .where("date", "<=", descriptor.periodEnd)
            .get(),
        db.collection(`workspaces/${workspaceId}/expenses`)
            .where("date", ">=", descriptor.periodStart)
            .where("date", "<=", descriptor.periodEnd)
            .get(),
    ]);
    const entries = entriesSnap.docs
        .map((doc) => {
            const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
            return parsed.success ? parsed.data : null;
        })
        .filter((e): e is EntryType => e !== null && e.workspace === "independent");
    const expenses = expensesSnap.docs
        .map((doc) => {
            const parsed = ExpenseSchema.safeParse({ id: doc.id, ...doc.data() });
            return parsed.success ? parsed.data : null;
        })
        .filter((e): e is ExpenseType => e !== null);
    return { entries, expenses };
}
async function deleteStatement(workspaceId: string, descriptor: PeriodDescriptor): Promise<void> {
    await db.doc(`workspaces/${workspaceId}/profitLossStatements/${descriptor.id}`).delete();
}
function getComparableStatementShape(statement: ProfitLossStatement) {
    return {
        workspaceId: statement.workspaceId,
        workspaceType: statement.workspaceType,
        periodType: statement.periodType,
        periodKey: statement.periodKey,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        label: statement.label,
        income: statement.income,
        expenses: statement.expenses,
        netProfit: statement.netProfit,
        meta: {
            incomeEntryCount: statement.meta.incomeEntryCount,
            expenseCount: statement.meta.expenseCount,
            sourceUpdatedThrough: statement.meta.sourceUpdatedThrough,
            stale: statement.meta.stale,
        },
    };
}
function statementsMatch(a: ProfitLossStatement | null, b: ProfitLossStatement): boolean {
    if (!a)
        return false;
    return JSON.stringify(getComparableStatementShape(a)) ===
        JSON.stringify(getComparableStatementShape(b));
}
async function loadExistingStatement(workspaceId: string, descriptor: PeriodDescriptor): Promise<ProfitLossStatement | null> {
    const snap = await db
        .doc(`workspaces/${workspaceId}/profitLossStatements/${descriptor.id}`)
        .get();
    if (!snap.exists)
        return null;
    const parsed = ProfitLossStatementSchema.safeParse({ id: snap.id, ...snap.data() });
    return parsed.success ? parsed.data : null;
}
async function materializeStatementForDescriptor(workspaceId: string, descriptor: PeriodDescriptor, data: WorkspaceFinancialData): Promise<ProfitLossStatement | null> {
    const entriesForPeriod = filterEntriesForPeriod(data.entries, descriptor);
    const expensesForPeriod = filterExpensesForPeriod(data.expenses, descriptor);
    const existing = await loadExistingStatement(workspaceId, descriptor);
    if (entriesForPeriod.length === 0 && expensesForPeriod.length === 0) {
        if (existing) {
            await deleteStatement(workspaceId, descriptor);
        }
        return null;
    }
    const rebuilt = buildStatement(workspaceId, descriptor, entriesForPeriod, expensesForPeriod, existing?.meta.version ?? 0);
    if (statementsMatch(existing, rebuilt)) {
        return existing;
    }
    // Mark stale before writing so the UI knows a rebuild is in progress.
    // On success upsertStatement writes stale: false.
    await markStatementStale(workspaceId, descriptor);
    return upsertStatement(workspaceId, { ...rebuilt, meta: { ...rebuilt.meta, stale: false } });
}
function uniqueTargets(targets: ProfitLossTarget[]): ProfitLossTarget[] {
    const deduped = new Map<string, ProfitLossTarget>();
    for (const target of targets) {
        deduped.set(`${target.periodType}:${target.periodKey}`, target);
    }
    return [...deduped.values()];
}
function getTargetsForDate(date: string, periodTypes: ProfitLossPeriodType[] = ["month", "quarter", "year"]): ProfitLossTarget[] {
    const anchor = normalizeDate(date);
    if (!anchor.isValid)
        return [];
    return periodTypes.map((periodType) => {
        const descriptor = getPeriodDescriptor(periodType, anchor);
        return {
            periodType,
            periodKey: descriptor.periodKey,
        };
    });
}
async function syncProfitLossTargets(workspaceId: string, targets: ProfitLossTarget[]): Promise<void> {
    const unique = uniqueTargets(targets);
    if (unique.length === 0)
        return;
    await ensureIndependentWorkspace(workspaceId);
    // Load data per-period rather than doing one unbounded workspace scan.
    // Each expense mutation touches at most 3 periods (month + quarter + year)
    // so this reads only the relevant date ranges instead of all historical data.
    for (const target of unique) {
        const descriptor = getDescriptorFromKey(target.periodType, target.periodKey);
        const data = await loadWorkspaceFinancialDataForPeriod(workspaceId, descriptor);
        await materializeStatementForDescriptor(workspaceId, descriptor, data);
    }
}
async function syncRollupAncestors(workspaceId: string, descriptor: PeriodDescriptor): Promise<void> {
    const ancestorPeriodTypes: ProfitLossPeriodType[] = descriptor.periodType === "month"
        ? ["quarter", "year"]
        : descriptor.periodType === "quarter"
            ? ["year"]
            : [];
    if (ancestorPeriodTypes.length === 0)
        return;
    await syncProfitLossTargets(workspaceId, getTargetsForDate(descriptor.periodStart, ancestorPeriodTypes));
}
export async function syncProfitLossForFinancialDates(workspaceId: string, dates: Array<string | null | undefined>): Promise<void> {
    const targets = dates.flatMap((date) => typeof date === "string" ? getTargetsForDate(date) : []);
    await syncProfitLossTargets(workspaceId, targets);
}
export async function generateProfitLossStatement(workspaceId: string, opts: {
    periodType: ProfitLossPeriodType;
    periodKey: string;
    force?: boolean;
}): Promise<ProfitLossStatement> {
    await ensureIndependentWorkspace(workspaceId);
    const descriptor = getDescriptorFromKey(opts.periodType, opts.periodKey);
    const existing = await loadExistingStatement(workspaceId, descriptor);
    if (!opts.force && existing && existing.meta.stale === false) {
        return existing;
    }
    // Load only the entries and expenses that fall within this specific period
    // rather than scanning the entire workspace history.
    const data = await loadWorkspaceFinancialDataForPeriod(workspaceId, descriptor);
    const statement = await materializeStatementForDescriptor(workspaceId, descriptor, data);
    if (!statement) {
        return buildStatement(workspaceId, descriptor, [], [], existing?.meta.version ?? 0);
    }
    await syncRollupAncestors(workspaceId, descriptor);
    return statement;
}
export async function listProfitLossStatements(workspaceId: string, periodType: ProfitLossPeriodType, opts?: {
    ensureFresh?: boolean;
}): Promise<ProfitLossStatement[]> {
    await ensureIndependentWorkspace(workspaceId);

    // Read the statement collection directly instead of scanning all expenses and
    // entries to derive the period list. syncProfitLossForFinancialDates is called
    // on every expense and entry mutation, which guarantees a statement document
    // exists for every period that contains data. The statement collection is
    // therefore a reliable, low-cost period index.
    //
    // The collection holds at most one small document per (periodType × periodKey)
    // combination — roughly 50 documents for a 3-year user across monthly,
    // quarterly, and annual views. In-memory filtering by periodType is cheaper
    // than a compound Firestore index query on a bounded set this size.
    const snap = await db
        .collection(`workspaces/${workspaceId}/profitLossStatements`)
        .get();

    if (snap.empty) return [];

    const byPeriodType: ProfitLossStatement[] = [];
    for (const doc of snap.docs) {
        const parsed = ProfitLossStatementSchema.safeParse({ id: doc.id, ...doc.data() });
        if (!parsed.success) continue;
        if (parsed.data.periodType !== periodType) continue;
        byPeriodType.push(parsed.data);
    }

    if (byPeriodType.length === 0) return [];

    // Re-materialize any statements that are marked stale (a concurrent mutation
    // set stale: true before its own re-generation completed). All others are
    // returned as-is — their data was written correctly by syncProfitLossForFinancialDates
    // at mutation time and has not changed since.
    //
    // Stale re-materializations are independent of each other, so run them in
    // parallel. In the common case there are zero stale statements and this is
    // just a synchronous filter + map.
    const settled = await Promise.all(
        byPeriodType.map(async (statement): Promise<ProfitLossStatement | null> => {
            if (!statement.meta.stale) return statement;
            const descriptor = getDescriptorFromKey(periodType, statement.periodKey);
            const data = await loadWorkspaceFinancialDataForPeriod(workspaceId, descriptor);
            return materializeStatementForDescriptor(workspaceId, descriptor, data);
        })
    );
    const results = settled.filter((s): s is ProfitLossStatement => s !== null);

    return ProfitLossStatementListSchema.parse(
        results.sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    );
}
export async function generateDueProfitLossStatementsForWorkspace(workspaceId: string, now = DateTime.now().setZone(DEFAULT_TIME_ZONE)) {
    await ensureIndependentWorkspace(workspaceId);
    const due: Array<{
        periodType: ProfitLossPeriodType;
        periodKey: string;
    }> = [];
    const previousMonth = now.minus({ months: 1 }).startOf("month");
    due.push({
        periodType: "month",
        periodKey: previousMonth.toFormat("yyyy-MM"),
    });
    if (now.month === 1 || now.month === 4 || now.month === 7 || now.month === 10) {
        const previousQuarter = now.minus({ quarters: 1 }).startOf("quarter");
        const quarterNumber = Math.ceil(previousQuarter.month / 3);
        due.push({
            periodType: "quarter",
            periodKey: `${previousQuarter.toFormat("yyyy")}-Q${quarterNumber}`,
        });
    }
    if (now.month === 1) {
        due.push({
            periodType: "year",
            periodKey: now.minus({ years: 1 }).toFormat("yyyy"),
        });
    }
    for (const item of due) {
        await generateProfitLossStatement(workspaceId, {
            periodType: item.periodType,
            periodKey: item.periodKey,
            force: false,
        });
    }
}
