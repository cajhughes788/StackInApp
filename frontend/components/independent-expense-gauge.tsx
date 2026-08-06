"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/helpers"
import { normalizeExpenseCategoryLabel } from "@/lib/expenseCategories"
import {
  useExpensesData,
  useExpensesRenderState,
} from "@/lib/stores/useExpensesStore"
import {
  useSettingsData,
  useSettingsRenderState,
} from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import PeriodSelector from "@/components/period-selector"

export default function IndependentExpenseGauge() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const expenses = useExpensesData(activeWorkspaceId)
  const settings = useSettingsData(activeWorkspaceId)
  const {
    isHydrating: expensesHydrating,
    isRevalidating: expensesRevalidating,
    lastSuccessfulSyncAt: expensesLastSuccessfulSyncAt,
  } = useExpensesRenderState(activeWorkspaceId)
  const {
    isHydrating: settingsHydrating,
    isRevalidating: settingsRevalidating,
  } = useSettingsRenderState(activeWorkspaceId)
  const hasRenderableExpenses =
    expenses.length > 0 || expensesLastSuccessfulSyncAt !== null
  const hasRenderableSettings = settings !== null
  const showSyncIndicator = expensesRevalidating || settingsRevalidating

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0),
    [expenses]
  )

  const { categoryCount, topCategory } = useMemo(() => {
    const map = new Map<string, number>()

    for (const expense of expenses) {
      const category = normalizeExpenseCategoryLabel(
        expense.account ?? "Uncategorized"
      )
      map.set(category, (map.get(category) ?? 0) + (expense.amount ?? 0))
    }

    let topCat: string | null = null
    let topAmt = -Infinity
    for (const [cat, amt] of map) {
      if (amt > topAmt) {
        topAmt = amt
        topCat = cat
      }
    }

    return { categoryCount: map.size, topCategory: topCat }
  }, [expenses])
  const maxAmount = 5000
  const targetExpenses =
    settings?.independent?.expenseTargetPerMonth &&
    settings.independent.expenseTargetPerMonth > 0
      ? settings.independent.expenseTargetPerMonth
      : null
  const gaugeScale = targetExpenses ?? maxAmount
  const fillPercentage = Math.min((totalExpenses / gaugeScale) * 100, 100)

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    activeWorkspace?.type !== "independent" ||
    (expensesHydrating && !hasRenderableExpenses) ||
    (settingsHydrating && !hasRenderableSettings)
  ) {
    return <div className="p-4 text-gray-400 text-sm">Loading monthly expenses…</div>
  }

  return (
    <div className="relative bg-card rounded-lg border p-4 shadow-sm sm:p-6">
      <SyncStatusIndicator visible={showSyncIndicator} label="Syncing expenses" />

      <PeriodSelector />

      <div className="relative mb-5 h-28 sm:mb-6 sm:h-32">
        <div className="app-soft-surface absolute inset-0 rounded-lg overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-orange-500 transition-all duration-500 ease-out"
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-black sm:text-3xl">
              {formatCurrency(totalExpenses)}
            </div>
            <div className="text-xs text-slate-600 sm:text-sm">
              Gross Expenses
              {targetExpenses ? ` of ${formatCurrency(targetExpenses)}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{expenses.length}</div>
          <div className="text-xs text-muted-foreground">Expenses</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{categoryCount}</div>
          <div className="text-xs text-muted-foreground">Categories</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-sm font-bold text-foreground sm:text-base">
            {topCategory ?? "None"}
          </div>
          <div className="text-xs text-muted-foreground">Top Category</div>
        </div>
      </div>
    </div>
  )
}
