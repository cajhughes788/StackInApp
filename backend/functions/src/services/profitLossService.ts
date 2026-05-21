import { DateTime } from "luxon";
import { db } from "../admin";
import { aggregateIndependentPnL } from "@shared/pnlService";
import { getCpaExpenseCategory } from "@shared/expenseCategories";
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
        const key = getCpaExpenseCategory(expense.account ?? "Uncategorized");
        const current = expenseByCategoryMap.get(key) ?? { items: [] };
        current.items.push({
            id: expense.id,
            date: expense.date,
            label: expense.vendor || expense.description || key,
            description: expense.vendor && expense.description
                ? expense.description
                : expense.account ?? null,
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
async function loadWorkspaceFinancialData(workspaceId: string): Promise<{
    entries: EntryType[];
    expenses: ExpenseType[];
}> {
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
function buildCompletedPeriods(periodType: ProfitLossPeriodType, entries: EntryType[], expenses: ExpenseType[], now = DateTime.now().setZone(DEFAULT_TIME_ZONE)): PeriodDescriptor[] {
    const sourceDates = [
        ...entries.map((entry) => normalizeDate(entry.date)),
        ...expenses.map((expense) => normalizeDate(expense.date)),
    ].filter((dt) => dt.isValid);
    if (sourceDates.length === 0)
        return [];
    const firstSource = sourceDates.reduce((min, current) => current.toMillis() < min.toMillis() ? current : min);
    const lastCompletedEnd = getLastCompletedPeriodEnd(periodType, now);
    if (firstSource.toMillis() > lastCompletedEnd.toMillis())
        return [];
    const periods: PeriodDescriptor[] = [];
    let cursor = periodType === "month"
        ? firstSource.startOf("month")
        : periodType === "quarter"
            ? firstSource.startOf("quarter")
            : firstSource.startOf("year");
    while (cursor.toMillis() <= lastCompletedEnd.toMillis()) {
        periods.push(getPeriodDescriptor(periodType, cursor));
        cursor =
            periodType === "month"
                ? cursor.plus({ months: 1 })
                : periodType === "quarter"
                    ? cursor.plus({ quarters: 1 })
                    : cursor.plus({ years: 1 });
    }
    return periods.reverse();
}
function buildStatement(workspaceId: string, descriptor: PeriodDescriptor, entries: EntryType[], expenses: ExpenseType[], previousVersion = 0): ProfitLossStatement {
    const income = aggregateIndependentPnL(entries).income;
    const incomeCategories = buildIncomeCategories(entries);
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
            services: roundCurrency(income.services),
            tips: roundCurrency(income.tips),
            products: roundCurrency(income.products),
            other: roundCurrency(income.other),
            total: roundCurrency(income.total),
            categories: incomeCategories,
        },
        expenses: {
            byCategory,
            total: totalExpenses,
        },
        netProfit: roundCurrency(income.total - totalExpenses),
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
export async function generateProfitLossStatement(workspaceId: string, opts: {
    periodType: ProfitLossPeriodType;
    periodKey: string;
    force?: boolean;
}): Promise<ProfitLossStatement> {
    await ensureIndependentWorkspace(workspaceId);
    const descriptor = getDescriptorFromKey(opts.periodType, opts.periodKey);
    const { entries, expenses } = await loadWorkspaceFinancialData(workspaceId);
    const entriesForPeriod = entries.filter((entry) => entry.date >= descriptor.periodStart && entry.date <= descriptor.periodEnd);
    const expensesForPeriod = expenses.filter((expense) => expense.date >= descriptor.periodStart && expense.date <= descriptor.periodEnd);
    const existingSnap = await db
        .doc(`workspaces/${workspaceId}/profitLossStatements/${descriptor.id}`)
        .get();
    const existingParsed = existingSnap.exists
        ? ProfitLossStatementSchema.safeParse({ id: existingSnap.id, ...existingSnap.data() })
        : null;
    const existing = existingParsed?.success ? existingParsed.data : null;
    if (!opts.force && existing) {
        return existing;
    }
    const statement = buildStatement(workspaceId, descriptor, entriesForPeriod, expensesForPeriod, existing?.meta.version ?? 0);
    return upsertStatement(workspaceId, statement);
}
export async function listProfitLossStatements(workspaceId: string, periodType: ProfitLossPeriodType, opts?: {
    ensureFresh?: boolean;
}): Promise<ProfitLossStatement[]> {
    await ensureIndependentWorkspace(workspaceId);
    const { entries, expenses } = await loadWorkspaceFinancialData(workspaceId);
    const periods = buildCompletedPeriods(periodType, entries, expenses);
    if (periods.length === 0)
        return [];
    const statements: ProfitLossStatement[] = [];
    for (const descriptor of periods) {
        const entriesForPeriod = entries.filter((entry) => entry.date >= descriptor.periodStart && entry.date <= descriptor.periodEnd);
        const expensesForPeriod = expenses.filter((expense) => expense.date >= descriptor.periodStart && expense.date <= descriptor.periodEnd);
        const existingSnap = await db
            .doc(`workspaces/${workspaceId}/profitLossStatements/${descriptor.id}`)
            .get();
        const existingParsed = existingSnap.exists
            ? ProfitLossStatementSchema.safeParse({ id: existingSnap.id, ...existingSnap.data() })
            : null;
        const existing = existingParsed?.success ? existingParsed.data : null;
        if (existing) {
            statements.push(existing);
            continue;
        }
        const rebuilt = buildStatement(workspaceId, descriptor, entriesForPeriod, expensesForPeriod, 0);
        await upsertStatement(workspaceId, rebuilt);
        statements.push(rebuilt);
    }
    const parsed = ProfitLossStatementListSchema.parse(statements);
    return parsed.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
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
