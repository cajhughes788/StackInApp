"use client";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { RecurringRuleSchema } from "@shared/schemas/recurringRule";
import { getRecurringRulesForWorkspace } from "@/lib/api";
import * as domainRecurringRules from "@/lib/storage/domainRecurringRules";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";

// Mirrors expenseRepository.ts's read-cache / fetch-backend / ensureLoaded
// split, minus period scoping (recurring rules are one list per workspace).

export type RecurringRulesLoadResult = {
  data: any[];
  lastSuccessfulSyncAt: number | null;
};

const inFlightLoads = new Map<WorkspaceId, Promise<RecurringRulesLoadResult>>();

export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<RecurringRulesLoadResult> {
  const cached = await domainRecurringRules.readRecurringRulesCacheRecord(workspaceId);
  return {
    data: cached?.data ?? [],
    lastSuccessfulSyncAt: cached?.lastSuccessfulSyncAt ?? null,
  };
}

export async function fetchBackend(workspaceId: WorkspaceId): Promise<RecurringRulesLoadResult> {
  const backend = await getRecurringRulesForWorkspace(workspaceId);
  const parsed = safeSchemaParse(RecurringRuleSchema.array(), backend);
  const data = parsed.success ? parsed.data : [];
  const syncedAt = Date.now();
  await domainRecurringRules.setRecurringRulesForWorkspace(workspaceId, data, {
    lastSuccessfulSyncAt: syncedAt,
  });
  return { data, lastSuccessfulSyncAt: syncedAt };
}

export async function ensureLoaded(workspaceId: WorkspaceId): Promise<RecurringRulesLoadResult> {
  const existing = inFlightLoads.get(workspaceId);
  if (existing) return existing;

  const task = fetchBackend(workspaceId);
  inFlightLoads.set(workspaceId, task);
  try {
    return await task;
  } finally {
    inFlightLoads.delete(workspaceId);
  }
}
