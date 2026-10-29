"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"

import { useEntriesData, useEntriesRenderState } from "@/lib/stores/useEntriesStore"
import { useExpensesData, useExpensesRenderState } from "@/lib/stores/useExpensesStore"
import { useTaxEstimateStore } from "@/lib/stores/useTaxEstimateStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { SHOW_TAXES } from "@shared/estimatedTax/featureFlag"

// Loads the self-employed tax estimate and keeps it current as records
// change. Used by the Taxes page's card and Home's income card ("safe to
// spend"), so either one keeps the number fresh on its own.
export function useTaxEstimate() {
  const ownerUid = useWorkspaceStore((s) => s.ownerUid)
  const workspaceState = useWorkspaceStore((s) => s.state)
  const { data, status, load } = useTaxEstimateStore()

  useEffect(() => {
    // Nothing to fetch while the Taxes feature is hidden (featureFlag.ts).
    if (ownerUid && SHOW_TAXES) void load(ownerUid)
  }, [ownerUid, load])

  // Refetch when this workspace's records change (like the All income card),
  // so a new entry or expense shows in the estimate at once instead of after
  // the store's 5-minute refresh. Waits until new records have saved and for
  // a short quiet spell, so the server's P&L is up to date and a burst of
  // changes is one request.
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const entries = useEntriesData(activeWorkspaceId)
  const expenses = useExpensesData(activeWorkspaceId)
  const entriesState = useEntriesRenderState(activeWorkspaceId)
  const expensesState = useExpensesRenderState(activeWorkspaceId)
  // Still arriving (device cache, then the server): not a change by the user.
  const recordsLoading =
    entriesState.isHydrating || entriesState.isRevalidating || expensesState.isHydrating || expensesState.isRevalidating
  const records = useMemo(() => {
    const unsaved =
      entries.some((e) => !!e.syncState || String(e.id ?? "").startsWith("tmp-")) ||
      // An expense not yet saved has only a temporary tempId, no id.
      expenses.some((e) => !e.id || String(e.id).startsWith("tmp-"))
    const entryTotal = entries.reduce((sum, e) => sum + Number(e.totals?.dayTotal ?? 0), 0)
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0)
    return {
      unsaved,
      key: `${entries.length}:${entryTotal.toFixed(2)}:${expenses.length}:${expenseTotal.toFixed(2)}`,
    }
  }, [entries, expenses])
  const baseline = useRef<{ workspaceId: string | null; key: string } | null>(null)
  useEffect(() => {
    if (!SHOW_TAXES || !ownerUid || records.unsaved || recordsLoading) return
    const previous = baseline.current
    // First look at a workspace sets the baseline; the initial load covers it.
    if (!previous || previous.workspaceId !== activeWorkspaceId) {
      baseline.current = { workspaceId: activeWorkspaceId, key: records.key }
      return
    }
    if (previous.key === records.key) return
    const timer = setTimeout(() => {
      baseline.current = { workspaceId: activeWorkspaceId, key: records.key }
      void load(ownerUid, { force: true })
    }, 1500)
    return () => clearTimeout(timer)
  }, [ownerUid, activeWorkspaceId, records, recordsLoading, load])


  const refresh = useCallback(() => {
    if (ownerUid) void load(ownerUid, { force: true })
  }, [ownerUid, load])

  return { data, status, refresh }
}
