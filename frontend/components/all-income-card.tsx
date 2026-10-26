"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

import Expand from "@/components/expand"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceAvatar } from "@/components/workspace-switcher"
import { useAllIncomeSummary } from "@/hooks/useAllIncomeSummary"
import { useSwitchWorkspace } from "@/hooks/useSwitchWorkspace"
import { formatCurrency } from "@/lib/helpers"
import { useEntriesData } from "@/lib/stores/useEntriesStore"
import { useExpensesData } from "@/lib/stores/useExpensesStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { nextMonthKey, previousMonthKey } from "@shared/allIncome"

// Home's "All income": this month's income across every workspace, for
// people with more than one job or business. Shown only with 2+ active
// workspaces. Each row switches to that workspace. The figures come from
// getAllIncomeSummary (see shared/allIncome.ts for how each is counted).

const OPEN_STORAGE_KEY = "all-income-card-open"

function currentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function monthKeyFromTimestamp(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthName(month: string, withYear: boolean): string {
  const [year, monthNumber] = month.split("-").map(Number)
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(year, monthNumber - 1, 1))
}

function readOpenPreference(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) !== "closed"
  } catch {
    return true
  }
}

function writeOpenPreference(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "open" : "closed")
  } catch {
    // ignore storage failures
  }
}

export default function AllIncomeCard({ className = "" }: { className?: string }) {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const ownerUid = useWorkspaceStore((s) => s.ownerUid)
  const switchWorkspace = useSwitchWorkspace()
  const panelId = useId()

  const activeWorkspaces = useMemo(
    () => (workspaceState.status === "ready" ? workspaceState.workspaces.filter((w) => w.status !== "archived") : []),
    [workspaceState]
  )
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const enabled = activeWorkspaces.length >= 2

  const thisMonth = currentMonthKey()
  const [month, setMonth] = useState(thisMonth)
  const [open, setOpen] = useState(true)
  useEffect(() => setOpen(readOpenPreference()), [])

  const earliestMonth = useMemo(() => {
    const created = activeWorkspaces.map((w) => w.createdAt).filter((ms) => Number.isFinite(ms) && ms > 0)
    return created.length > 0 ? monthKeyFromTimestamp(Math.min(...created)) : thisMonth
  }, [activeWorkspaces, thisMonth])

  // Refetch when the active workspace's records change, so a new entry or
  // expense shows up here right after it's saved.
  const entries = useEntriesData(activeWorkspaceId)
  const expenses = useExpensesData(activeWorkspaceId)
  const refreshKey = useMemo(() => {
    const entryTotal = entries.reduce((sum, e) => sum + Number(e.totals?.dayTotal ?? 0), 0)
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0)
    return `${activeWorkspaceId}:${entries.length}:${entryTotal.toFixed(2)}:${expenses.length}:${expenseTotal.toFixed(2)}`
  }, [activeWorkspaceId, entries, expenses])

  const { summary, failed } = useAllIncomeSummary(ownerUid, month, enabled, refreshKey)

  if (!enabled || failed) return null
  if (!summary || summary.month !== month) {
    return (
      <div className={`space-y-3 rounded-[22px] border border-card-border bg-card p-5 ${className}`} role="status" aria-live="polite">
        <span className="sr-only">Loading all income…</span>
        <Skeleton className="h-4 w-24 bg-muted" />
        <Skeleton className="h-9 w-40 bg-muted" />
        <Skeleton className="h-4 w-48 bg-muted" />
      </div>
    )
  }

  const sameYear = month.slice(0, 4) === thisMonth.slice(0, 4)
  const previousName = monthName(summary.previousMonth, summary.previousMonth.slice(0, 4) !== month.slice(0, 4))
  const canGoBack = month > earliestMonth
  const canGoForward = month < thisMonth

  let changeLine: string | null = null
  if (summary.total !== 0 || summary.previousTotal !== 0) {
    if (summary.change > 0) changeLine = `+${formatCurrency(summary.change)} vs. ${previousName}`
    else if (summary.change < 0) changeLine = `−${formatCurrency(Math.abs(summary.change))} vs. ${previousName}`
    else changeLine = `Same as ${previousName}`
  }

  function toggleOpen() {
    setOpen((current) => {
      writeOpenPreference(!current)
      return !current
    })
  }

  return (
    <section className={`rounded-[22px] bg-card border border-card-border p-5 ${className}`} aria-labelledby={`${panelId}-title`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id={`${panelId}-title`} className="text-sm font-medium text-muted-foreground">
          All income
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth(previousMonthKey(month))}
            disabled={!canGoBack}
            aria-label="Previous month"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <span className="min-w-[6.5rem] text-center text-sm font-medium tabular-nums text-foreground">
            {monthName(month, !sameYear)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(nextMonthKey(month))}
            disabled={!canGoForward}
            aria-label="Next month"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-end justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {formatCurrency(summary.total)}
          </span>
          {changeLine ? (
            <span
              className={`mt-1 block text-sm tabular-nums ${summary.change > 0 ? "text-primary" : "text-muted-foreground"}`}
            >
              {changeLine}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 pb-1 text-sm font-medium text-primary">
          {summary.workspaces.length} workspaces
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>

      <Expand open={open} id={panelId} className="mt-4">
        <ul className="divide-y divide-border/70">
          {summary.workspaces.map((row) => {
            const isActive = row.workspaceId === activeWorkspaceId
            return (
              <li key={row.workspaceId}>
                <button
                  type="button"
                  onClick={() => void switchWorkspace(row.workspaceId)}
                  disabled={isActive}
                  className="flex w-full items-center gap-3 py-2.5 text-left disabled:cursor-default"
                >
                  <WorkspaceAvatar name={row.name} type={row.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.type === "w2" ? "W-2 · gross pay" : "Self-employed"}
                      {isActive ? " · Viewing" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium tabular-nums text-foreground">
                      {formatCurrency(row.income)}
                    </span>
                    {row.net !== null ? (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {formatCurrency(row.net)} after expenses
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Expand>
    </section>
  )
}
