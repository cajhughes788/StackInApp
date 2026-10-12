"use client"

import { useMemo } from "react"
import { DateTime } from "luxon"

import { formatCurrency } from "@/lib/helpers"
import type { ProfitLossInsights } from "@shared/schemas/profitLossInsights"
import { WEEKDAY_SHORT_LABELS, computeBestWeekday, computeTypicalMonth } from "@shared/incomeInsights"

// The P&L page's "Your patterns": a typical month (median of up to six
// complete months, with low and high) and the best day of the week, from the
// getProfitLossInsights summary. Each part hides itself until there's enough
// history (3 months / 8 worked days), and the section hides when neither shows.

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

type Bar = { key: string; label: string; value: number; title: string; emphasized: boolean }

// Single-series mini bar chart: one hue, the emphasized bar solid and the rest
// tinted, 4px rounded tops on a shared baseline, an optional dashed reference
// line. Hover/press titles carry exact values; a list repeats them for screen
// readers.
function MiniBars({ bars, reference, label }: { bars: Bar[]; reference?: number; label: string }) {
  const max = Math.max(...bars.map((bar) => bar.value), reference ?? 0, 1)
  return (
    <figure className="space-y-1.5">
      <div className="relative flex h-20 items-end gap-1.5 border-b border-border" aria-hidden="true">
        {reference !== undefined ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed"
            style={{
              bottom: `${(reference / max) * 100}%`,
              borderColor: "color-mix(in srgb, var(--foreground) 55%, transparent)",
            }}
          />
        ) : null}
        {bars.map((bar) => (
          <div key={bar.key} className="flex h-full flex-1 items-end" title={bar.title}>
            <div
              className={`w-full rounded-t-[4px] ${bar.emphasized ? "bg-primary" : "bg-primary/35"}`}
              style={{ height: `${Math.max((bar.value / max) * 100, bar.value > 0 ? 3 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 text-center text-[11px] text-muted-foreground" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.key} className="flex-1">
            {bar.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        {label}:{" "}
        {bars.map((bar) => bar.title).join("; ")}
      </figcaption>
    </figure>
  )
}

export default function IncomePatterns({ insights }: { insights: ProfitLossInsights }) {
  const { months, typical, bestDay } = useMemo(() => {
    const months = insights.history.map((month) => ({ key: month.key, total: month.income }))
    const typical = computeTypicalMonth(months.map((month) => month.total))
    const bestDay =
      months.length > 0
        ? computeBestWeekday(
            insights.historyDailyIncome,
            `${months[0].key}-01`,
            DateTime.fromFormat(months[months.length - 1].key, "yyyy-MM").endOf("month").toISODate()!
          )
        : null
    return { months, typical, bestDay }
  }, [insights])

  const showBestDay = bestDay !== null && bestDay.ratio >= 1.2
  if (!typical && !showBestDay) return null

  return (
    <section className="space-y-2" aria-labelledby="income-patterns-heading">
      <h2 id="income-patterns-heading" className="px-1 text-lg font-semibold text-foreground">
        Your patterns
      </h2>
      <div className="divide-y divide-border/70 rounded-[22px] bg-card border border-card-border px-5">
        {typical ? (
          <div className="space-y-3 py-4">
            <div>
              <p className="text-sm text-muted-foreground">A typical month for you</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">{wholeDollars.format(typical.typical)}</p>
              <p className="text-sm text-muted-foreground">
                Low <span className="tabular-nums text-foreground">{wholeDollars.format(typical.low)}</span> · High{" "}
                <span className="tabular-nums text-foreground">{wholeDollars.format(typical.high)}</span> over the last{" "}
                {months.length} months
              </p>
            </div>
            <MiniBars
              label="Income by month"
              reference={typical.typical}
              bars={months.map((month) => {
                const date = DateTime.fromFormat(month.key, "yyyy-MM")
                return {
                  key: month.key,
                  label: date.toFormat("LLL"),
                  value: month.total,
                  title: `${date.toFormat("LLLL yyyy")}: ${formatCurrency(month.total)}`,
                  emphasized: true,
                }
              })}
            />
            <p className="text-xs text-muted-foreground">Dashed line: your typical month.</p>
          </div>
        ) : null}

        {showBestDay && bestDay ? (
          <div className="space-y-3 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Your best day</p>
              <p className="text-base text-foreground">
                <span className="font-semibold">{bestDay.bestLabel}</span> bring in{" "}
                <span className="font-semibold tabular-nums">{bestDay.ratio.toFixed(1)}×</span> your average day
              </p>
              <p className="text-sm text-muted-foreground">
                About <span className="tabular-nums text-foreground">{wholeDollars.format(bestDay.averages[bestDay.bestIndex])}</span> vs{" "}
                <span className="tabular-nums text-foreground">{wholeDollars.format(bestDay.overallAverage)}</span> on an average day
              </p>
            </div>
            <MiniBars
              label="Average income by day of the week"
              bars={bestDay.averages.map((average, index) => ({
                key: String(index),
                label: WEEKDAY_SHORT_LABELS[index],
                value: average,
                title: `${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][index]}: about ${formatCurrency(average)}`,
                emphasized: index === bestDay.bestIndex,
              }))}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
