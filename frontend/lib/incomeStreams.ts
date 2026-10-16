import type { EntryType, IncomeCategory, PaymentMethod } from "@shared/schemas/entry"
import { getIncomeBreakdownTotal, getNonCustomOtherIncome } from "@shared/independentIncome"

// "Payment streams" for the Income tab (income-streams-overview.tsx): the
// period's independent income grouped by how it was paid.
//
// Covers exactly what the income total counts (computeIncomeGaugeForEntries:
// every income breakdown line, plus Personal Cash when the workspace shows
// it), so the stream shares always add up to the total.
//
// "Other" money is split by name: each named payer (customIncome — DoorDash,
// Acme Corp; see lib/incomeNames.ts) is its own stream, and only the unnamed
// rest stays under "Other". The named amounts are read from customIncome
// rather than its mirrored "other" breakdown lines, so nothing counts twice.

export type IncomeStreamKey = PaymentMethod | "personal_cash" | `named:${string}`

export type IncomeStreamCategories = Record<IncomeCategory, number>

export type IncomeStream = {
  key: IncomeStreamKey
  // Display name for a named-payer stream.
  name?: string
  amount: number
  // 0–1 share of the period total.
  share: number
  // Personal Cash has no category split; it's all zeros there.
  categories: IncomeStreamCategories
  // One row per date with income in this stream, newest first, with what
  // each entry that day put into this stream (so a day row can be edited
  // one entry at a time, like a grid cell).
  days: Array<{ date: string; amount: number; entries: Array<{ entryId: string; amount: number }> }>
}

const CATEGORIES: IncomeCategory[] = ["services", "tips", "products", "other"]

function emptyCategories(): IncomeStreamCategories {
  return { services: 0, tips: 0, products: 0, other: 0 }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeIncomeStreams(
  entries: EntryType[],
  options: { includePersonalCash: boolean }
): { total: number; streams: IncomeStream[] } {
  type DayTally = { amount: number; byEntry: Map<string, number> }
  const byKey = new Map<IncomeStreamKey, { name?: string; amount: number; categories: IncomeStreamCategories; days: Map<string, DayTally> }>()

  const add = (key: IncomeStreamKey, entryId: string, date: string, amount: number, categories?: Partial<IncomeStreamCategories>, name?: string) => {
    if (!amount) return
    const stream = byKey.get(key) ?? { name, amount: 0, categories: emptyCategories(), days: new Map() }
    stream.amount += amount
    for (const category of CATEGORIES) stream.categories[category] += Number(categories?.[category] ?? 0)
    const day = stream.days.get(date) ?? { amount: 0, byEntry: new Map() }
    day.amount += amount
    day.byEntry.set(entryId, (day.byEntry.get(entryId) ?? 0) + amount)
    stream.days.set(date, day)
    byKey.set(key, stream)
  }

  for (const entry of entries) {
    const independent = entry.independent
    if (entry.workspace !== "independent" || !independent) continue
    const entryId = entry.id ?? ""
    for (const breakdown of independent.incomeBreakdowns ?? []) {
      // "other" lines are handled below, split into named and unnamed.
      if (breakdown.paymentMethod === "other") continue
      // Card money — old card tips, or a deposit marked "Card" — counts
      // under Card / POS, like the entries grid's Card / POS column.
      const key = breakdown.paymentMethod === "card" ? "pos" : breakdown.paymentMethod
      add(key, entryId, entry.date, getIncomeBreakdownTotal(breakdown), breakdown)
    }
    // Named amounts can only be what the "other" lines actually hold: an
    // entry whose customIncome was never mirrored into them (old data) never
    // counted it in the total, so it's scaled down to keep shares at 100%.
    const otherLinesTotal = (independent.incomeBreakdowns ?? [])
      .filter((item) => item.paymentMethod === "other")
      .reduce((sum, item) => sum + getIncomeBreakdownTotal(item), 0)
    // A refund entry's "other" money is negative and so is its named custom
    // income (refundsService.ts): kept signed so the client's stream nets out.
    if (entry.kind === "refund") {
      let namedTotal = 0
      for (const item of independent.customIncome ?? []) {
        const name = item.label?.trim() || "Other income"
        const amount = Number(item.amount ?? 0)
        namedTotal += amount
        add(`named:${name.toLowerCase()}`, entryId, entry.date, amount, { [item.category ?? "other"]: amount }, name)
      }
      add("other", entryId, entry.date, otherLinesTotal - namedTotal)
      continue
    }
    const customTotal = (independent.customIncome ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.amount ?? 0)), 0)
    const namedScale = customTotal > otherLinesTotal && customTotal > 0 ? otherLinesTotal / customTotal : 1
    for (const item of independent.customIncome ?? []) {
      const name = item.label?.trim() || "Other income"
      const amount = Math.max(0, Number(item.amount ?? 0)) * namedScale
      // Grouped case-insensitively; the first spelling seen is displayed.
      add(`named:${name.toLowerCase()}`, entryId, entry.date, amount, { [item.category ?? "other"]: amount }, name)
    }
    const unnamedOther = getNonCustomOtherIncome(independent)
    add("other", entryId, entry.date, unnamedOther.total, unnamedOther)
    if (options.includePersonalCash) {
      // Same field the total uses (computeIndependentDayTotal).
      add("personal_cash", entryId, entry.date, Number(independent.unreportedCash ?? 0))
    }
  }

  const total = round2([...byKey.values()].reduce((sum, stream) => sum + stream.amount, 0))
  const streams = [...byKey.entries()]
    .map(([key, stream]) => ({
      key,
      ...(stream.name ? { name: stream.name } : {}),
      amount: round2(stream.amount),
      share: total > 0 ? stream.amount / total : 0,
      categories: Object.fromEntries(
        CATEGORIES.map((category) => [category, round2(stream.categories[category])])
      ) as IncomeStreamCategories,
      days: [...stream.days.entries()]
        .map(([date, day]) => ({
          date,
          amount: round2(day.amount),
          entries: [...day.byEntry.entries()]
            .map(([entryId, amount]) => ({ entryId, amount: round2(amount) }))
            .filter((item) => item.amount !== 0),
        }))
        .filter((day) => day.amount !== 0)
        .sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .filter((stream) => stream.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  return { total, streams }
}

// Whole-number percentage for display; "<1%" for a sliver that would
// otherwise read as 0%.
export function formatStreamShare(share: number): string {
  if (share > 0 && share < 0.005) return "<1%"
  return `${Math.round(share * 100)}%`
}
