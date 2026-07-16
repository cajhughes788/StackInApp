// Shared between plan-ad.mjs (must pick dates that will actually be
// visible before recording anything) and record.mjs (persists the
// anchor once settings are configured). Kept in one place so the two
// scripts can never disagree about what "safe" means.

import fs from "node:fs";
import path from "node:path";

export const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
fs.mkdirSync(OUT_DIR, { recursive: true });

const STATE_PATH = path.join(OUT_DIR, "state.json");

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

export function todayMinusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The Home page's entries grid only shows the CURRENT rolling weekly
 * pay period (shared/payPeriods.ts: getCurrentPayPeriodAt) — a
 * randomized date outside that window silently never appears, which is
 * exactly the "why isn't my entry showing up" bug this fixes. Returns
 * how many days ago the current period started (0-6), given the
 * workspace's pay-period anchor date (persisted in state.json the one
 * time configureW2Settings sets it). */
export function currentWeeklyPeriodStartDaysAgo(anchorISO) {
  const anchor = new Date(`${anchorISO}T00:00:00Z`);
  const today = new Date(`${todayMinusDays(0)}T00:00:00Z`);
  const diffDays = Math.round((today - anchor) / 86400000);
  const periodsSince = Math.floor(diffDays / 7);
  return Math.max(0, diffDays - periodsSince * 7);
}

/** Same reasoning for Independent — entries/expenses there are bucketed
 * by CURRENT CALENDAR MONTH (getCurrentCalendarMonthPeriodAt /
 * getCalendarMonthBucketAt), so a random date can't cross behind the
 * 1st of the month. */
export function currentMonthMaxDaysBack() {
  const dayOfMonth = new Date().getDate();
  return Math.max(0, Math.min(20, dayOfMonth - 1));
}
