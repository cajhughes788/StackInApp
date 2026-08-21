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

// Every date this module works with (entry dates, goal start/end dates) is a plain
// "YYYY-MM-DD" string representing a LOCAL calendar day, not a UTC one — so a `now: Date`
// must be read with local getters (getFullYear/getMonth/getDate), not UTC ones. Using UTC
// getters here previously made "today" flip to the next calendar day for anyone west of
// UTC once the evening rolled past UTC midnight (e.g. ~5pm PDT), inflating avg/week figures.
function toLocalCalendarDayMs(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
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
  const nowMs = toLocalCalendarDayMs(now)
  const effectiveEndMs = Math.min(endMs, nowMs)

  if (effectiveEndMs < startMs || totalHours <= 0) return 0

  const daysElapsed = Math.floor((effectiveEndMs - startMs) / MS_PER_DAY) + 1
  const weeksElapsed = daysElapsed / 7

  return Math.round((totalHours / weeksElapsed) * 100) / 100
}

export type HoursGoalProjection = {
  totalHoursGoal: number
  hoursRemaining: number
  weeksRemaining: number
  requiredAvgPerWeek: number
  currentAvgPerWeek: number
  isPastEndDate: boolean
  isComplete: boolean
}

/**
 * Projects what's needed to hit a target average hours/week by a target end
 * date, given hours already logged since the goal's start date.
 *
 * "Weeks remaining" and "total weeks in the goal window" are both computed
 * the same day-count/7 way as calculateAvgHoursPerWeek, so the two figures
 * stay consistent with each other and with the rest of the app's hours math.
 */
export function calculateHoursGoalProjection(
  hoursWorkedSinceStart: number,
  targetAvgHoursPerWeek: number,
  startDate: string,
  endDate: string,
  now: Date = new Date()
): HoursGoalProjection {
  const startMs = toUtcMidnight(startDate)
  const endMs = toUtcMidnight(endDate)
  const nowMs = toLocalCalendarDayMs(now)

  const totalWindowDays = Math.max(Math.floor((endMs - startMs) / MS_PER_DAY) + 1, 1)
  const totalHoursGoal = Math.round(targetAvgHoursPerWeek * (totalWindowDays / 7) * 100) / 100

  const isPastEndDate = nowMs > endMs
  const daysRemaining = isPastEndDate ? 0 : Math.floor((endMs - nowMs) / MS_PER_DAY) + 1
  const weeksRemaining = Math.round((daysRemaining / 7) * 100) / 100

  const hoursRemaining = Math.max(0, Math.round((totalHoursGoal - hoursWorkedSinceStart) * 100) / 100)
  const requiredAvgPerWeek =
    weeksRemaining > 0 ? Math.round((hoursRemaining / weeksRemaining) * 100) / 100 : 0

  const currentAvgPerWeek = calculateAvgHoursPerWeek(hoursWorkedSinceStart, startDate, endDate, now)

  return {
    totalHoursGoal,
    hoursRemaining,
    weeksRemaining,
    requiredAvgPerWeek,
    currentAvgPerWeek,
    isPastEndDate,
    isComplete: hoursRemaining <= 0,
  }
}
