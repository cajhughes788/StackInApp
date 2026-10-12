"use client"

import { useId, useMemo, useState } from "react"
import { ChevronDown, MoreHorizontal, Receipt } from "lucide-react"

import { formatCurrency } from "@/lib/helpers"
import { normalizeExpenseCategoryLabel } from "@/lib/expenseCategories"
import { formatStreamShare } from "@/lib/incomeStreams"
import { useExpensesData, useExpensesRenderState } from "@/lib/stores/useExpensesStore"
import { useSettingsData, useSettingsRenderState } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { Button } from "@/components/ui/button"
import AttachReceiptDialog from "@/components/attach-receipt-dialog"
import {
  ExpenseDetails,
  ExpenseFieldEditor,
  deleteExpenseWithConfirm,
  expenseNeedsAttention,
  type ExpenseEditorControl,
} from "@/components/expense-cell-editors"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import PeriodSelector from "@/components/period-selector"

// The independent Expenses tab's summary, laid out like the Income tab's
// (income-streams-overview.tsx): the month's total, which expands into budget
// progress and stats, then the categories with their share of total
// expenses, each expanding into the days money went out. Grouped by the
// expense's category the same way the old expense gauge counted it. Each
// expense under a day edits with the expenses grid's own pop-ups.

const DAYS_SHOWN_COLLAPSED = 6

// The expenses store types expenses loosely (see useExpensesStore.ts).
type Expense = any
type CategoryDay = { date: string; amount: number; expenses: Expense[] }

// What a day row needs to edit the expenses behind it.
type ExpenseEditContext = {
  workspaceId: string
  customExpenseCategories: string[]
  independentSettings: Parameters<typeof ExpenseFieldEditor>[0]["independentSettings"]
  onAttachReceipt: (expenseId: string) => void
}
type ExpenseCategory = { name: string; amount: number; share: number; days: CategoryDay[] }

function formatDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function ShareBar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div
        className="h-full rounded-full bg-muted-foreground/70 transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(share * 100, 100))}%` }}
      />
    </div>
  )
}

// Plain open/closed wiring for an editor: a category row opens on the first
// tap (the grid arms first, since its cells sit close together).
function useEditorControl(workspaceId: string, triggerClassName: string): ExpenseEditorControl {
  const [isOpen, setIsOpen] = useState(false)
  return {
    workspaceId,
    isOpen,
    onClose: () => setIsOpen(false),
    onTriggerClick: () => setIsOpen((current) => !current),
    onSaved: () => setIsOpen(false),
    triggerClassName,
  }
}

const CHIP_TRIGGER_CLASS = "min-w-0 max-w-[65%] overflow-hidden rounded-lg bg-card px-3 py-1 text-right text-foreground hover:text-primary"

// One expense under a category's day. Tapping it opens the grid's amount
// editor; "⋯" shows the rest of the grid row inline — vendor and category
// editors, the details bubble (flag, description, split, receipt) and Delete
// — since a pop-up inside the editor's pop-up would close itself on phones.
function ExpenseDayItem({
  expense,
  title,
  subtitle,
  ctx,
}: {
  expense: Expense
  title: string
  subtitle: string
  ctx: ExpenseEditContext
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const amountControl = useEditorControl(
    ctx.workspaceId,
    "flex min-w-0 flex-1 items-start justify-between gap-3 py-2 text-left hover:text-primary"
  )
  const vendorControl = useEditorControl(ctx.workspaceId, CHIP_TRIGGER_CLASS)
  const categoryControl = useEditorControl(ctx.workspaceId, CHIP_TRIGGER_CLASS)
  const shared = {
    expense,
    customExpenseCategories: ctx.customExpenseCategories,
    workspaceType: "independent" as const,
    independentSettings: ctx.independentSettings,
  }

  return (
    <li>
      <div className="flex items-center gap-1">
        <ExpenseFieldEditor
          {...shared}
          field="amount"
          {...amountControl}
          trigger={
            <>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-foreground">
                  <span className="truncate">{title}</span>
                  {expenseNeedsAttention(expense) ? (
                    <span className="size-2 shrink-0 rounded-full bg-destructive" aria-label="Needs review" />
                  ) : null}
                </span>
                {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">{formatCurrency(expense.amount ?? 0)}</span>
            </>
          }
        />
        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          aria-expanded={detailsOpen}
          aria-label={`More for ${title}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </div>

      {detailsOpen ? (
        <div className="mb-2 space-y-3 rounded-xl bg-muted p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">Vendor</span>
            <ExpenseFieldEditor {...shared} field="vendor" {...vendorControl} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">Category</span>
            <ExpenseFieldEditor {...shared} field="account" {...categoryControl} />
          </div>
          <ExpenseDetails
            expense={expense}
            workspaceId={ctx.workspaceId}
            onAttachReceipt={() => ctx.onAttachReceipt(expense.id)}
          />
          {expense.id ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full"
              onClick={() => void deleteExpenseWithConfirm(ctx.workspaceId, expense.id)}
            >
              Delete expense
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function CategoryRow({ category, ctx }: { category: ExpenseCategory; ctx: ExpenseEditContext }) {
  const [expanded, setExpanded] = useState(false)
  const [showAllDays, setShowAllDays] = useState(false)
  const panelId = useId()
  const visibleDays = showAllDays ? category.days : category.days.slice(0, DAYS_SHOWN_COLLAPSED)

  return (
    <li className="py-3.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Receipt className="size-5" />
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-medium leading-snug text-foreground">{category.name}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{formatCurrency(category.amount)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
            <span className="truncate">
              {category.days.length} {category.days.length === 1 ? "day" : "days"}
            </span>
            <span className="shrink-0 tabular-nums">{formatStreamShare(category.share)} of expenses</span>
          </span>
          <ShareBar share={category.share} />
        </span>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div id={panelId} className="ml-14 mt-3 text-sm">
          <ul className="divide-y divide-border/70">
            {visibleDays.map((day) => {
              if (day.expenses.length === 1) {
                const expense = day.expenses[0]
                return (
                  <ExpenseDayItem
                    key={expense.id ?? day.date}
                    expense={expense}
                    title={formatDay(day.date)}
                    subtitle={[expense.vendor?.trim(), expense.description?.trim()].filter(Boolean).join(" · ")}
                    ctx={ctx}
                  />
                )
              }
              // Several expenses that day: one editable line each, like their
              // separate grid rows.
              return (
                <li key={day.date} className="py-1">
                  <div className="flex items-center justify-between gap-3 py-1 font-medium">
                    <span className="text-foreground">{formatDay(day.date)}</span>
                    <span className="pr-9 tabular-nums text-foreground">{formatCurrency(day.amount)}</span>
                  </div>
                  <ul className="ml-3 border-l border-border/70 pl-3">
                    {day.expenses.map((expense, index) => (
                      <ExpenseDayItem
                        key={expense.id ?? index}
                        expense={expense}
                        title={expense.vendor?.trim() || expense.description?.trim() || `Expense ${index + 1}`}
                        subtitle={expense.vendor?.trim() ? expense.description?.trim() ?? "" : ""}
                        ctx={ctx}
                      />
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
          {category.days.length > DAYS_SHOWN_COLLAPSED ? (
            <button
              type="button"
              onClick={() => setShowAllDays((current) => !current)}
              className="mt-1 text-xs font-medium text-primary"
            >
              {showAllDays ? "Show fewer" : `Show all ${category.days.length} days`}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export default function ExpenseCategoriesOverview() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace = workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const expenses = useExpensesData(activeWorkspaceId)
  const settings = useSettingsData(activeWorkspaceId)
  const {
    isHydrating: expensesHydrating,
    isRevalidating: expensesRevalidating,
    lastSuccessfulSyncAt: expensesLastSuccessfulSyncAt,
  } = useExpensesRenderState(activeWorkspaceId)
  const { isHydrating: settingsHydrating, isRevalidating: settingsRevalidating } =
    useSettingsRenderState(activeWorkspaceId)
  const [totalExpanded, setTotalExpanded] = useState(false)
  const totalPanelId = useId()

  const { total, categories } = useMemo(() => {
    const byCategory = new Map<string, { amount: number; days: Map<string, CategoryDay> }>()
    let sum = 0
    for (const expense of expenses) {
      const amount = expense.amount ?? 0
      sum += amount
      const name = normalizeExpenseCategoryLabel(expense.account ?? "Uncategorized")
      const group = byCategory.get(name) ?? { amount: 0, days: new Map<string, CategoryDay>() }
      group.amount += amount
      const day: CategoryDay = group.days.get(expense.date) ?? { date: expense.date, amount: 0, expenses: [] }
      day.amount += amount
      day.expenses.push(expense)
      group.days.set(expense.date, day)
      byCategory.set(name, group)
    }
    const list: ExpenseCategory[] = Array.from(byCategory, ([name, group]) => ({
      name,
      amount: group.amount,
      // Refunds are negative expenses, so a refund-heavy month can total ≤ 0.
      share: sum > 0 ? group.amount / sum : 0,
      days: Array.from(group.days.values()).sort((a, b) => b.date.localeCompare(a.date)),
    })).sort((a, b) => b.amount - a.amount)
    return { total: sum, categories: list }
  }, [expenses])

  const budget =
    settings?.independent?.expenseTargetPerMonth && settings.independent.expenseTargetPerMonth > 0
      ? settings.independent.expenseTargetPerMonth
      : null
  const budgetShare = budget ? total / budget : 0

  const [attachReceiptExpenseId, setAttachReceiptExpenseId] = useState<string | null>(null)
  const editContext = useMemo<ExpenseEditContext | null>(
    () =>
      activeWorkspaceId
        ? {
            workspaceId: activeWorkspaceId,
            customExpenseCategories: settings?.independent?.customExpenseCategories ?? [],
            independentSettings: settings?.independent ?? null,
            onAttachReceipt: setAttachReceiptExpenseId,
          }
        : null,
    [activeWorkspaceId, settings]
  )

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    !editContext ||
    activeWorkspace?.type !== "independent" ||
    (expensesHydrating && expenses.length === 0 && expensesLastSuccessfulSyncAt === null) ||
    (settingsHydrating && settings === null)
  ) {
    return <div className="order-1 p-4 text-sm text-muted-foreground">Loading monthly expenses…</div>
  }

  // A fragment so the home page can order these sections around its bank
  // review (order-1 / order-3 in its flex column).
  return (
    <>
      <section className="relative order-1 rounded-[22px] bg-card p-5">
        <SyncStatusIndicator visible={expensesRevalidating || settingsRevalidating} label="Syncing expenses" />
        <PeriodSelector />

        <button
          type="button"
          onClick={() => setTotalExpanded((current) => !current)}
          aria-expanded={totalExpanded}
          aria-controls={totalPanelId}
          className="flex w-full items-end justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm text-muted-foreground">Total expenses</span>
            <span className="block text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
              {formatCurrency(total)}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {expenses.length} {expenses.length === 1 ? "expense" : "expenses"} this period
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 pb-1.5 text-sm font-medium text-primary">
            {budget ? `${Math.round(budgetShare * 100)}% of budget` : "Details"}
            <ChevronDown
              className={`size-4 transition-transform ${totalExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {totalExpanded ? (
          <div id={totalPanelId} className="mt-4 space-y-4">
            {budget ? (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${budgetShare > 1 ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${Math.max(0, Math.min(budgetShare * 100, 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatCurrency(total)}</span>
                  <span>Budget {formatCurrency(budget)}</span>
                </div>
              </div>
            ) : null}
            <dl className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl bg-muted py-3 text-center">
              <div className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">Categories</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{categories.length}</dd>
              </div>
              <div className="flex flex-col-reverse px-1">
                <dt className="text-xs text-muted-foreground">Biggest</dt>
                <dd className="truncate text-lg font-semibold text-foreground">{categories[0]?.name ?? "—"}</dd>
              </div>
              <div className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">
                  {budget ? (total > budget ? "Over budget" : "Left") : "Avg expense"}
                </dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">
                  {budget
                    ? formatCurrency(Math.abs(budget - total))
                    : formatCurrency(expenses.length ? total / expenses.length : 0)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>

      <section className="order-3" aria-labelledby="expense-categories-heading">
        <h2 id="expense-categories-heading" className="mb-2 px-1 text-lg font-semibold text-foreground">
          Expense categories
        </h2>
        {categories.length === 0 ? (
          <p className="rounded-[22px] bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No expenses logged for this period yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-[22px] bg-card px-4">
            {categories.map((category) => (
              <CategoryRow key={category.name} category={category} ctx={editContext} />
            ))}
          </ul>
        )}
      </section>

      <AttachReceiptDialog
        open={attachReceiptExpenseId != null}
        onOpenChange={(open) => !open && setAttachReceiptExpenseId(null)}
        workspaceId={activeWorkspaceId}
        expenseId={attachReceiptExpenseId ?? ""}
        vendorLabel={expenses.find((expense) => expense.id === attachReceiptExpenseId)?.vendor}
      />
    </>
  )
}
