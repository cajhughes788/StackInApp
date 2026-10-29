import { DateTime } from "luxon"

import type { AppointmentType } from "./schemas/appointment"

/* ------------------------------------------------------------
 * BUSY TIMES — when the owner is busy in their own calendars (read by
 * shared/busyCalendar.ts on the server), and how that blocks booking.
 * No calendar library here, so the app can use it too.
 * ------------------------------------------------------------ */

// A busy stretch: [start, end), instants.
export type BusyBlock = { start: string; end: string }
// A busy all-day event: dates in the business's calendar, end exclusive.
export type BusyDays = { startDate: string; endDate: string }
export type ParsedBusyTimes = { timed: BusyBlock[]; allDay: BusyDays[] }

export const MAX_BUSY_CALENDARS = 3
export const BUSY_CALENDAR_NAME_MAX = 40
// Kept per calendar, after merging overlaps.
export const MAX_BUSY_BLOCKS = 1500
// Re-read when older than this (the job runs every 15 minutes; the booking
// page also re-reads a stale one).
export const BUSY_REFRESH_MS = 15 * 60_000
// Busy times last read longer ago than this aren't used: a broken link
// never blocks the schedule for good.
export const BUSY_STALE_MS = 24 * 3_600_000

export class BusyCalendarError extends Error {}

function validZone(zone: string | null | undefined): zone is string {
  return !!zone && DateTime.local().setZone(zone).isValid
}

/**
 * The link as 521 fetches it: webcal:// (what Apple and Outlook hand out)
 * becomes https://; anything that isn't a plain https web address is an
 * error the owner sees.
 */
export function normalizeBusyCalendarUrl(raw: string): string {
  const text = raw.trim().replace(/^webcals?:\/\//i, "https://")
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new BusyCalendarError("That doesn't look like a web link. Paste the whole calendar link.")
  }
  if (url.protocol !== "https:") throw new BusyCalendarError("Use the calendar's https:// or webcal:// link.")
  if (url.username || url.password) throw new BusyCalendarError("Use the calendar's link without a username or password in it.")
  if (text.length > 2000) throw new BusyCalendarError("That link is too long.")
  return url.toString()
}

/** "calendar.google.com" — what's shown for a saved link, never the private part. */
export function busyCalendarHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

/** Overlapping or touching blocks become one, earliest first. */
export function mergeBusyBlocks(blocks: BusyBlock[]): BusyBlock[] {
  const sorted = [...blocks].filter((block) => block.start < block.end).sort((a, b) => a.start.localeCompare(b.start))
  const merged: BusyBlock[] = []
  for (const block of sorted) {
    const last = merged[merged.length - 1]
    if (last && Date.parse(block.start) <= Date.parse(last.end)) {
      if (block.end > last.end) last.end = block.end
    } else {
      merged.push({ ...block })
    }
  }
  return merged
}

export type StoredBusyTimes = ParsedBusyTimes & { okAt: string | null }

/**
 * The busy blocks that count now, from every calendar: timed events, plus
 * all-day ones when Booking setup's switch is on (the whole day, in the
 * business's time zone). A calendar last read more than a day ago is left
 * out.
 */
export function activeBusyBlocks(
  calendars: StoredBusyTimes[],
  options: { allDayBlocks: boolean; timeZone: string; nowIso: string }
): BusyBlock[] {
  const zone = validZone(options.timeZone) ? options.timeZone : "UTC"
  const now = Date.parse(options.nowIso)
  const blocks: BusyBlock[] = []
  for (const calendar of calendars) {
    if (!calendar.okAt || now - Date.parse(calendar.okAt) > BUSY_STALE_MS) continue
    blocks.push(...calendar.timed)
    if (!options.allDayBlocks) continue
    for (const days of calendar.allDay) {
      blocks.push({
        start: DateTime.fromISO(days.startDate, { zone }).toUTC().toISO()!,
        end: DateTime.fromISO(days.endDate, { zone }).toUTC().toISO()!,
      })
    }
  }
  return mergeBusyBlocks(blocks)
}

/** Busy blocks shaped like appointments, for the open-times and double-booking checks. */
export function busyAsAppointments(blocks: BusyBlock[]): Array<Pick<AppointmentType, "id" | "startAt" | "blockedUntil" | "status" | "holdExpiresAt">> {
  return blocks.map((block, index) => ({
    id: `busy_${index}`,
    startAt: block.start,
    blockedUntil: block.end,
    status: "confirmed" as const,
    holdExpiresAt: null,
  }))
}

/** The busy block a time [startAt, blockedUntil) runs into, or null. */
export function findBusyConflict<T extends BusyBlock>(times: { startAt: string; blockedUntil: string }, blocks: T[]): T | null {
  const start = Date.parse(times.startAt)
  const end = Date.parse(times.blockedUntil)
  return blocks.find((block) => start < Date.parse(block.end) && Date.parse(block.start) < end) ?? null
}

/**
 * The busy times on one date, as minutes from that day's midnight in the
 * business's time zone (cut to the day), for the Booking calendar.
 */
export function busyMinutesOnDate<T extends BusyBlock>(
  blocks: T[],
  date: string,
  timeZone: string
): Array<{ start: number; end: number; block: T }> {
  const zone = validZone(timeZone) ? timeZone : "UTC"
  const dayStart = DateTime.fromISO(date, { zone })
  if (!dayStart.isValid) return []
  const dayEnd = dayStart.plus({ days: 1 })
  const from = dayStart.toMillis()
  const to = dayEnd.toMillis()
  // Wall-clock minutes, so a daylight-saving day still lines up with its hours.
  const clock = (ms: number) => {
    if (ms >= to) return 1440
    const at = DateTime.fromMillis(ms, { zone })
    return at.hour * 60 + at.minute
  }
  return blocks.flatMap((block) => {
    const start = Math.max(Date.parse(block.start), from)
    const end = Math.min(Date.parse(block.end), to)
    if (start >= end) return []
    return [{ start: clock(start), end: clock(end), block }]
  })
}
