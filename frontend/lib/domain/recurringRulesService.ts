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
// createRecurringRule's INCOME branch (recurring revenue) is optimistic
// local-write + background network reconciliation, mirroring
// entriesService.createEntry's architecture: build the rule (and, if due
// today, its first generated entry) locally with a temp id, push straight
// into the stores, and return immediately — the POST fires in the
// background and reconciles (or rolls back) when it resolves. The EXPENSE
// branch is untouched: it still awaits the network call directly before
// updating anything, same as before.
// ------------------------------------------------------------

import type { WorkspaceId } from "@shared/contracts/workspace"
import { computeEntry } from "@shared/computeEntry"
import { getCurrentEntryPeriod } from "@shared/payPeriods"
import { computeNextOccurrence } from "@shared/recurringSchedule"
import { v4 as uuid } from "uuid"

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
import * as settingsService from "@/lib/domain/settingsService"

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

// Mirrors backend/functions/src/services/recurringRulesService.ts's
// SOURCE_TO_PAYMENT_METHOD — kept in sync manually since the frontend needs
// it to preview the generated entry's totals before the backend responds.
const SOURCE_TO_PAYMENT_METHOD: Record<string, string> = {
  venmo: "venmo",
  appleCash: "apple_cash",
  zelle: "zelle",
  posSales: "pos",
  cashSales: "cash",
  custom: "other",
}

// Builds the same shape entriesService.createEntry's optimistic path would
// produce for a manually-entered income row with this template's values, so
// a recurring rule that's due today populates the ledger instantly instead
// of waiting on the backend's atomic rule+occurrence generation.
function buildOptimisticIncomeEntry(settings: any, rawInput: any, nowIso: string) {
  const { source, category, amount, label } = rawInput.incomeTemplate
  const paymentMethod = SOURCE_TO_PAYMENT_METHOD[source] ?? "other"
  const occurrenceDate = rawInput.anchorDate
  const notes = rawInput.notes ?? ""
  const independent = {
    hours: 0,
    incomeBreakdowns: [{ paymentMethod, [category]: amount }],
    unreportedCash: 0,
    unreportedCashTips: 0,
    customIncome: source === "custom" && label ? [{ label, amount, category }] : [],
  }
  const totals = computeEntry({ workspace: "independent", date: occurrenceDate, independent }, settings)
  const periodId = getCurrentEntryPeriod(settings, "independent", occurrenceDate).periodId
  const entry = {
    id: `tmp-${uuid()}`,
    syncState: "pending" as const,
    workspace: "independent" as const,
    periodId,
    date: occurrenceDate,
    notes,
    createdAtLocal: nowIso,
    updatedAtLocal: nowIso,
    independent,
    totals: { ...totals, totalHours: 0 },
  }
  return { entry, periodId }
}

async function reconcileOptimisticRecurringRule(
  workspaceId: WorkspaceId,
  rawInput: any,
  tempRuleId: string,
  tempEntryId: string | null,
  optimisticPeriodId: string | null,
  optimisticScopedKey: string | null
) {
  try {
    const res = await postRecurringRule(workspaceId, rawInput)
    useRecurringRulesStore.getState().replaceRule(workspaceId, tempRuleId, res.rule)

    if (res.generatedEntry) {
      const canonicalPeriodId = res.generatedEntry.periodId
      const canonicalScopedKey = `${workspaceId}::${canonicalPeriodId}`
      await persistEntriesForPeriod(workspaceId, canonicalPeriodId, canonicalScopedKey, (entries) => [
        res.generatedEntry,
        ...entries.filter((entry: any) => entry.id !== tempEntryId && entry.id !== res.generatedEntry.id),
      ])
      // Our locally-guessed period can differ from the backend's (e.g. a
      // period-boundary edge case) — scrub the stale optimistic row out of
      // its original period too, since the write above only touched the
      // canonical one.
      if (tempEntryId && optimisticPeriodId && optimisticScopedKey && optimisticPeriodId !== canonicalPeriodId) {
        await persistEntriesForPeriod(workspaceId, optimisticPeriodId, optimisticScopedKey, (entries) =>
          entries.filter((entry: any) => entry.id !== tempEntryId)
        )
      }
    } else if (tempEntryId && optimisticPeriodId && optimisticScopedKey) {
      await persistEntriesForPeriod(workspaceId, optimisticPeriodId, optimisticScopedKey, (entries) =>
        entries.filter((entry: any) => entry.id !== tempEntryId)
      )
    }
  } catch (error) {
    useRecurringRulesStore.getState().removeRule(workspaceId, tempRuleId)
    if (tempEntryId && optimisticPeriodId && optimisticScopedKey) {
      await persistEntriesForPeriod(workspaceId, optimisticPeriodId, optimisticScopedKey, (entries) =>
        entries.filter((entry: any) => entry.id !== tempEntryId)
      )
    }
    toast({
      title: "Recurring income not saved",
      description: "We couldn't save your recurring income rule. Please try again.",
      variant: "destructive",
    })
  }
}

export async function createRecurringRule(workspaceId: WorkspaceId, rawInput: any) {
  if (!assertOnlineOrToast()) {
    throw new Error("Offline — recurring rule not created")
  }

  if (rawInput?.type !== "income") {
    // Expense rules keep the original network-awaited path — untouched.
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

  // Recurring revenue (income): optimistic local write, then reconcile in
  // the background — see module header.
  const settings = await settingsService.loadForWorkspace(workspaceId, false)
  if (!settings) {
    throw new Error("Settings required to create recurring rule")
  }

  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  const isDueNow = rawInput.anchorDate <= today
  const nextOccurrence = isDueNow
    ? computeNextOccurrence(rawInput.anchorDate, rawInput.cadence, rawInput.anchorDate)
    : rawInput.anchorDate

  const tempRuleId = `tmp-${uuid()}`
  const optimisticRule = {
    type: "income" as const,
    cadence: rawInput.cadence,
    anchorDate: rawInput.anchorDate,
    endDate: rawInput.endDate ?? null,
    notes: rawInput.notes ?? "",
    incomeTemplate: rawInput.incomeTemplate,
    id: tempRuleId,
    workspaceId,
    nextOccurrence,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  }

  useRecurringRulesStore.getState().addRule(workspaceId, optimisticRule)

  let optimisticEntry: any = null
  let entryPeriodId: string | null = null
  let entryScopedKey: string | null = null

  if (isDueNow) {
    const built = buildOptimisticIncomeEntry(settings, rawInput, nowIso)
    optimisticEntry = built.entry
    entryPeriodId = built.periodId
    entryScopedKey = `${workspaceId}::${entryPeriodId}`
    await persistEntriesForPeriod(workspaceId, entryPeriodId, entryScopedKey, (current) => [
      optimisticEntry,
      ...current,
    ])
  }

  void reconcileOptimisticRecurringRule(
    workspaceId,
    rawInput,
    tempRuleId,
    optimisticEntry?.id ?? null,
    entryPeriodId,
    entryScopedKey
  ).catch(() => {})

  return {
    id: tempRuleId,
    rule: optimisticRule,
    generatedExpense: null,
    generatedEntry: optimisticEntry,
  }
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
