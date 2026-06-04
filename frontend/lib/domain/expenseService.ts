"use client"

// /lib/domain/expensesService.ts
// ------------------------------------------------------------
// Frontend Domain Layer for Expenses (FINAL ARCHITECTURE)
// ------------------------------------------------------------
//
// Responsibilities:
// • Accept raw input from UI
// • Auto-derive periodId from date (YYYY-MM)
// • Build optimistic expense object with tempId
// • Insert optimistic expense into period-scoped cache (domainExpenses)
// • If offline → enqueue mutation (offlineQueue)
// • If online  → send rawInput + clientMutationId → backend
// • On backend response → replace optimistic with canonical
//
// ------------------------------------------------------------

import * as domainExpenses from "@/lib/storage/domainExpenses"
import * as offlineQueue from "@/lib/storage/offlineQueue"
import { clearReceiptMediaForAsset } from "@/lib/storage/receiptAssetsCache"
import * as expenseRepository from "@/lib/domain/expenseRepository"

import {
  postExpense,
  editExpense,
  deleteExpenseAPI,
} from "@/lib/api"
import { getIsOnline } from "@/lib/network/status"
import { toast } from "@/hooks/use-toast"
import { createProfileTrace } from "@/lib/observability/profileTrace"
import {
  makeTraceId,
  trace as diagTrace,
  traceCacheWrite,
  traceStoreUpdate,
  traceQueueAdd,
  traceApiRequest,
  traceApiResponse,
  traceApiFailure,
  traceReconciliation,
} from "@/lib/diagnostics/trace"
import { v4 as uuid } from "uuid"
import type { WorkspaceId } from "@shared/contracts/workspace"

// Store import
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
import * as profitLossService from "@/lib/domain/profitLossService"
function invalidateProfitLossView(workspaceId: WorkspaceId) {
  void profitLossService.invalidate(workspaceId).catch(() => {})
}
async function reconcileOptimisticExpenseUpdate(
  workspaceId: WorkspaceId,
  expenseId: string,
  patch: any
) {
  const res = await editExpense(workspaceId, expenseId, patch)

  if (!res.ok) throw new Error(res.error || "Update failed")

  const canonical = {
    ...res.expense,
    id: res.id ?? expenseId,
  }

  await domainExpenses.saveExpense(
    `${workspaceId}::${canonical.periodId}`,
    canonical
  )

  useExpensesStore.getState().replaceExpense(
    workspaceId,
    expenseId,
    canonical
  )
  invalidateProfitLossView(workspaceId)

  return canonical
}
// ------------------------------------------------------------
// CREATE EXPENSE (Revised Flow - Zustand First)
// ------------------------------------------------------------
export async function createExpense(
  workspaceId: WorkspaceId,
  rawInput: any
) {
  const parsed = rawInput
  const diagTraceId = makeTraceId("expense_create")
  diagTrace({
    category: "expenses",
    layer: "store",
    event: "EXPENSE_CREATE",
    phase: "initiated",
    traceId: diagTraceId,
    data: { workspaceId, date: parsed?.date, periodId: parsed?.periodId, hasReceipt: Boolean(parsed?.receiptAssetId) },
    level: "normal",
  })
  const trace = createProfileTrace("expense_create", {
    workspaceId,
    periodId: typeof parsed?.periodId === "string" ? parsed.periodId : null,
    date: typeof parsed?.date === "string" ? parsed.date : null,
    account: typeof parsed?.account === "string" ? parsed.account : null,
    hasReceiptAssetId:
      typeof parsed?.receiptAssetId === "string" && parsed.receiptAssetId.length > 0,
    hasReceiptAnalysisId:
      typeof parsed?.receiptAnalysisId === "string" && parsed.receiptAnalysisId.length > 0,
    hasAllocations: Array.isArray(parsed?.allocations) && parsed.allocations.length > 0,
  })
  const scopedPeriodId = `${workspaceId}::${parsed.periodId}`
  const tempId = `tmp-${uuid()}`
  const clientMutationId =
    typeof parsed?.clientMutationId === "string" && parsed.clientMutationId.length > 0
      ? parsed.clientMutationId
      : uuid()
  const nowIso = new Date().toISOString()

  // 1. Build optimistic object
  const optimistic = {
    tempId,
    clientMutationId,
    workspaceId,
    createdAtLocal: parsed.createdAtLocal ?? nowIso,
    updatedAtLocal: parsed.updatedAtLocal ?? nowIso,
    ...parsed,
  }

  // 2. IMMEDITATELY update Zustand store
  useExpensesStore.getState().addExpense(workspaceId, optimistic)
  traceStoreUpdate("expenses", diagTraceId, "EXPENSE_CREATE", { phase: "optimistic_update", expenseId: tempId, scopedPeriodId })
  trace.mark("expense.optimistic_added", {
    tempId,
    scopedPeriodId,
  })

  // 3. Save optimistic to IndexedDB (append style)
  await domainExpenses.saveExpense(scopedPeriodId, optimistic)
  traceCacheWrite("expenses", diagTraceId, "optimistic_write", { expenseId: tempId, scopedPeriodId })
  trace.mark("expense.cache_saved", {
    tempId,
    scopedPeriodId,
  })

  // 4. IF OFFLINE → queue + return optimistic
  if (!getIsOnline()) {
    await offlineQueue.enqueue({
      id: tempId,
      ts: Date.now(),
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
      method: "POST",
      body: { ...parsed, clientMutationId },
    })
    traceQueueAdd("expenses", diagTraceId, { expenseId: tempId, method: "POST", reason: "offline" })

    trace.mark("expense.offline_queued", {
      tempId,
      scopedPeriodId,
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
    })

    return optimistic
  }

  try {
    invalidateProfitLossView(workspaceId)
    // 5. ONLINE → POST to backend
    traceApiRequest("expenses", diagTraceId, { expenseId: tempId, endpoint: `/api/workspaces/${workspaceId}/expenses`, method: "POST" })
    trace.start("expense.network_create", {
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
      tempId,
    })
    const res = await postExpense(workspaceId, {
      ...parsed,
      clientMutationId,
    })
    trace.end("expense.network_create", {
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
      tempId,
      returnedId: res.id ?? null,
    })

    if (!res.ok) throw new Error(res.error || "Create expense failed")

    // 6. Build canonical
    const canonical = {
      ...res.expense,
      id: res.id ?? tempId,
    }

    traceApiResponse("expenses", diagTraceId, { expenseId: canonical.id, optimisticId: tempId })

    // 7. Replace in IndexedDB
    await domainExpenses.replaceExpense(scopedPeriodId, tempId, canonical)
    traceCacheWrite("expenses", diagTraceId, "canonical_write", { expenseId: canonical.id, optimisticId: tempId, scopedPeriodId })
    trace.mark("expense.cache_replaced_canonical", {
      tempId,
      canonicalId: canonical.id,
      scopedPeriodId,
    })

    // 8. Update Zustand store (replace optimistic)
    useExpensesStore.getState().replaceExpense(workspaceId, tempId, canonical)
    traceReconciliation("expenses", diagTraceId, "optimistic_replaced_canonical", { optimisticId: tempId, canonicalId: canonical.id })
    invalidateProfitLossView(workspaceId)
    trace.mark("expense.optimistic_reconciled", {
      tempId,
      canonicalId: canonical.id,
      scopedPeriodId,
      hasReceiptAssetId:
        typeof canonical?.receiptAssetId === "string" && canonical.receiptAssetId.length > 0,
      hasReceiptAnalysisId:
        typeof canonical?.receiptAnalysisId === "string" &&
        canonical.receiptAnalysisId.length > 0,
    })

    return canonical
  } catch (error) {
    traceApiFailure("expenses", diagTraceId, error, { expenseId: tempId, scopedPeriodId })
    trace.error("expense.create_failed", error, {
      tempId,
      scopedPeriodId,
    })
    useExpensesStore.getState().removeExpense(workspaceId, tempId)
    traceReconciliation("expenses", diagTraceId, "rollback_applied", { expenseId: tempId, reason: "api_failure" })
    await domainExpenses.deleteExpense(scopedPeriodId, tempId)
    trace.mark("expense.optimistic_removed", {
      tempId,
      scopedPeriodId,
    })
    throw error
  }
}
// ------------------------------------------------------------
// UPDATE EXPENSE (Simplified - No List Loading)
// ------------------------------------------------------------
export async function updateExpense(
  workspaceId: WorkspaceId,
  expenseId: string,
  patch: any
) {
  const diagTraceId = makeTraceId("expense_update")
  diagTrace({ category: "expenses", layer: "store", event: "EXPENSE_UPDATE", phase: "initiated", traceId: diagTraceId, data: { workspaceId, expenseId }, level: "normal" })
  // 1. Get the ONE expense directly from Zustand
  const existing = useExpensesStore.getState().getExpense(
    workspaceId,
    expenseId
  )
  if (!existing) throw new Error("Expense not found locally")

  // 2. Merge existing + patch to get full updated shape
  const rawMerged = { ...existing, ...patch }
  const nowIso = new Date().toISOString()

  const optimistic = {
    ...rawMerged,
    workspaceId,
    updatedAtLocal: patch.updatedAtLocal ?? nowIso,
  }
  const scopedPeriodId = `${workspaceId}::${optimistic.periodId}`

  // 3. Update Zustand (instant UI)
  useExpensesStore.getState().replaceExpense(
    workspaceId,
    expenseId,
    optimistic
  )
  traceStoreUpdate("expenses", diagTraceId, "EXPENSE_UPDATE", { phase: "optimistic_mutation", expenseId })

  // 4. Update IndexedDB (single expense write)
  await domainExpenses.saveExpense(scopedPeriodId, optimistic)
  traceCacheWrite("expenses", diagTraceId, "optimistic_write", { expenseId, scopedPeriodId })

  // 5. If offline → queue and return optimistic
  if (!getIsOnline()) {
    await offlineQueue.enqueue({
      id: expenseId,
      ts: Date.now(),
      endpoint: `/api/workspaces/${workspaceId}/expenses/${expenseId}`,
      method: "PATCH",
      body: { ...patch },
    })
    traceQueueAdd("expenses", diagTraceId, { expenseId, method: "PATCH", reason: "offline" })

    return optimistic
  }
  invalidateProfitLossView(workspaceId)
  traceApiRequest("expenses", diagTraceId, { expenseId, method: "PATCH", endpoint: `/api/workspaces/${workspaceId}/expenses/${expenseId}` })

  void reconcileOptimisticExpenseUpdate(workspaceId, expenseId, patch).catch((error) => {
    traceReconciliation("expenses", diagTraceId, "rollback_applied", { expenseId, reason: "api_failure" })
    // Restore the pre-edit value and notify the user.
    useExpensesStore.getState().replaceExpense(workspaceId, expenseId, existing)
    void domainExpenses.saveExpense(`${workspaceId}::${existing.periodId}`, existing).catch(() => {})
    toast({
      title: "Expense update failed",
      description: "Your change could not be saved. The previous value has been restored.",
      variant: "destructive",
    })
  })

  return optimistic
}
// ------------------------------------------------------------
// DELETE EXPENSE
// ------------------------------------------------------------
export async function deleteExpense(
  workspaceId: WorkspaceId,
  expenseId: string
) {
  const diagTraceId = makeTraceId("expense_delete")
  diagTrace({ category: "expenses", layer: "store", event: "EXPENSE_DELETE", phase: "initiated", traceId: diagTraceId, data: { workspaceId, expenseId }, level: "normal" })
  // 1. Get the expense directly from Zustand
  const existing = useExpensesStore.getState().getExpense(
    workspaceId,
    expenseId
  )
  if (!existing) throw new Error("Expense not found locally")

  const scopedPeriodId = `${workspaceId}::${existing.periodId}`
  const relatedReceiptDrafts = existing.receiptAssetId
    ? (
        useReceiptDraftsStore.getState().byWorkspaceId[workspaceId]?.drafts ?? []
      ).filter((draft) => draft.receiptAssetId === existing.receiptAssetId)
    : []

  // 2. Remove from Zustand immediately (instant UI)
  useExpensesStore.getState().removeExpense(workspaceId, expenseId)
  traceStoreUpdate("expenses", diagTraceId, "EXPENSE_DELETE", { phase: "optimistic_removal", expenseId })

  // 3. Remove from IndexedDB immediately
  await domainExpenses.deleteExpense(scopedPeriodId, expenseId)

  if (existing.receiptAssetId) {
    useReceiptDraftsStore
      .getState()
      .removeDraftsForReceiptAsset(workspaceId, existing.receiptAssetId)
    await clearReceiptMediaForAsset(workspaceId, existing.receiptAssetId)
  }

  // 4. If offline — queue delete + return
  if (!getIsOnline()) {
    // Phase 6: if the expense was never synced (still has a tempId), cancel the
    // pending create and any pending edits instead of queueing a delete that
    // will 404 on replay. Removing POST + PATCH ensures no stale mutation for
    // this tempId reaches the backend, which would otherwise trigger a
    // misleading "Expense update failed" toast from the 404 PATCH rollback.
    if (typeof expenseId === "string" && expenseId.startsWith("tmp-")) {
      await offlineQueue.removeMatching(
        (m) => m.id === expenseId && (m.method === "POST" || m.method === "PATCH")
      )
      // Create and all edits cancel out — nothing to sync.
      return
    }

    await offlineQueue.enqueue({
      id: expenseId,
      ts: Date.now(),
      endpoint: `/api/workspaces/${workspaceId}/expenses/${expenseId}`,
      method: "DELETE",
      body: null,
    })

    return
  }

  // 5. Online — call backend delete
  try {
    invalidateProfitLossView(workspaceId)
    const res = await deleteExpenseAPI(workspaceId, expenseId)

    if (!res.ok) {
      throw new Error("Delete failed: " + (res.error || "unknown error"))
    }
  } catch (error) {
    // Phase 4: restore only the deleted expense — do not overwrite the full array,
    // which would clobber any expenses added concurrently during the network call.
    useExpensesStore.getState().addExpense(workspaceId, existing)
    await domainExpenses.saveExpense(scopedPeriodId, existing)

    for (const draft of relatedReceiptDrafts) {
      useReceiptDraftsStore.getState().applyDraft(workspaceId, draft)
    }

    throw error
  }

  // The optimistic delete already removed the expense from the Zustand store
  // (removeExpense) and from IndexedDB (domainExpenses.deleteExpense) before
  // the network call. The backend confirmed the delete. Both layers are in the
  // correct state — no post-delete refresh is needed. The TTL-based
  // revalidation (EXPENSES_BACKEND_TTL_MS) handles any concurrent changes from
  // other devices in the normal background cycle.
}
