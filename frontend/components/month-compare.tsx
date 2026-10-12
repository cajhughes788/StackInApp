"use client"

import { DateTime } from "luxon"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { compareWithPreviousMonth, type DatedAmount } from "@shared/incomeInsights"

// "↗ Up 12% vs Sep 1–12". While the month is in progress it compares with the
// same days of last month (see compareWithPreviousMonth) — a full previous
// month would make every early-month total look like a drop. Neutral ink:
// more expenses isn't always bad, and the arrow already carries direction.
export default function MonthCompare({
  currentTotal,
  previousMonthKey,
  previousDaily,
  today,
}: {
  currentTotal: number
  // "YYYY-MM"
  previousMonthKey: string
  previousDaily: DatedAmount[]
  // Today in the workspace's time zone.
  today: DateTime
}) {
  const previous = DateTime.fromFormat(previousMonthKey, "yyyy-MM")
  const throughDay = Math.min(today.day, previous.daysInMonth ?? 31)
  const comparison = compareWithPreviousMonth(currentTotal, previousDaily, throughDay)
  if (!comparison) return null

  const percent = Math.round(comparison.change * 100)
  const against = throughDay === 1 ? previous.toFormat("LLL d") : `${previous.toFormat("LLL")} 1–${throughDay}`
  const Icon = percent >= 0 ? ArrowUpRight : ArrowDownRight

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {percent === 0 ? (
        <>Same as {against}</>
      ) : (
        <>
          <Icon className="size-4 shrink-0 text-foreground" aria-hidden="true" />
          <span className="font-medium tabular-nums text-foreground">
            {percent > 0 ? "Up" : "Down"} {Math.abs(percent)}%
          </span>
          vs {against}
        </>
      )}
    </span>
  )
}
