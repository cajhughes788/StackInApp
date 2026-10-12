"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, Clock3 } from "lucide-react"
import { calculateAvgHoursPerWeek } from "@shared/hoursStats"

export type MonthlyHoursBucket = {
  key: string
  label: string
  totalHours: number
  periodStart: string
  periodEnd: string
  firstActivityDate: string
}

type HoursWorkedCardProps =
  | {
      variant: "trend"
      monthlyBuckets: MonthlyHoursBucket[]
    }
  | {
      variant: "simple"
      thisMonthHours: number
      thisYearHours: number
      avgPerWeek: number
      hideWhenEmpty?: boolean
    }

function formatHours(value: number): string {
  return value.toFixed(1)
}

function TrendVariant({ monthlyBuckets }: { monthlyBuckets: MonthlyHoursBucket[] }) {
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null)

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const currentYearPrefix = String(now.getFullYear())

  const hasAnyHours = monthlyBuckets.length > 0
  const thisMonthHours = monthlyBuckets.find((bucket) => bucket.key === currentMonthKey)?.totalHours ?? 0

  const yearBuckets = useMemo(
    () =>
      monthlyBuckets
        .filter((bucket) => bucket.key.startsWith(currentYearPrefix))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [monthlyBuckets, currentYearPrefix]
  )

  const thisYearHours = useMemo(
    () => Math.round(yearBuckets.reduce((sum, bucket) => sum + bucket.totalHours, 0) * 100) / 100,
    [yearBuckets]
  )

  useEffect(() => {
    setSelectedMonthKey((current) => {
      if (current && yearBuckets.some((bucket) => bucket.key === current)) return current
      if (yearBuckets.some((bucket) => bucket.key === currentMonthKey)) return currentMonthKey
      return yearBuckets[yearBuckets.length - 1]?.key ?? null
    })
  }, [yearBuckets, currentMonthKey])

  const selectedBucket = yearBuckets.find((bucket) => bucket.key === selectedMonthKey) ?? null
  // Floor to the first day hours were actually logged in the selected month, so a
  // partial first month (e.g. hired on the 15th) isn't diluted by the unworked days.
  const selectedAvgPerWeek = selectedBucket
    ? calculateAvgHoursPerWeek(
        selectedBucket.totalHours,
        selectedBucket.periodStart,
        selectedBucket.periodEnd,
        now,
        selectedBucket.firstActivityDate
      )
    : 0

  // Floor the yearly average to the first day with any logged hours this year, so a
  // user who starts partway through the year isn't diluted by the unused months before that.
  const earliestActivityDate = yearBuckets[0]?.firstActivityDate ?? null
  const yearAvgPerWeek = calculateAvgHoursPerWeek(
    thisYearHours,
    `${now.getFullYear()}-01-01`,
    `${now.getFullYear()}-12-31`,
    now,
    earliestActivityDate
  )

  const maxHours = Math.max(1, ...yearBuckets.map((bucket) => bucket.totalHours))

  return (
    <HoursWorkedShell subtitle={hasAnyHours ? `${formatHours(thisMonthHours)} hrs this month` : "No hours logged yet"}>
      {hasAnyHours ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="This Month" value={formatHours(thisMonthHours)} />
            <StatTile label="This Year" value={formatHours(thisYearHours)} />
          </div>
          <StatTile label="Avg / Week (This Year)" value={formatHours(yearAvgPerWeek)} accent />

          {yearBuckets.length > 0 ? (
            <div className="rounded-2xl border border-border bg-card px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {selectedBucket?.label ?? "Select a month"}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {selectedBucket ? `${formatHours(selectedBucket.totalHours)} hrs` : "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Avg / Week</div>
                  <div className="mt-1 text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatHours(selectedAvgPerWeek)}
                  </div>
                </div>
              </div>

              <div
                className="mt-4 grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${yearBuckets.length}, minmax(0, 1fr))` }}
              >
                {yearBuckets.map((bucket) => {
                  const isSelected = bucket.key === selectedMonthKey
                  const heightPct = Math.max(6, Math.round((bucket.totalHours / maxHours) * 100))
                  return (
                    <button
                      key={bucket.key}
                      type="button"
                      onClick={() => setSelectedMonthKey(bucket.key)}
                      className="flex flex-col items-center gap-1.5"
                      aria-pressed={isSelected}
                      aria-label={`${bucket.label}: ${formatHours(bucket.totalHours)} hours`}
                    >
                      <div className="flex h-16 w-full items-end">
                        <div
                          className={`w-full rounded-t-md transition-colors ${
                            isSelected ? "bg-emerald-500 dark:bg-emerald-400" : "bg-secondary "
                          }`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span
                        className={`text-[10px] ${
                          isSelected ? "font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {bucket.label.slice(0, 3)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No hours logged yet.
        </div>
      )}
    </HoursWorkedShell>
  )
}

function SimpleVariant({
  thisMonthHours,
  thisYearHours,
  avgPerWeek,
}: {
  thisMonthHours: number
  thisYearHours: number
  avgPerWeek: number
}) {
  return (
    <HoursWorkedShell subtitle={`${formatHours(thisMonthHours)} hrs this month`}>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="This Month" value={formatHours(thisMonthHours)} />
        <StatTile label="This Year" value={formatHours(thisYearHours)} />
      </div>
      <StatTile label="Avg / Week (This Year)" value={formatHours(avgPerWeek)} accent />
    </HoursWorkedShell>
  )
}

function StatTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/90 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          accent ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function HoursWorkedShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-[28px] border border-border/80 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-muted/70 min-[420px]:px-5 sm:px-6"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Clock3 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">Hours Worked</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            key="hours-expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/70"
          >
            <div className="space-y-5 px-4 py-5 min-[420px]:px-5 sm:px-6">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default function HoursWorkedCard(props: HoursWorkedCardProps) {
  if (props.variant === "trend") {
    return <TrendVariant monthlyBuckets={props.monthlyBuckets} />
  }

  const hasData = props.thisMonthHours > 0 || props.thisYearHours > 0
  if (props.hideWhenEmpty && !hasData) {
    return null
  }

  return (
    <SimpleVariant
      thisMonthHours={props.thisMonthHours}
      thisYearHours={props.thisYearHours}
      avgPerWeek={props.avgPerWeek}
    />
  )
}
