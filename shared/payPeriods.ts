import { DateTime } from "luxon"
import type { SettingsType } from "./schemas/settings"
import type { WorkspaceType } from "./contracts/workspace"

type ResolvedPayPeriod = {
  start: string
  end: string
  periodId: string
}

function getTimeZone(settings: SettingsType) {
  return settings?.common?.timeZone || "America/Los_Angeles"
}

function getAnchor(settings: SettingsType, tz: string) {
  const anchorISO = settings?.w2?.payPeriodStartDate
  if (!anchorISO) return null
  const anchor = DateTime.fromISO(anchorISO, { zone: tz }).startOf("day")
  return anchor.isValid ? anchor : null
}

function formatPeriod(start: DateTime, end: DateTime): ResolvedPayPeriod {
  const startStr = start.toISODate()!
  const endStr = end.toISODate()!
  return {
    start: startStr,
    end: endStr,
    periodId: `${startStr}_${endStr}`,
  }
}

function addMonthsSafely(date: DateTime, months: number, anchorDay: number) {
  const shifted = date.plus({ months })
  const day = Math.min(anchorDay, shifted.endOf("month").day)
  return shifted.set({ day }).startOf("day")
}

function resolveSemiMonthlyPeriod(today: DateTime): ResolvedPayPeriod {
  if (today.day <= 15) {
    return formatPeriod(today.startOf("month"), today.startOf("month").set({ day: 15 }))
  }

  return formatPeriod(
    today.startOf("month").set({ day: 16 }),
    today.endOf("month").startOf("day")
  )
}

function shiftSemiMonthlyStart(start: DateTime, step: 1 | -1): DateTime {
  const normalized = start.startOf("day")

  if (step === 1) {
    if (normalized.day === 1) {
      return normalized.set({ day: 16 })
    }

    return normalized.plus({ months: 1 }).startOf("month")
  }

  if (normalized.day === 16) {
    return normalized.startOf("month")
  }

  return normalized.minus({ months: 1 }).startOf("month").set({ day: 16 })
}

function resolveRelativeSemiMonthlyPeriod(start: DateTime, index: number): ResolvedPayPeriod {
  let currentStart = start.startOf("day")
  const step: 1 | -1 = index >= 0 ? 1 : -1

  for (let i = 0; i < Math.abs(index); i += 1) {
    currentStart = shiftSemiMonthlyStart(currentStart, step)
  }

  if (currentStart.day === 1) {
    return formatPeriod(currentStart, currentStart.set({ day: 15 }))
  }

  return formatPeriod(currentStart.set({ day: 16 }), currentStart.endOf("month").startOf("day"))
}

function resolveMonthlyPeriod(today: DateTime, anchor: DateTime): ResolvedPayPeriod {
  const anchorDay = anchor.day
  const currentMonthAnchorDay = Math.min(anchorDay, today.endOf("month").day)
  const currentMonthStart = today.startOf("month").set({ day: currentMonthAnchorDay }).startOf("day")

  const start =
    today.toMillis() < currentMonthStart.toMillis()
      ? addMonthsSafely(currentMonthStart, -1, anchorDay)
      : currentMonthStart
  const nextStart = addMonthsSafely(start, 1, anchorDay)
  const end = nextStart.minus({ days: 1 }).startOf("day")

  return formatPeriod(start, end)
}

function resolveRelativePeriod(settings: SettingsType, base: ResolvedPayPeriod, index: number) {
  const tz = getTimeZone(settings)
  const freq = settings?.w2?.payFrequency || "biweekly"
  const startDt = DateTime.fromISO(base.start, { zone: tz }).startOf("day")
  const anchor = getAnchor(settings, tz) ?? startDt

  if (freq === "weekly") {
    const start = startDt.plus({ weeks: index })
    return formatPeriod(start, start.plus({ days: 6 }))
  }

  if (freq === "biweekly") {
    const start = startDt.plus({ days: index * 14 })
    return formatPeriod(start, start.plus({ days: 13 }))
  }

  if (freq === "semi-monthly") {
    return resolveRelativeSemiMonthlyPeriod(startDt, index)
  }

  const anchorDay = anchor.day
  const start = addMonthsSafely(startDt, index, anchorDay)
  const nextStart = addMonthsSafely(start, 1, anchorDay)
  return formatPeriod(start, nextStart.minus({ days: 1 }).startOf("day"))
}

export function getCurrentPayPeriodAt(
  settings: SettingsType,
  at: DateTime | string | Date = DateTime.now().setZone(getTimeZone(settings))
): ResolvedPayPeriod {
  const tz = getTimeZone(settings)
  const freq = settings?.w2?.payFrequency
  const anchor = getAnchor(settings, tz)
  const today =
    typeof at === "string"
      ? DateTime.fromISO(at, { zone: tz }).startOf("day")
      : at instanceof Date
        ? DateTime.fromJSDate(at, { zone: tz }).startOf("day")
        : at.setZone(tz).startOf("day")

  if (!freq || !anchor) {
    return formatPeriod(today.startOf("month"), today.endOf("month").startOf("day"))
  }

  if (freq === "weekly") {
    const diffDays = Math.floor(today.diff(anchor, "days").days)
    const periodsSince = Math.floor(diffDays / 7)
    const start = anchor.plus({ days: periodsSince * 7 })
    return formatPeriod(start, start.plus({ days: 6 }))
  }

  if (freq === "biweekly") {
    const diffDays = Math.floor(today.diff(anchor, "days").days)
    const periodsSince = Math.floor(diffDays / 14)
    const start = anchor.plus({ days: periodsSince * 14 })
    return formatPeriod(start, start.plus({ days: 13 }))
  }

  if (freq === "semi-monthly") {
    return resolveSemiMonthlyPeriod(today)
  }

  if (freq === "monthly") {
    return resolveMonthlyPeriod(today, anchor)
  }

  throw new Error(`Unsupported pay frequency: ${freq}`)
}

export function getCurrentPayPeriod(settings: SettingsType): ResolvedPayPeriod {
  return getCurrentPayPeriodAt(settings)
}

export function getCurrentCalendarMonthPeriodAt(
  settings: SettingsType,
  at: DateTime | string | Date = DateTime.now().setZone(getTimeZone(settings))
): ResolvedPayPeriod {
  const tz = getTimeZone(settings)
  const today =
    typeof at === "string"
      ? DateTime.fromISO(at, { zone: tz }).startOf("day")
      : at instanceof Date
        ? DateTime.fromJSDate(at, { zone: tz }).startOf("day")
        : at.setZone(tz).startOf("day")

  return formatPeriod(today.startOf("month"), today.endOf("month").startOf("day"))
}

export function getCalendarMonthBucketAt(
  settings: SettingsType,
  at: DateTime | string | Date = DateTime.now().setZone(getTimeZone(settings))
): string {
  const tz = getTimeZone(settings)
  const today =
    typeof at === "string"
      ? DateTime.fromISO(at, { zone: tz }).startOf("day")
      : at instanceof Date
        ? DateTime.fromJSDate(at, { zone: tz }).startOf("day")
        : at.setZone(tz).startOf("day")

  return today.toFormat("yyyy-MM")
}

export function getCalendarMonthBucketFromDate(
  date: string | Date,
  settings?: SettingsType
): string {
  if (typeof date === "string" && /^\d{4}-\d{2}/.test(date)) {
    return date.slice(0, 7)
  }

  const tz = settings ? getTimeZone(settings) : "America/Los_Angeles"
  const dt =
    date instanceof Date
      ? DateTime.fromJSDate(date, { zone: tz }).startOf("day")
      : DateTime.fromISO(date, { zone: tz }).startOf("day")

  return dt.isValid ? dt.toFormat("yyyy-MM") : String(date).slice(0, 7)
}

export function getCurrentEntryPeriod(
  settings: SettingsType,
  workspaceType: WorkspaceType,
  at?: DateTime | string | Date
): ResolvedPayPeriod {
  if (workspaceType === "independent") {
    return getCurrentCalendarMonthPeriodAt(settings, at)
  }

  return getCurrentPayPeriodAt(settings, at)
}

export function getPayPeriodByIndex(settings: SettingsType, index: number): ResolvedPayPeriod {
  const current = getCurrentPayPeriod(settings)
  return resolveRelativePeriod(settings, current, index)
}

export function getMostRecentlyClosedPayPeriod(
  settings: SettingsType,
  now: DateTime | string | Date = DateTime.now().setZone(getTimeZone(settings))
): ResolvedPayPeriod {
  const tz = getTimeZone(settings)
  const current = getCurrentPayPeriodAt(settings, now)
  const nowDt =
    typeof now === "string"
      ? DateTime.fromISO(now, { zone: tz }).startOf("day")
      : now instanceof Date
        ? DateTime.fromJSDate(now, { zone: tz }).startOf("day")
        : now.setZone(tz).startOf("day")

  const currentEnd = DateTime.fromISO(current.end, { zone: tz }).startOf("day")
  if (nowDt.toMillis() > currentEnd.toMillis()) {
    return current
  }

  return resolveRelativePeriod(settings, current, -1)
}

export function getEarliestEligiblePeriodEnd(
  settings: SettingsType,
  workspaceType: WorkspaceType,
  workspaceCreatedAt: number | null
): string | null {
  if (workspaceCreatedAt == null) {
    return null
  }
  const tz = getTimeZone(settings)
  const workspaceCreatedAtDt = DateTime.fromMillis(workspaceCreatedAt, { zone: tz })
  if (!workspaceCreatedAtDt.isValid) {
    return null
  }
  return getCurrentEntryPeriod(settings, workspaceType, workspaceCreatedAtDt).end
}

export type PeriodListItem = ResolvedPayPeriod & { label: string }

export function listPeriodsBack(
  settings: SettingsType,
  workspaceType: WorkspaceType,
  workspaceCreatedAt: number | null,
  options: { limit?: number; now?: DateTime | string | Date } = {}
): PeriodListItem[] {
  const tz = getTimeZone(settings)
  const limit = options.limit ?? 60
  const earliestEligiblePeriodEnd = getEarliestEligiblePeriodEnd(settings, workspaceType, workspaceCreatedAt)
  const current = getCurrentEntryPeriod(settings, workspaceType, options.now)
  const results: PeriodListItem[] = []

  if (workspaceType === "independent") {
    let cursor = DateTime.fromISO(current.start, { zone: tz })
    for (let i = 0; i < limit; i += 1) {
      const period = getCurrentCalendarMonthPeriodAt(settings, cursor)
      if (earliestEligiblePeriodEnd && period.end < earliestEligiblePeriodEnd) {
        break
      }
      results.push({ ...period, label: cursor.toFormat("LLLL yyyy") })
      cursor = cursor.minus({ months: 1 })
    }
    return results
  }

  for (let index = 0; index > -limit; index -= 1) {
    const period = getPayPeriodByIndex(settings, index)
    if (earliestEligiblePeriodEnd && period.end < earliestEligiblePeriodEnd) {
      break
    }
    const startLabel = DateTime.fromISO(period.start, { zone: tz }).toFormat("LLL d")
    const endLabel = DateTime.fromISO(period.end, { zone: tz }).toFormat("LLL d, yyyy")
    results.push({ ...period, label: `${startLabel} – ${endLabel}` })
  }
  return results
}

export function getStartOfYear(
  at: DateTime | string | Date = DateTime.now()
): string {
  const dt =
    typeof at === "string"
      ? DateTime.fromISO(at)
      : at instanceof Date
        ? DateTime.fromJSDate(at)
        : at
  return dt.startOf("year").toISODate()!
}

export { getCurrentPayPeriod as getCurrentPeriod }
