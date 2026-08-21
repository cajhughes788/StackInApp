// /shared/hoursStats.ts
// ------------------------------------------------------------
// Pure helpers for aggregating "hours worked" into period stats.
// Shared between the backend (profit & loss statements) and the
// frontend (client-side earnings aggregation) so both workspace
// types compute "average per week" the same way.
// ------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toUtcMidnight(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number)
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1)
}

/**
 * Average hours per week over a period, using calendar weeks elapsed
 * rather than only weeks with logged hours. For an in-progress period
 * (periodEnd in the future), the average is computed through "now"
 * instead of the full period so it isn't diluted by unelapsed days.
 *
 * `earliestActivityDate`, when given, floors the start of the window to
 * whichever is later: periodStart or the first date hours were actually
 * logged. Without this, a user who joins mid-year (or mid-month) would
 * have their average diluted by the stretch before they started tracking
 * anything — e.g. someone who starts in May would otherwise have their
 * yearly average computed over Jan-through-now, not May-through-now.
 */
export function calculateAvgHoursPerWeek(
  totalHours: number,
  periodStart: string,
  periodEnd: string,
  now: Date = new Date(),
  earliestActivityDate?: string | null
): number {
  const periodStartMs = toUtcMidnight(periodStart)
  const startMs = earliestActivityDate
    ? Math.max(periodStartMs, toUtcMidnight(earliestActivityDate))
    : periodStartMs
  const endMs = toUtcMidnight(periodEnd)
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const effectiveEndMs = Math.min(endMs, nowMs)

  if (effectiveEndMs < startMs || totalHours <= 0) return 0

  const daysElapsed = Math.floor((effectiveEndMs - startMs) / MS_PER_DAY) + 1
  const weeksElapsed = daysElapsed / 7

  return Math.round((totalHours / weeksElapsed) * 100) / 100
}
