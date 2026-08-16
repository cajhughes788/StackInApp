import type { RecurringCadence } from "./schemas/recurringRule"

// Pure date math shared by the backend cron (advancing nextOccurrence) and
// the frontend (previewing "next: Sep 1" before the rule is saved). Dates are
// always YYYY-MM-DD strings with no time component — noon UTC is used as the
// anchor for all arithmetic so DST transitions never shift the calendar date.

function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

// Advances to the same day-of-month as the ORIGINAL anchor date (not the
// previous occurrence), clamped to the target month's length. Anchoring off
// the original anchor rather than the previous occurrence prevents drift —
// e.g. a rule anchored on the 31st lands on Feb 28, then March 31 again
// (not March 28, which anchoring off the previous occurrence would produce).
function addMonthFromAnchor(currentDate: string, anchorDate: string): string {
  const current = new Date(`${currentDate}T12:00:00Z`)
  const anchor = new Date(`${anchorDate}T12:00:00Z`)
  const anchorDay = anchor.getUTCDate()

  let year = current.getUTCFullYear()
  let month = current.getUTCMonth() + 1
  if (month > 11) {
    month = 0
    year += 1
  }

  const clampedDay = Math.min(anchorDay, daysInMonth(year, month))
  return new Date(Date.UTC(year, month, clampedDay)).toISOString().slice(0, 10)
}

export function computeNextOccurrence(
  currentOccurrenceDate: string,
  cadence: RecurringCadence,
  anchorDate: string
): string {
  switch (cadence.freq) {
    case "weekly":
      return addDaysUTC(currentOccurrenceDate, 7)
    case "biweekly":
      return addDaysUTC(currentOccurrenceDate, 14)
    case "custom_days":
      return addDaysUTC(currentOccurrenceDate, Math.max(1, cadence.intervalDays))
    case "monthly":
      return addMonthFromAnchor(currentOccurrenceDate, anchorDate)
  }
}

export function cadenceLabel(cadence: RecurringCadence): string {
  switch (cadence.freq) {
    case "weekly":
      return "Weekly"
    case "biweekly":
      return "Every 2 weeks"
    case "monthly":
      return "Monthly"
    case "custom_days":
      return `Every ${cadence.intervalDays} day${cadence.intervalDays === 1 ? "" : "s"}`
  }
}
