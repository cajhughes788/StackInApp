"use client"

import { useId, useMemo, useState, type ReactNode } from "react"
import { Banknote, ChevronDown, CreditCard, Landmark, Smartphone, Store, Wallet } from "lucide-react"

import { formatCurrency } from "@/lib/helpers"
import { useEntriesData, useEntriesRenderState } from "@/lib/stores/useEntriesStore"
import { useSettingsData, useSettingsRenderState } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge"
import { categoryLabels } from "@/lib/incomeBreakdown"
import {
  computeIncomeStreams,
  formatStreamShare,
  type IncomeStream,
  type IncomeStreamKey,
} from "@/lib/incomeStreams"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import PeriodSelector from "@/components/period-selector"

// The independent Income tab's summary (replaces the old income gauge): the
// period's total, which expands into goal progress and day stats, and the
// income split into payment streams, each expanding into its category split
// and the days it came in. Numbers come from computeIncomeStreams, which
// counts exactly what the total counts, so the percentages add up.

const STREAM_META: Record<Exclude<IncomeStreamKey, `named:${string}`>, { label: string; icon: ReactNode }> = {
  venmo: { label: "Venmo", icon: <span className="text-base font-semibold">V</span> },
  zelle: { label: "Zelle", icon: <span className="text-base font-semibold">Z</span> },
  apple_cash: { label: "Apple Pay", icon: <Smartphone className="size-5" /> },
  cash: { label: "Cash", icon: <Banknote className="size-5" /> },
  card: { label: "Card", icon: <CreditCard className="size-5" /> },
  pos: { label: "Card / POS sales", icon: <Store className="size-5" /> },
  other: { label: "Other", icon: <Landmark className="size-5" /> },
  personal_cash: { label: "Personal Cash", icon: <Wallet className="size-5" /> },
}

// A named payer (DoorDash, Acme Corp) gets its initial, like Venmo's V tile.
function streamMeta(stream: IncomeStream): { label: string; icon: ReactNode } {
  if (stream.key.startsWith("named:")) {
    const name = stream.name ?? "Other income"
    return { label: name, icon: <span className="text-base font-semibold">{name.charAt(0).toUpperCase()}</span> }
  }
  return STREAM_META[stream.key as Exclude<IncomeStreamKey, `named:${string}`>]
}

const DAYS_SHOWN_COLLAPSED = 6

function formatDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

// What a stream's money was for, biggest first — e.g. "Services · Tips".
function streamSubtitle(stream: IncomeStream): string {
  if (stream.key === "personal_cash") return "Logged in app"
  const parts = (Object.keys(stream.categories) as Array<keyof IncomeStream["categories"]>)
    .filter((category) => stream.categories[category] > 0)
    .sort((a, b) => stream.categories[b] - stream.categories[a])
    .map((category) => categoryLabels[category])
  return parts.length > 0 ? parts.join(" · ") : "Income"
}

// Jumps to the entries grid row for a day (entries-grid.tsx tags rows with
// data-entry-date) and briefly highlights it.
function revealEntryRow(date: string) {
  const row = document.querySelector<HTMLTableRowElement>(`tr[data-entry-date="${date}"]`)
  if (!row) return
  row.scrollIntoView({ behavior: "smooth", block: "center" })
  // Tints the cells rather than outlining the row — outlines and shadows on
  // <tr> don't render reliably in iOS Safari.
  const cells = Array.from(row.cells)
  for (const cell of cells) {
    cell.style.transition = "background-color 300ms"
    cell.style.backgroundColor = "color-mix(in srgb, var(--primary) 22%, transparent)"
  }
  window.setTimeout(() => {
    for (const cell of cells) cell.style.backgroundColor = ""
  }, 1600)
}

function ShareBar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(share * 100, 100))}%` }}
      />
    </div>
  )
}

function StreamRow({ stream }: { stream: IncomeStream }) {
  const [expanded, setExpanded] = useState(false)
  const [showAllDays, setShowAllDays] = useState(false)
  const panelId = useId()
  const meta = streamMeta(stream)
  const categoryRows = (Object.keys(stream.categories) as Array<keyof IncomeStream["categories"]>).filter(
    (category) => stream.categories[category] > 0
  )
  const visibleDays = showAllDays ? stream.days : stream.days.slice(0, DAYS_SHOWN_COLLAPSED)

  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium text-foreground">{meta.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{formatCurrency(stream.amount)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
            <span className="truncate">{streamSubtitle(stream)}</span>
            <span className="shrink-0 tabular-nums">{formatStreamShare(stream.share)}</span>
          </span>
          <ShareBar share={stream.share} />
        </span>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div id={panelId} className="ml-14 mt-3 space-y-3 text-sm">
          {categoryRows.length > 0 ? (
            <dl className="grid grid-cols-2 gap-2">
              {categoryRows.map((category) => (
                <div key={category} className="rounded-lg bg-secondary/60 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{categoryLabels[category]}</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {formatCurrency(stream.categories[category])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {stream.days.length} {stream.days.length === 1 ? "day" : "days"}
            </div>
            <ul className="divide-y divide-muted rounded-lg border border-muted">
              {visibleDays.map((day) => (
                <li key={day.date}>
                  <button
                    type="button"
                    onClick={() => revealEntryRow(day.date)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="text-foreground">{formatDay(day.date)}</span>
                    <span className="tabular-nums text-foreground">{formatCurrency(day.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {stream.days.length > DAYS_SHOWN_COLLAPSED ? (
              <button
                type="button"
                onClick={() => setShowAllDays((current) => !current)}
                className="mt-1 text-xs font-medium text-primary"
              >
                {showAllDays ? "Show fewer" : `Show all ${stream.days.length} days`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}

export default function IncomeStreamsOverview() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace = workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const entries = useEntriesData(activeWorkspaceId)
  const settings = useSettingsData(activeWorkspaceId)
  const {
    isHydrating: entriesHydrating,
    isRevalidating: entriesRevalidating,
    lastSuccessfulSyncAt: entriesLastSuccessfulSyncAt,
  } = useEntriesRenderState(activeWorkspaceId)
  const { isHydrating: settingsHydrating, isRevalidating: settingsRevalidating } =
    useSettingsRenderState(activeWorkspaceId)
  const [totalExpanded, setTotalExpanded] = useState(false)
  const totalPanelId = useId()

  const includePersonalCash = settings?.independent?.includeUnreportedInUI ?? false
  const { total, streams } = useMemo(
    () => computeIncomeStreams(entries, { includePersonalCash }),
    [entries, includePersonalCash]
  )
  const dayStats = useMemo(
    () => computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: includePersonalCash }),
    [entries, includePersonalCash]
  )

  const targetIncome =
    settings?.independent?.incomeTargetPerMonth && settings.independent.incomeTargetPerMonth > 0
      ? settings.independent.incomeTargetPerMonth
      : null
  const goalShare = targetIncome ? total / targetIncome : 0

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    activeWorkspace?.type !== "independent" ||
    (entriesHydrating && entries.length === 0 && entriesLastSuccessfulSyncAt === null) ||
    (settingsHydrating && settings === null)
  ) {
    return <div className="p-4 text-sm text-muted-foreground">Loading monthly income…</div>
  }

  return (
    <div className="space-y-4">
      <section className="relative rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <SyncStatusIndicator visible={entriesRevalidating || settingsRevalidating} label="Syncing income" />
        <PeriodSelector />

        <button
          type="button"
          onClick={() => setTotalExpanded((current) => !current)}
          aria-expanded={totalExpanded}
          aria-controls={totalPanelId}
          className="flex w-full items-end justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm text-muted-foreground">Total income</span>
            <span className="block text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
              {formatCurrency(total)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 pb-1.5 text-sm font-medium text-primary">
            {targetIncome ? `${Math.round(goalShare * 100)}% of goal` : "Details"}
            <ChevronDown
              className={`size-4 transition-transform ${totalExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {totalExpanded ? (
          <div id={totalPanelId} className="mt-4 space-y-4">
            {targetIncome ? (
              <div className="space-y-1.5">
                <ShareBar share={goalShare} />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatCurrency(total)}</span>
                  <span>Goal {formatCurrency(targetIncome)}</span>
                </div>
              </div>
            ) : null}
            <dl className="grid grid-cols-3 divide-x divide-muted rounded-xl bg-secondary/50 py-3 text-center">
              <div className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">Days worked</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{dayStats.daysWorked}</dd>
              </div>
              <div className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">Income sources</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{streams.length}</dd>
              </div>
              <div className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">Avg / day</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(dayStats.avgPerDay)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="payment-streams-heading">
        <h2 id="payment-streams-heading" className="mb-1 text-sm font-medium text-muted-foreground">
          Payment streams
        </h2>
        {streams.length === 0 ? (
          <p className="rounded-xl border border-dashed border-muted px-3 py-6 text-center text-sm text-muted-foreground">
            No income logged for this period yet.
          </p>
        ) : (
          <ul className="divide-y divide-muted">
            {streams.map((stream) => (
              <StreamRow key={stream.key} stream={stream} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
