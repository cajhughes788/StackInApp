// storage/domainRecurringRules.ts
// ------------------------------------------------------------
// Domain-level storage for RECURRING RULES.
// ------------------------------------------------------------
// Unlike expenses/entries this is NOT period-scoped — one list per
// workspace. It also only needs to support offline *viewing*: rule
// mutations require connectivity (see lib/domain/recurringRulesService.ts),
// so there is no optimistic/tempId reconciliation to handle here, just a
// read-through cache kept in sync with the last successful backend fetch.
// ------------------------------------------------------------
import { getWithMeta, setWithMeta, clearKeysWithMeta } from "./metadata";
import { RecurringRuleSchema } from "@shared/schemas/recurringRule";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import { CACHE_VERSIONS } from "./cacheVersions";

export type RecurringRulesCacheRecord = {
    data: any[];
    lastSuccessfulSyncAt: number | null;
};

const PREFIX = "recurringRules"; // final key: "recurringRules:{workspaceId}"

function makeKey(workspaceId: string): string {
    return `${PREFIX}:${workspaceId}`;
}

export async function readRecurringRulesCacheRecord(
    workspaceId: string
): Promise<RecurringRulesCacheRecord | null> {
    const key = makeKey(workspaceId);
    const rec = await getWithMeta<{ rules: any[]; lastSuccessfulSyncAt: number | null }>(key, {
        expectedVersion: CACHE_VERSIONS.recurringRules,
    });
    if (!rec?.data) return null;
    const parsed = safeSchemaParse(RecurringRuleSchema.array(), rec.data.rules ?? []);
    return {
        data: parsed.success ? parsed.data : [],
        lastSuccessfulSyncAt: rec.data.lastSuccessfulSyncAt ?? null,
    };
}

export async function setRecurringRulesForWorkspace(
    workspaceId: string,
    rules: any[],
    options: { lastSuccessfulSyncAt?: number | null } = {}
): Promise<void> {
    const key = makeKey(workspaceId);
    await setWithMeta(
        key,
        { rules, lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? Date.now() },
        { ttlMs: Infinity, version: CACHE_VERSIONS.recurringRules }
    );
}

export async function clearWorkspace(workspaceId: string): Promise<void> {
    await clearKeysWithMeta((candidate) => candidate === makeKey(workspaceId));
}

export async function clearAll(): Promise<void> {
    await clearKeysWithMeta((key) => key.startsWith(`${PREFIX}:`));
}
