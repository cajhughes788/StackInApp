// /lib/helpers.ts
// ------------------------------------------------------------
// Pure utility helpers for financial and time-tracking domains.
// Deterministic, side-effect-free, and schema-aligned.
// ------------------------------------------------------------

import { DateTime } from "luxon" // Deterministic local-time math
import type { SettingsType } from "@shared/schemas/settings"
import {EntryType} from "@shared/schemas/entry"
import { getCurrentPayPeriod } from "@shared/payPeriods"

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

/** Local helper type for computed pay-period stats */
export interface PeriodStats {
  totalIncome: number
  totalHours: number
  totalTips: number
  daysWorked: number
  avgPerDay: number
  avgPerHour: number
}

// ------------------------------------------------------------
// Core Utilities
// ------------------------------------------------------------

/**
 * Generate a random 32-character key (frontend-safe, non-secure)
 */
export function generateApiKey(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("")
}

/**
 * Aggregate statistics for entries within the current pay period.
 * Uses pay-period window from settings for consistent calculations.
 */
export function calculatePeriodStats(
  entries: EntryType[],
  settings: SettingsType
): PeriodStats {
  const { start, end } = getCurrentPayPeriod(settings)
  const startDate = new Date(start)
  const endDate = new Date(end)

  const periodEntries = entries.filter((entry) => {
    const d = new Date(entry.date)
    return d >= startDate && d <= endDate
  })
const totalTips = periodEntries.reduce(
  (sum, e) => sum + (((e as any).w2?.tips) ?? 0),
  0
)

  const totalReported = periodEntries.reduce(
    (sum, e) => sum + ((e as any).w2?.reportedCash ?? 0),
    0
  )
  const totalUnreported = (settings as any).w2?.includeUnreportedInUI
    ? periodEntries.reduce((sum, e) => sum + ((e as any).w2?.unreportedCash ?? 0), 0)
    : 0
  const totalHours = periodEntries.reduce((sum, e) => sum + (e.totals?.totalHours ?? 0), 0)

  const totalIncome = totalTips + totalReported + totalUnreported
  const daysWorked = periodEntries.length
  const avgPerDay = daysWorked > 0 ? totalIncome / daysWorked : 0
  const avgPerHour = totalHours > 0 ? totalIncome / totalHours : 0

  return {
    totalIncome: round(totalIncome),
    totalHours: round(totalHours),
    totalTips: round(totalTips),
    daysWorked,
    avgPerDay: round(avgPerDay),
    avgPerHour: round(avgPerHour),
  }
}

// ------------------------------------------------------------
// Formatting Helpers
// ------------------------------------------------------------

/** Cached currency formatter for performance */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
})
export const formatCurrency = (amount: number): string =>
  currencyFormatter.format(amount || 0)

function padDatePart(value: number): string {
  return String(value).padStart(2, "0")
}

export function getLocalDateInputValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

export function getLocalMonthPeriodId(date: Date = new Date()): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}`
}

/** Convert string to local Date object (optionally with TZ) */
export function parseLocalDate(
  date: string | Date,
  tz?: string
): Date {
  if (date instanceof Date) return new Date(date)
  const isoDateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateMatch && !tz) {
    const [, year, month, day] = isoDateMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }
  try {
    if (tz) {
      const d = DateTime.fromISO(`${date}T00:00:00`, { zone: tz })
      return d.isValid ? d.toJSDate() : new Date(`${date}T00:00:00`)
    }
    return new Date(`${date}T00:00:00`)
  } catch {
    return new Date(`${date}T00:00:00`)
  }
}

/** Localized short date display */
export function formatDate(
  date: string | Date,
  locale = "en-US"
): string {
  const d = parseLocalDate(date)
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// ------------------------------------------------------------
// Time Calculation
// ------------------------------------------------------------

/**
 * Calculate hours between two times, respecting time zone and overnight shifts.
 * Uses Luxon for deterministic local-time math (DST-safe).
 */
export function calculateHours(
  inTime?: string | Date,
  outTime?: string | Date,
  settings?: SettingsType
): number {
  if (!inTime || !outTime) return 0

  try {
    const tz = (settings as any)?.common?.timeZone || "America/Los_Angeles"

    const start =
      inTime instanceof Date
        ? DateTime.fromJSDate(inTime, { zone: tz })
        : DateTime.fromISO(String(inTime), { zone: tz })

    const end =
      outTime instanceof Date
        ? DateTime.fromJSDate(outTime, { zone: tz })
        : DateTime.fromISO(String(outTime), { zone: tz })

    if (!start.isValid || !end.isValid) return 0

    const adjustedEnd = end < start ? end.plus({ days: 1 }) : end

    const diffHours = adjustedEnd.diff(start, "hours").hours
    return round(Math.max(0, diffHours))
  } catch {
    return 0
  }
}

// ------------------------------------------------------------
// Math Helpers
// ------------------------------------------------------------

/** Lightweight numeric rounding helper */
export const round = (n: number, decimals = 2): number =>
  Math.round(n * 10 ** decimals) / 10 ** decimals
