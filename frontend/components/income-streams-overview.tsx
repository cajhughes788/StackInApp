"use client"

import { TotalCardSkeleton } from "@/components/loading-skeletons"
import { useId, useMemo, useState, type ReactNode } from "react"
import { Banknote, ChevronDown, CreditCard, FileCheck, Landmark, MoreHorizontal, Smartphone, Store, Wallet } from "lucide-react"

import { formatCurrency } from "@/lib/helpers"
import { useEntriesData, useEntriesRenderState } from "@/lib/stores/useEntriesStore"
import { useExpensesData } from "@/lib/stores/useExpensesStore"
import { useSettingsData, useSettingsRenderState } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge"
import { computeSafeToSpend, resolveTaxSetAsidePercent, SHOW_TAX_SET_ASIDE } from "@shared/taxSetAside"
import { computeGoalPace } from "@shared/goalPace"
import { useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore"
import { categoryLabels } from "@/lib/incomeBreakdown"
import {
  computeIncomeStreams,
  formatStreamShare,
  type IncomeStream,
  type IncomeStreamKey,
} from "@/lib/incomeStreams"
import type { EntryType } from "@shared/schemas/entry"
import { Button } from "@/components/ui/button"
import {
  BreakdownCellEditor,
  HoursCellEditor,
  NumericCellEditor,
  deleteEntryWithConfirm,
  type CellEditorControl,
  type PaymentField,
} from "@/components/entry-cell-editors"
import Expand from "@/components/expand"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import PeriodSelector from "@/components/period-selector"

// The independent Income tab's summary (replaces the old income gauge): the
// period's total, which expands into goal progress and day stats, and the
// income split into payment streams, each expanding into its category split
// and the days it came in. The home page places its bank review ("Needs you")
// between the two. Numbers come from computeIncomeStreams, which
// counts exactly what the total counts, so the percentages add up.

const STREAM_META: Record<Exclude<IncomeStreamKey, `named:${string}`>, { label: string; icon: ReactNode }> = {
  venmo: { label: "Venmo", icon: <span className="text-base font-semibold">V</span> },
  zelle: { label: "Zelle", icon: <span className="text-base font-semibold">Z</span> },
  cash_app: { label: "Cash App", icon: <span className="text-base font-semibold">$</span> },
  check: { label: "Checks", icon: <FileCheck className="size-5" /> },
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
  // A method this build doesn't know (one added after it shipped) still
  // shows, under a generic tile, rather than breaking the Income tab.
  return (
    STREAM_META[stream.key as Exclude<IncomeStreamKey, `named:${string}`>] ?? {
      label: String(stream.key).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      icon: <Landmark className="size-5" />,
    }
  )
}

const DAYS_SHOWN_COLLAPSED = 6

// "Keep about" / "Safe to spend" are estimates, so they drop the cents.
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

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

// What a day row needs to edit the entries behind it.
type StreamEditContext = {
  entriesById: Map<string, EntryType>
  workspaceId: string
  tipsEnabled: boolean
  showHours: boolean
}

// Which entries-grid column a stream's money is edited through. Named payers
// (custom income) have no editor, as in the grid's Other income column.
const STREAM_GRID_FIELD: Partial<Record<IncomeStreamKey, PaymentField>> = {
  venmo: "venmo",
  apple_cash: "appleCash",
  zelle: "zelle",
  check: "checks",
  cash_app: "cashApp",
  pos: "posSales",
  card: "posSales",
  cash: "cashSales",
  other: "otherIncome",
}

// Plain open/closed wiring for an editor: a stream row opens on the first tap
// (the grid arms first, since its cells sit close together).
function useEditorControl(workspaceId: string, triggerClassName: string): CellEditorControl {
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

const DAY_TRIGGER_CLASS = "flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary"

// One entry's share of a stream on one day. Tapping the amount opens the same
// editor its grid cell does; "⋯" shows the entry's hours, note and Delete
// inline (a pop-up inside the editor's pop-up would close itself on phones).
function StreamDayEntry({
  streamKey,
  entry,
  amount,
  label,
  ctx,
}: {
  streamKey: IncomeStreamKey
  entry: EntryType
  amount: number
  label: string
  ctx: StreamEditContext
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const amountControl = useEditorControl(ctx.workspaceId, DAY_TRIGGER_CLASS)
  const hoursControl = useEditorControl(
    ctx.workspaceId,
    "rounded-lg bg-card px-3 py-1 tabular-nums text-foreground hover:text-primary"
  )
  // Refunds are booked against an invoice by the server: shown, not edited
  // (delete it from "⋯" and refund again to change one).
  const isRefund = entry.kind === "refund"
  const field = isRefund ? undefined : STREAM_GRID_FIELD[streamKey]
  const content = isRefund ? (
    <>
      <span className="min-w-0">
        {label ? <span className="mr-1.5 text-foreground">{label}</span> : null}
        <span className="inline-flex rounded-full bg-red-100 px-1.5 py-px align-[1px] text-[11px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
          {entry.refund?.reason === "dispute" ? "Disputed" : entry.refund?.reason === "dispute_reversed" ? "Dispute won" : "Refund"}
        </span>
        {entry.refund?.clientName ? (
          <span className="block truncate text-xs text-muted-foreground">
            {entry.refund.clientName}
            {entry.refund.invoiceNumber ? ` · Invoice #${entry.refund.invoiceNumber}` : ""}
          </span>
        ) : null}
      </span>
      <span className={`shrink-0 tabular-nums ${amount < 0 ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
        {amount < 0 ? `−${formatCurrency(-amount)}` : formatCurrency(amount)}
      </span>
    </>
  ) : (
    <>
      <span className="truncate text-foreground">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{formatCurrency(amount)}</span>
    </>
  )

  return (
    <li>
      <div className="flex items-center gap-1">
        {field ? (
          <BreakdownCellEditor entry={entry} field={field} tipsEnabled={ctx.tipsEnabled} {...amountControl} trigger={content} />
        ) : streamKey === "personal_cash" && !isRefund ? (
          <NumericCellEditor entry={entry} field="independent.unreportedCash" prefix="$" {...amountControl} trigger={content} />
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2">{content}</div>
        )}
        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          aria-expanded={detailsOpen}
          aria-label={`More for ${label || (isRefund ? "refund" : "entry")}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </div>

      <Expand open={detailsOpen} className="mb-2 space-y-3 rounded-xl bg-muted p-3">
          {ctx.showHours || (entry.independent?.hours ?? 0) > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Hours</span>
              <HoursCellEditor entry={entry} {...hoursControl} />
            </div>
          ) : null}
          {entry.notes?.trim() ? (
            <div>
              <div className="text-xs text-muted-foreground">Note</div>
              <p className="whitespace-pre-wrap text-foreground">{entry.notes}</p>
            </div>
          ) : null}
          {entry.id ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full"
              onClick={() => void deleteEntryWithConfirm(ctx.workspaceId, entry.id as string)}
            >
              Delete entry
            </Button>
          ) : null}
      </Expand>
    </li>
  )
}

function StreamRow({ stream, ctx }: { stream: IncomeStream; ctx: StreamEditContext }) {
  const [expanded, setExpanded] = useState(false)
  const [showAllDays, setShowAllDays] = useState(false)
  const panelId = useId()
  const meta = streamMeta(stream)
  const categoryRows = (Object.keys(stream.categories) as Array<keyof IncomeStream["categories"]>).filter(
    (category) => stream.categories[category] > 0
  )
  const visibleDays = showAllDays ? stream.days : stream.days.slice(0, DAYS_SHOWN_COLLAPSED)

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
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium text-foreground">{meta.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{formatCurrency(stream.amount)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
            <span className="truncate">{streamSubtitle(stream)}</span>
            <span className="shrink-0 tabular-nums">{formatStreamShare(stream.share)} of income</span>
          </span>
          <ShareBar share={stream.share} />
        </span>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <Expand open={expanded} id={panelId} className="ml-14 mt-3 space-y-3 text-sm">
          {categoryRows.length > 0 ? (
            <dl className="grid grid-cols-2 gap-2">
              {categoryRows.map((category) => (
                <div key={category} className="rounded-xl bg-muted px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{categoryLabels[category]}</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {formatCurrency(stream.categories[category])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {stream.days.length} {stream.days.length === 1 ? "day" : "days"}
            </div>
            <ul className="divide-y divide-border/70">
              {visibleDays.map((day) => {
                const dayEntries = day.entries.flatMap((item) => {
                  const entry = ctx.entriesById.get(item.entryId)
                  return entry ? [{ entry, amount: item.amount }] : []
                })
                if (dayEntries.length === 1) {
                  return (
                    <StreamDayEntry
                      key={day.date}
                      streamKey={stream.key}
                      entry={dayEntries[0].entry}
                      amount={day.amount}
                      label={formatDay(day.date)}
                      ctx={ctx}
                    />
                  )
                }
                if (dayEntries.length === 0) {
                  return (
                    <li key={day.date} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-foreground">{formatDay(day.date)}</span>
                      <span className="tabular-nums text-foreground">{formatCurrency(day.amount)}</span>
                    </li>
                  )
                }
                // Several entries that day (say, one typed in and one from the
                // bank): one editable line each, like their separate grid rows.
                return (
                  <li key={day.date} className="py-1">
                    <div className="flex items-center justify-between gap-3 py-1 font-medium">
                      <span className="text-foreground">{formatDay(day.date)}</span>
                      <span className="pr-9 tabular-nums text-foreground">{formatCurrency(day.amount)}</span>
                    </div>
                    <ul className="ml-3 border-l border-border/70 pl-3">
                      {dayEntries.map(({ entry, amount }, index) => (
                        <StreamDayEntry
                          key={entry.id ?? index}
                          streamKey={stream.key}
                          entry={entry}
                          amount={amount}
                          // A refund's note repeats what its badge and client line show.
                          label={entry.kind === "refund" ? "" : entry.notes?.trim().split("\n")[0] || `Entry ${index + 1}`}
                          ctx={ctx}
                        />
                      ))}
                    </ul>
                  </li>
                )
              })}
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
      </Expand>
    </li>
  )
}

export default function IncomeStreamsOverview() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace = workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const entries = useEntriesData(activeWorkspaceId)
  // The home page loads the same month's expenses, so this is what's left.
  const expenses = useExpensesData(activeWorkspaceId)
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
  // Month-end projection — only while viewing the current month (a picked
  // past period is in the selection store; null means current).
  const selectedPeriod = useSelectedPeriod(activeWorkspaceId)
  const goalPace =
    targetIncome && selectedPeriod === null ? computeGoalPace(total, targetIncome, settings) : null
  const editContext = useMemo<StreamEditContext | null>(
    () =>
      activeWorkspaceId
        ? {
            entriesById: new Map(entries.flatMap((entry) => (entry.id ? [[entry.id, entry] as const] : []))),
            workspaceId: activeWorkspaceId,
            tipsEnabled: settings?.independent?.isTippedIndependent === true,
            showHours: settings?.independent?.trackHours === true,
          }
        : null,
    [activeWorkspaceId, entries, settings]
  )
  const totalExpenses = useMemo(() => expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0), [expenses])
  const taxSetAsidePercent = resolveTaxSetAsidePercent(settings?.independent?.taxSetAsidePercent)
  const { profit, taxSetAside, safeToSpend } = computeSafeToSpend(total, totalExpenses, taxSetAsidePercent)
  // Hourly rate after expenses — only with hours tracking on (Settings) and
  // hours logged this period.
  const trackHours = settings?.independent?.trackHours === true
  const totalHours = useMemo(
    () => entries.reduce((sum, entry) => sum + (Number(entry.independent?.hours) || 0), 0),
    [entries]
  )
  const profitPerHour = trackHours && totalHours > 0 ? profit / totalHours : null

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    !editContext ||
    activeWorkspace?.type !== "independent" ||
    (entriesHydrating && entries.length === 0 && entriesLastSuccessfulSyncAt === null) ||
    (settingsHydrating && settings === null)
  ) {
    return <TotalCardSkeleton label="Loading monthly income…" className="order-1" />
  }

  // A fragment so the home page can order these sections around its bank
  // review (order-1 / order-3 in its flex column).
  return (
    <>
      <section className="relative order-1 rounded-[22px] bg-card border border-card-border p-5">
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
            {SHOW_TAX_SET_ASIDE ? (
              <span className="mt-1 block text-sm text-muted-foreground">
                Safe to spend about{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {wholeDollars.format(safeToSpend)}
                </span>{" "}
                after expenses and a {taxSetAsidePercent}% tax set-aside
              </span>
            ) : (
              <span className="mt-1 block text-sm text-muted-foreground">
                Keep about{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {wholeDollars.format(profit)}
                </span>{" "}
                after expenses
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 pb-1.5 text-sm font-medium text-primary">
            {targetIncome ? `${Math.round(goalShare * 100)}% of goal` : "Details"}
            <ChevronDown
              className={`size-4 transition-transform ${totalExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>

        <Expand open={totalExpanded} id={totalPanelId} className="mt-4 space-y-4">
            {targetIncome ? (
              <div className="space-y-1.5">
                <ShareBar share={goalShare} />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatCurrency(total)}</span>
                  <span>Goal {formatCurrency(targetIncome)}</span>
                </div>
                {goalPace ? (
                  <p className="pt-1 text-sm text-muted-foreground">
                    {goalShare >= 1 ? "Goal reached — on pace for " : "On pace for "}
                    <span className="font-medium tabular-nums text-foreground">
                      {wholeDollars.format(goalPace.projected)}
                    </span>{" "}
                    by month end ({Math.round(goalPace.projectedShare * 100)}% of goal)
                  </p>
                ) : null}
              </div>
            ) : null}
            <dl className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl bg-muted py-3 text-center">
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
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Income</dt>
                <dd className="tabular-nums text-foreground">{formatCurrency(total)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Expenses</dt>
                <dd className="tabular-nums text-foreground">−{formatCurrency(totalExpenses)}</dd>
              </div>
              {SHOW_TAX_SET_ASIDE ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Set aside for taxes ({taxSetAsidePercent}%)</dt>
                  <dd className="tabular-nums text-foreground">−{formatCurrency(taxSetAside)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-border/70 pt-1.5 font-medium">
                <dt className="text-foreground">{SHOW_TAX_SET_ASIDE ? "Safe to spend" : "You keep"}</dt>
                <dd className="tabular-nums text-foreground">
                  {formatCurrency(SHOW_TAX_SET_ASIDE ? safeToSpend : profit)}
                </dd>
              </div>
            </dl>
            {profitPerHour !== null ? (
              <p className="text-sm text-muted-foreground">
                You made{" "}
                <span className="font-medium tabular-nums text-foreground">{formatCurrency(profitPerHour)}/hr</span>{" "}
                after expenses over {Math.round(totalHours * 10) / 10} hours.
              </p>
            ) : null}
            {SHOW_TAX_SET_ASIDE ? (
              <p className="text-xs text-muted-foreground">
                Tax set-aside is a rough estimate, not tax advice. Change the % in Settings.
              </p>
            ) : null}
        </Expand>
      </section>

      <section className="order-3" aria-labelledby="payment-streams-heading">
        <h2 id="payment-streams-heading" className="mb-2 px-1 text-lg font-semibold text-foreground">
          Payment streams
        </h2>
        {streams.length === 0 ? (
          <p className="rounded-[22px] bg-card border border-card-border px-4 py-6 text-center text-sm text-muted-foreground">
            No income logged for this period yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-[22px] bg-card border border-card-border px-4">
            {streams.map((stream) => (
              <StreamRow key={stream.key} stream={stream} ctx={editContext} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
