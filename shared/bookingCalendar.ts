import { DateTime } from "luxon"

import { BOOKING_DAYS, bookingMinutesOfDay, type BookingSettings } from "./schemas/booking"
import type { AppointmentType } from "./schemas/appointment"

// ---------------------------------------------------------------------------
// The Booking page's calendar: a week strip (Sunday first) and one day's
// timeline. Dates and times are the business's wall clock, like the
// appointments themselves (date + startTime in the business time zone).
// ---------------------------------------------------------------------------

export const CALENDAR_DEFAULT_START_MINUTES = 8 * 60
export const CALENDAR_DEFAULT_END_MINUTES = 18 * 60

/** Today's date where the business is. */
export function calendarToday(timeZone: string, now: Date = new Date()): string {
  const local = DateTime.fromJSDate(now, { zone: timeZone || "UTC" })
  return (local.isValid ? local : DateTime.fromJSDate(now, { zone: "UTC" })).toISODate()!
}

/** Minutes since midnight now, where the business is. */
export function calendarNowMinutes(timeZone: string, now: Date = new Date()): number {
  const local = DateTime.fromJSDate(now, { zone: timeZone || "UTC" })
  return local.isValid ? local.hour * 60 + local.minute : now.getUTCHours() * 60 + now.getUTCMinutes()
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!
}

/** The seven dates of the week holding `date`, Sunday first. */
export function calendarWeek(date: string): string[] {
  const day = DateTime.fromISO(date, { zone: "UTC" })
  const sunday = day.minus({ days: day.weekday % 7 })
  return Array.from({ length: 7 }, (_, index) => sunday.plus({ days: index }).toISODate()!)
}

/** "October 2026", or "Oct – Nov 2026" when the week spans two months. */
export function calendarWeekLabel(week: string[]): string {
  const first = DateTime.fromISO(week[0], { zone: "UTC" })
  const last = DateTime.fromISO(week[week.length - 1], { zone: "UTC" })
  if (first.month === last.month) return first.toFormat("LLLL yyyy")
  if (first.year === last.year) return `${first.toFormat("LLL")} – ${last.toFormat("LLL yyyy")}`
  return `${first.toFormat("LLL yyyy")} – ${last.toFormat("LLL yyyy")}`
}

export function calendarDayParts(date: string): { weekday: string; day: number } {
  const day = DateTime.fromISO(date, { zone: "UTC" })
  return { weekday: day.toFormat("ccc"), day: day.day }
}

/** The open blocks for a date (none on a day off), as minutes of the day. */
export function calendarOpenBlocks(
  settings: Pick<BookingSettings, "weeklyHours" | "daysOff">,
  date: string
): Array<{ start: number; end: number }> {
  if (settings.daysOff.includes(date)) return []
  const day = BOOKING_DAYS[DateTime.fromISO(date, { zone: "UTC" }).weekday % 7]
  return settings.weeklyHours[day].map((block) => ({ start: bookingMinutesOfDay(block.start), end: bookingMinutesOfDay(block.end) }))
}

/**
 * The hours the timeline shows, on whole hours: from the earliest opening of
 * the week to the latest closing (8am–6pm with no hours set), stretched to
 * fit the day's appointments.
 */
export function calendarHourRange(
  settings: Pick<BookingSettings, "weeklyHours">,
  appointments: Array<Pick<AppointmentType, "startTime" | "minutes" | "bufferMinutes">>
): { start: number; end: number } {
  const blocks = BOOKING_DAYS.flatMap((day) => settings.weeklyHours[day])
  let start = blocks.length ? Math.min(...blocks.map((block) => bookingMinutesOfDay(block.start))) : CALENDAR_DEFAULT_START_MINUTES
  let end = blocks.length ? Math.max(...blocks.map((block) => bookingMinutesOfDay(block.end))) : CALENDAR_DEFAULT_END_MINUTES
  for (const appointment of appointments) {
    const from = bookingMinutesOfDay(appointment.startTime)
    start = Math.min(start, from)
    end = Math.max(end, from + appointment.minutes + appointment.bufferMinutes)
  }
  start = Math.floor(start / 60) * 60
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60)
  if (end <= start) end = Math.min(24 * 60, start + 60)
  return { start, end }
}

export type CalendarBlock<T> = {
  appointment: T
  // Minutes of the day.
  start: number
  end: number
  bufferEnd: number
  // Side by side when they overlap: which column of how many.
  column: number
  columns: number
}

/** The day's appointments placed on the timeline; overlapping ones share the width. */
export function calendarDayBlocks<T extends Pick<AppointmentType, "startTime" | "minutes" | "bufferMinutes">>(
  appointments: T[]
): Array<CalendarBlock<T>> {
  const placed = appointments
    .map((appointment) => {
      const start = bookingMinutesOfDay(appointment.startTime)
      return { appointment, start, end: start + appointment.minutes, bufferEnd: start + appointment.minutes + appointment.bufferMinutes }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const result: Array<CalendarBlock<T>> = []
  // Groups of blocks that overlap one another, each laid out in columns.
  let group: Array<CalendarBlock<T>> = []
  let groupEnd = -1
  const finish = () => {
    const columns = Math.max(1, ...group.map((block) => block.column + 1))
    for (const block of group) result.push({ ...block, columns })
    group = []
  }
  for (const item of placed) {
    if (group.length && item.start >= groupEnd) finish()
    const taken = new Set(group.filter((block) => block.end > item.start).map((block) => block.column))
    let column = 0
    while (taken.has(column)) column += 1
    group.push({ ...item, column, columns: 1 })
    groupEnd = Math.max(groupEnd, item.end)
  }
  if (group.length) finish()
  return result
}

/** A tapped spot on the timeline as a start time, rounded down to the slot step. */
export function calendarSlotAt(minutes: number, stepMinutes: number): string {
  const step = Math.max(5, stepMinutes)
  const clamped = Math.max(0, Math.min(24 * 60 - step, Math.floor(minutes / step) * step))
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`
}
