import { DateTime } from "luxon"
import type { SettingsType } from "./schemas/settings"

// Projects the current month's income to month end at the pace so far:
// total ÷ days elapsed × days in month, in the workspace's time zone.
// Null in the first days of the month, when one good or slow day would
// swing the projection wildly.
export const GOAL_PACE_MIN_DAYS = 3

export function computeGoalPace(
  total: number,
  target: number,
  settings: SettingsType | null,
  now: DateTime = DateTime.now()
): { projected: number; projectedShare: number } | null {
  if (!(target > 0) || !(total > 0)) return null
  const today = now.setZone(settings?.common?.timeZone || "America/Los_Angeles")
  const daysElapsed = today.day
  const daysInMonth = today.daysInMonth ?? 30
  if (daysElapsed < GOAL_PACE_MIN_DAYS) return null
  const projected = (total / daysElapsed) * daysInMonth
  return { projected, projectedShare: projected / target }
}
