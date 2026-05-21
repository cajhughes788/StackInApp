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
import { createProfileTrace } from "@/lib/observability/profileTrace"
import { v4 as uuid } from "uuid"
import type { WorkspaceId } from "@shared/contracts/workspace"

// Store import
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
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
  trace.mark("expense.optimistic_added", {
    tempId,
    scopedPeriodId,
  })
  // (You'll make addExpense in your store. Easy.)

  // 3. Save optimistic to IndexedDB (append style)
  await domainExpenses.saveExpense(scopedPeriodId, optimistic)
  trace.mark("expense.cache_saved", {
    tempId,
    scopedPeriodId,
  })
  // (You'll make saveExpense: write single expense not list)

  // 4. IF OFFLINE → queue + return optimistic
  if (!getIsOnline()) {
    await offlineQueue.enqueue({
      id: tempId,
      ts: Date.now(),
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
      method: "POST",
      body: { ...parsed, clientMutationId },
    })

    trace.mark("expense.offline_queued", {
      tempId,
      scopedPeriodId,
      endpoint: `/api/workspaces/${workspaceId}/expenses`,
    })

    return optimistic
  }

  try {
    // 5. ONLINE → POST to backend
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

    // 7. Replace in IndexedDB
    await domainExpenses.replaceExpense(scopedPeriodId, tempId, canonical)
    trace.mark("expense.cache_replaced_canonical", {
      tempId,
      canonicalId: canonical.id,
      scopedPeriodId,
    })

    // 8. Update Zustand store (replace optimistic)
    useExpensesStore.getState().replaceExpense(workspaceId, tempId, canonical)
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
    trace.error("expense.create_failed", error, {
      tempId,
      scopedPeriodId,
    })
    useExpensesStore.getState().removeExpense(workspaceId, tempId)
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

  // 4. Update IndexedDB (single expense write)
  await domainExpenses.saveExpense(scopedPeriodId, optimistic)

  // 5. If offline → queue and return optimistic
  if (!getIsOnline()) {
    await offlineQueue.enqueue({
      id: expenseId,
      ts: Date.now(),
      endpoint: `/api/workspaces/${workspaceId}/expenses/${expenseId}`,
      method: "PATCH",
      body: { ...patch },
    })

    return optimistic
  }

  void reconcileOptimisticExpenseUpdate(workspaceId, expenseId, patch).catch(
    (error) => {
    }
  )

  return optimistic
}
// ------------------------------------------------------------
// DELETE EXPENSE
// ------------------------------------------------------------
export async function deleteExpense(
  workspaceId: WorkspaceId,
  expenseId: string
) {
  // 1. Get the expense directly from Zustand
  const existing = useExpensesStore.getState().getExpense(
    workspaceId,
    expenseId
  )
  if (!existing) throw new Error("Expense not found locally")

  const scopedPeriodId = `${workspaceId}::${existing.periodId}`
  const previousExpenses =
    useExpensesStore.getState().byWorkspaceId[workspaceId]?.expenses ?? []
  const relatedReceiptDrafts = existing.receiptAssetId
    ? (
        useReceiptDraftsStore.getState().byWorkspaceId[workspaceId]?.drafts ?? []
      ).filter((draft) => draft.receiptAssetId === existing.receiptAssetId)
    : []

  // 2. Remove from Zustand immediately (instant UI)
  useExpensesStore.getState().removeExpense(workspaceId, expenseId)

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
    const res = await deleteExpenseAPI(workspaceId, expenseId)

    if (!res.ok) {
      throw new Error("Delete failed: " + (res.error || "unknown error"))
    }
  } catch (error) {
    useExpensesStore.getState().setExpenses(
      workspaceId,
      previousExpenses,
      existing.periodId
    )
    await domainExpenses.setExpensesForPeriod(scopedPeriodId, previousExpenses)

    for (const draft of relatedReceiptDrafts) {
      useReceiptDraftsStore.getState().applyDraft(workspaceId, draft)
    }

    throw error
  }

  if (typeof existing.periodId === "string" && existing.periodId.length > 0) {
    void expenseRepository
      .fetchBackend(workspaceId, existing.periodId)
      .then((result) => {
        const sanitizedExpenses = result.data.filter(
          (expense) => expense.id !== expenseId && expense.tempId !== expenseId
        )
        useExpensesStore
          .getState()
          .setExpenses(workspaceId, sanitizedExpenses, existing.periodId)
      })
      .catch(() => {
        // Keep the successful optimistic delete if background revalidation fails.
      })
  }
}
