"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/helpers"
import { normalizeExpenseCategoryLabel } from "@/lib/expenseCategories"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

type CategoryTotal = {
  category: string
  amount: number
  count: number
}

export default function IndependentExpenseGauge() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const expensesEntry = useExpensesStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const settingsEntry = useSettingsStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const expenses = expensesEntry?.expenses ?? []
  const settings = settingsEntry?.data ?? null
  const expensesLoading =
    activeWorkspaceId != null
      ? (expensesEntry?.status ?? "idle") === "loading"
      : true
  const settingsLoading =
    activeWorkspaceId != null
      ? (settingsEntry?.status ?? "idle") === "loading"
      : true
  const hasRenderableExpenses =
    expenses.length > 0 || (expensesEntry?.lastBackendSync ?? null) !== null
  const hasRenderableSettings = settings !== null

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0),
    [expenses]
  )

  const categoryTotals = useMemo<CategoryTotal[]>(() => {
    const map = new Map<string, CategoryTotal>()

    for (const expense of expenses) {
      const category = normalizeExpenseCategoryLabel(
        expense.account ?? "Uncategorized"
      )
      const existing = map.get(category)

      if (existing) {
        existing.amount += expense.amount ?? 0
        existing.count += 1
        continue
      }

      map.set(category, {
        category,
        amount: expense.amount ?? 0,
        count: 1,
      })
    }

    return [...map.values()].sort((a, b) => b.amount - a.amount)
  }, [expenses])

  const topCategory = categoryTotals[0] ?? null
  const maxAmount = 5000
  const targetExpenses =
    settings?.independent?.expenseTargetPerMonth &&
    settings.independent.expenseTargetPerMonth > 0
      ? settings.independent.expenseTargetPerMonth
      : null
  const gaugeScale = targetExpenses ?? maxAmount
  const fillPercentage = Math.min((totalExpenses / gaugeScale) * 100, 100)
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date()),
    []
  )

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    activeWorkspace?.type !== "independent" ||
    (expensesLoading && !hasRenderableExpenses) ||
    (settingsLoading && !hasRenderableSettings)
  ) {
    return <div className="p-4 text-gray-400 text-sm">Loading monthly expenses…</div>
  }

  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm sm:p-6">
      {expensesLoading || settingsLoading ? (
        <div className="mb-3 text-xs text-muted-foreground">
          Refreshing monthly expenses…
        </div>
      ) : null}

      <h2 className="mb-4 text-lg font-semibold">Current Month: {monthLabel}</h2>

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

      <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{expenses.length}</div>
          <div className="text-xs text-muted-foreground">Expenses</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{categoryTotals.length}</div>
          <div className="text-xs text-muted-foreground">Categories</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-sm font-bold text-foreground sm:text-base">
            {topCategory?.category ?? "None"}
          </div>
          <div className="text-xs text-muted-foreground">Top Category</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>Category Breakdown</span>
          <span className="text-muted-foreground">Highest to lowest</span>
        </div>

        {categoryTotals.length === 0 ? (
          <div className="text-sm text-muted-foreground">No expenses recorded this month.</div>
        ) : (
          categoryTotals.map((item) => (
            <div
              key={item.category}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div>
                <div className="font-medium text-foreground">{item.category}</div>
                <div className="text-xs text-muted-foreground">
                  {item.count} {item.count === 1 ? "expense" : "expenses"}
                </div>
              </div>

              <div className="font-semibold text-foreground">
                {formatCurrency(item.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
