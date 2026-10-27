import { DateTime } from "luxon"

import { BOOKING_DAYS, BOOKING_DAY_NAMES, bookingMinutesOfDay, type BookingSettings } from "./schemas/booking"
import { APPOINTMENT_HOLD_HOURS, type AppointmentStatus, type AppointmentType } from "./schemas/appointment"

/* ------------------------------------------------------------
 * APPOINTMENTS — pure rules shared by the server, the app and tests:
 * times, overlap (double-booking), the 48-hour hold, and the
 * "outside your hours" warning.
 * ------------------------------------------------------------ */

// The client's confirm page (served by the publicAppointment function;
// firebase.json rewrites /b/** there).
export const PUBLIC_APPOINTMENT_BASE_URL = "https://app.the521app.com/b/"

export function publicAppointmentUrl(shareToken: string): string {
  return `${PUBLIC_APPOINTMENT_BASE_URL}${shareToken}`
}

// Longest appointment plus longest buffer (12 h + 4 h), and an hour spare:
// anything that starts earlier than this can't reach a new appointment.
export const APPOINTMENT_LOOKBACK_MS = 17 * 3_600_000

export type AppointmentTimes = { startAt: string; endAt: string; blockedUntil: string }

/** The UTC moments for a wall-clock date and time in a time zone, or null if they don't exist. */
export function appointmentTimes(input: {
  date: string
  startTime: string
  timeZone: string
  minutes: number
  bufferMinutes: number
}): AppointmentTimes | null {
  const start = DateTime.fromISO(`${input.date}T${input.startTime}`, { zone: input.timeZone })
  if (!start.isValid) return null
  const utc = start.toUTC()
  return {
    startAt: utc.toISO()!,
    endAt: utc.plus({ minutes: input.minutes }).toISO()!,
    blockedUntil: utc.plus({ minutes: input.minutes + input.bufferMinutes }).toISO()!,
  }
}

export function appointmentHoldExpiresAt(createdAtIso: string): string {
  return new Date(Date.parse(createdAtIso) + APPOINTMENT_HOLD_HOURS * 3_600_000).toISOString()
}

/** The status as of now: an unanswered request past its hold has expired. */
export function appointmentStatus(
  appointment: Pick<AppointmentType, "status" | "holdExpiresAt">,
  nowIso: string
): AppointmentStatus {
  if (appointment.status === "requested" && appointment.holdExpiresAt && appointment.holdExpiresAt <= nowIso) {
    return "expired"
  }
  return appointment.status
}

/** Whether it keeps its time from anyone else (canceled, declined and expired ones don't). */
export function appointmentHoldsTime(
  appointment: Pick<AppointmentType, "status" | "holdExpiresAt">,
  nowIso: string
): boolean {
  const status = appointmentStatus(appointment, nowIso)
  return status === "requested" || status === "confirmed" || status === "completed"
}

type TimeSpan = Pick<AppointmentType, "startAt" | "blockedUntil">

// Each keeps its time plus its buffer; touching (one ends as the next
// starts) is fine.
export function appointmentsOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return Date.parse(a.startAt) < Date.parse(b.blockedUntil) && Date.parse(b.startAt) < Date.parse(a.blockedUntil)
}

/** The first appointment this would double-book, or null. */
export function findAppointmentConflict<T extends Pick<AppointmentType, "id" | "startAt" | "blockedUntil" | "status" | "holdExpiresAt">>(
  candidate: TimeSpan,
  existing: T[],
  nowIso: string,
  ignoreId?: string
): T | null {
  return (
    existing.find(
      (other) => other.id !== ignoreId && appointmentHoldsTime(other, nowIso) && appointmentsOverlap(candidate, other)
    ) ?? null
  )
}

/** "9am", "9:30am", "12pm". */
export function formatBookingTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number)
  const suffix = hours < 12 ? "am" : "pm"
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return minutes ? `${hour12}:${String(minutes).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`
}

/** The wall-clock end time ("HH:MM"), wrapping past midnight. */
export function appointmentEndTime(startTime: string, minutes: number): string {
  const end = (bookingMinutesOfDay(startTime) + minutes) % 1440
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`
}

/** "Tue, Dec 1" (with the year when it isn't this year's). */
export function formatAppointmentDate(date: string, thisYear?: string): string {
  const day = new Date(`${date}T12:00:00Z`)
  const sameYear = thisYear ? date.slice(0, 4) === thisYear : true
  return day.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  })
}

/**
 * Why this time is outside the weekly hours or on a day off, or null if it
 * fits. Only a warning: the owner can still book it.
 */
export function bookingHoursWarning(
  settings: Pick<BookingSettings, "weeklyHours" | "daysOff">,
  date: string,
  startTime: string,
  minutes: number
): string | null {
  if (settings.daysOff.includes(date)) return "That's on one of your days off."
  const day = BOOKING_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
  const blocks = settings.weeklyHours[day]
  const dayName = BOOKING_DAY_NAMES[day]
  if (blocks.length === 0) return `You're closed on ${dayName}s.`
  const start = bookingMinutesOfDay(startTime)
  const end = start + minutes
  const fits = blocks.some((block) => start >= bookingMinutesOfDay(block.start) && end <= bookingMinutesOfDay(block.end))
  if (fits) return null
  const hours = [...blocks]
    .sort((a, b) => bookingMinutesOfDay(a.start) - bookingMinutesOfDay(b.start))
    .map((block) => `${formatBookingTime(block.start)}–${formatBookingTime(block.end)}`)
    .join(", ")
  return `That's outside your ${dayName} hours (${hours}).`
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  requested: "Waiting on client",
  confirmed: "Confirmed",
  declined: "Client can't make it",
  canceled: "Canceled",
  completed: "Done",
  expired: "Expired — no answer",
}
