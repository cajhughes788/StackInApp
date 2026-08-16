"use client"

// ------------------------------------------------------------
// Frontend Domain Layer for Recurring Rules
// ------------------------------------------------------------
// Deliberately NOT offline-first, unlike expenseService.ts/entryService.ts:
// rule mutations (create/edit/delete/pause) require connectivity and show a
// toast instead of queuing — see the "no offline-queue integration" scope
// decision in the recurring-expenses plan. Viewing the cached rules list
// still works offline via useRecurringRulesStore's hydrateFromCacheOnce.
//
// On create, the backend generates the first occurrence's real
// expense/entry atomically (same request) when the rule is due today or
// earlier. That generated record is pushed straight into
// useExpensesStore/useEntriesStore as canonical here, so it shows up in the
// grid immediately with no separate network round trip.
// ------------------------------------------------------------

import type { WorkspaceId } from "@shared/contracts/workspace"

import {
  postRecurringRule,
  patchRecurringRule,
  deleteRecurringRuleAPI,
} from "@/lib/api"
import { getIsOnline } from "@/lib/network/status"
import { toast } from "@/hooks/use-toast"
import { useRecurringRulesStore } from "@/lib/stores/useRecurringRulesStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import * as domainExpenses from "@/lib/storage/domainExpenses"
import { persistEntriesForPeriod } from "@/lib/domain/entriesService"

const OFFLINE_TOAST = {
  title: "Connect to the internet",
  description: "Recurring rules can only be created, edited, or deleted while online.",
  variant: "destructive" as const,
}

function assertOnlineOrToast(): boolean {
  if (getIsOnline()) return true
  toast(OFFLINE_TOAST)
  return false
}

export async function createRecurringRule(workspaceId: WorkspaceId, rawInput: any) {
  if (!assertOnlineOrToast()) {
    throw new Error("Offline — recurring rule not created")
  }

  const res = await postRecurringRule(workspaceId, rawInput)

  useRecurringRulesStore.getState().addRule(workspaceId, res.rule)

  // A recurring rule's first occurrence can land in a period the user isn't
  // currently viewing (e.g. a backdated anchor date in a past month). The
  // Zustand store updates below are in-memory only and silently no-op when
  // the currently-loaded period doesn't match — so without also persisting
  // to IndexedDB here (matching what the normal create-expense/create-entry
  // flows always do), the generated record would be invisible until a
  // 5-minute TTL forces a fresh backend refetch of that period.
  if (res.generatedExpense) {
    const scopedPeriodKey = `${workspaceId}::${res.generatedExpense.periodId}`
    await domainExpenses.saveExpense(scopedPeriodKey, res.generatedExpense)
    useExpensesStore.getState().addExpense(workspaceId, res.generatedExpense)
  }
  if (res.generatedEntry) {
    const periodId = res.generatedEntry.periodId
    const scopedKey = `${workspaceId}::${periodId}`
    await persistEntriesForPeriod(workspaceId, periodId, scopedKey, (entries) => [
      res.generatedEntry,
      ...entries.filter((entry: any) => entry.id !== res.generatedEntry.id),
    ])
  }

  return res
}

export async function updateRecurringRule(
  workspaceId: WorkspaceId,
  ruleId: string,
  patch: any
) {
  if (!assertOnlineOrToast()) {
    throw new Error("Offline — recurring rule not updated")
  }

  const res = await patchRecurringRule(workspaceId, ruleId, patch)
  useRecurringRulesStore.getState().replaceRule(workspaceId, ruleId, res.rule)
  return res
}

export async function setRecurringRuleActive(
  workspaceId: WorkspaceId,
  ruleId: string,
  active: boolean
) {
  return updateRecurringRule(workspaceId, ruleId, { active })
}

export async function deleteRecurringRule(workspaceId: WorkspaceId, ruleId: string) {
  if (!assertOnlineOrToast()) {
    throw new Error("Offline — recurring rule not deleted")
  }

  await deleteRecurringRuleAPI(workspaceId, ruleId)
  useRecurringRulesStore.getState().removeRule(workspaceId, ruleId)
}
