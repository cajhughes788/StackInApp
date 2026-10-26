// /functions/src/services/allIncomeService.ts
// Gathers one month's income for every active workspace the user belongs
// to; the combining math lives in @shared/allIncome.
import { db } from "../admin";
import { getSettings } from "./settingsService";
import { generateProfitLossStatement } from "./profitLossService";
import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge";
import { EntrySchema, type EntryType } from "@shared/schemas/entry";
import { listActiveWorkspaces, type ActiveWorkspace } from "../lib/userWorkspaces";
import {
    buildAllIncomeSummary,
    monthDateRange,
    previousMonthKey,
    sumIndependentUnreportedCash,
    type AllIncomeSummary,
    type AllIncomeWorkspaceMonth,
} from "@shared/allIncome";


async function loadMonthEntries(workspaceId: string, month: string): Promise<EntryType[]> {
    const { start, end } = monthDateRange(month);
    const snap = await db
        .collection(`workspaces/${workspaceId}/entries`)
        .where("date", ">=", start)
        .where("date", "<=", end)
        .get();
    return snap.docs.flatMap((doc) => {
        const parsed = EntrySchema.safeParse({ id: doc.id, ...doc.data() });
        return parsed.success ? [parsed.data] : [];
    });
}

async function loadWorkspaceMonth(
    workspace: ActiveWorkspace,
    uid: string,
    month: string,
    includeUnreported: boolean
): Promise<AllIncomeWorkspaceMonth> {
    const base = { workspaceId: workspace.id, name: workspace.name, type: workspace.type };

    if (workspace.type === "w2") {
        const entries = await loadMonthEntries(workspace.id, month);
        const { incomeGauge } = computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: includeUnreported });
        return { ...base, income: incomeGauge, expenses: null };
    }

    // Returns the saved statement when it's fresh and rebuilds it when it's
    // missing or marked stale, so a failed sync never shows a wrong number.
    const [statement, unreportedCash] = await Promise.all([
        generateProfitLossStatement(workspace.id, uid, { periodType: "month", periodKey: month }),
        includeUnreported
            ? loadMonthEntries(workspace.id, month).then(sumIndependentUnreportedCash)
            : Promise.resolve(0),
    ]);
    return {
        ...base,
        income: statement.income.total + unreportedCash,
        expenses: statement.expenses.total,
    };
}

export async function getAllIncomeSummary(uid: string, month: string): Promise<AllIncomeSummary> {
    const workspaces = await listActiveWorkspaces(uid);
    const previousMonth = previousMonthKey(month);

    const results = await Promise.all(
        workspaces.map(async (workspace) => {
            const { settings } = await getSettings(workspace.id, uid);
            const includeUnreported =
                (workspace.type === "w2"
                    ? settings?.w2?.includeUnreportedInUI
                    : settings?.independent?.includeUnreportedInUI) ?? false;
            const [current, previous] = await Promise.all([
                loadWorkspaceMonth(workspace, uid, month, includeUnreported),
                loadWorkspaceMonth(workspace, uid, previousMonth, includeUnreported),
            ]);
            return { current, previous };
        })
    );

    return buildAllIncomeSummary({
        month,
        current: results.map((r) => r.current),
        previous: results.map((r) => r.previous),
    });
}
