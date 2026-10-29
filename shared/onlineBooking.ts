import { DateTime } from "luxon"

import { appointmentStatus, appointmentTimes, findAppointmentConflict, type AppointmentTimes } from "./appointments"
import type { AppointmentType } from "./schemas/appointment"
import { BOOKING_DAYS, bookingMinutesOfDay, type BookingSettings } from "./schemas/booking"

/* ------------------------------------------------------------
 * ONLINE BOOKING — pure rules shared by the server, the app and tests
 * (step 4 of booking): the business's public link, and which start times a
 * customer is offered.
 *
 * A time is open when the whole service fits inside one block of that
 * day's hours, the day isn't a day off, it's at least the minimum notice
 * away and within "book up to", it starts on the slot step (counted from
 * the block's start), and it doesn't overlap another appointment's time
 * plus buffer (the same check the owner's bookings use).
 * ------------------------------------------------------------ */

// The customer's page (the publicBooking function; firebase.json rewrites
// /book/** there).
export const PUBLIC_BOOKING_BASE_URL = "https://app.the521app.com/book/"

export function publicBookingUrl(slug: string): string {
  return `${PUBLIC_BOOKING_BASE_URL}${slug}`
}

// The "Book now" button on the owner's website links with ?via=site; the
// page carries it through each step so the booking is marked as coming from
// their website (Appointment.bookedFrom).
export const BOOKING_VIA_WEBSITE = "site"

export function websiteBookingUrl(slug: string): string {
  return `${publicBookingUrl(slug)}?via=${BOOKING_VIA_WEBSITE}`
}

export const BOOKING_BUTTON_LABEL_MAX = 40
export const DEFAULT_BOOKING_BUTTON_LABEL = "Book now"
const BUTTON_HEX = /^#[0-9a-fA-F]{6}$/

function escapeButtonText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// White text on dark colors, charcoal on light ones.
function buttonTextColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? "#161B1E" : "#FFFFFF"
}

/**
 * The code an owner pastes into their website: a plain styled link that
 * opens their booking page in a new tab. No script, so it can't break or
 * slow their site, and Stripe checkout works as it does from the link.
 */
export function bookingButtonCode(input: { slug: string; label: string; color: string }): string {
  const color = BUTTON_HEX.test(input.color) ? input.color.toUpperCase() : "#2FA866"
  const label = input.label.trim().slice(0, BOOKING_BUTTON_LABEL_MAX) || DEFAULT_BOOKING_BUTTON_LABEL
  const style = [
    "display:inline-block",
    "padding:14px 28px",
    "border-radius:999px",
    `background:${color}`,
    `color:${buttonTextColor(color)}`,
    "font:600 16px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    "text-decoration:none",
  ].join(";")
  return `<a href="${websiteBookingUrl(input.slug)}" target="_blank" rel="noopener" style="${style}">${escapeButtonText(label)}</a>`
}

export const BOOKING_SLUG_MIN = 3
export const BOOKING_SLUG_MAX = 40
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
// Words that would read as 521's own pages, or confuse people.
const RESERVED_SLUGS = new Set([
  "521",
  "admin",
  "api",
  "app",
  "book",
  "booking",
  "bookings",
  "help",
  "login",
  "new",
  "settings",
  "signup",
  "support",
  "the521app",
  "www",
])

/** Why this link name can't be used, or null. */
export function bookingSlugProblem(slug: string): string | null {
  if (slug.length < BOOKING_SLUG_MIN) return `Use at least ${BOOKING_SLUG_MIN} characters.`
  if (slug.length > BOOKING_SLUG_MAX) return `Use at most ${BOOKING_SLUG_MAX} characters.`
  if (!SLUG_PATTERN.test(slug) || slug.includes("--")) {
    return "Use lowercase letters, numbers and single dashes, starting and ending with a letter or number."
  }
  if (RESERVED_SLUGS.has(slug)) return "That link is reserved. Try another."
  return null
}

/** A link name from what's typed or the business name: "Fresh Cuts ATX!" → "fresh-cuts-atx". */
export function bookingSlugFrom(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BOOKING_SLUG_MAX)
    .replace(/-+$/g, "")
  return slug.length >= BOOKING_SLUG_MIN ? slug : ""
}

type OpenTimesSettings = Pick<
  BookingSettings,
  "weeklyHours" | "daysOff" | "minNoticeHours" | "maxDaysAhead" | "slotStepMinutes" | "timeZone"
>
type OpenTimesService = { minutes: number; bufferMinutes: number }
type Booked = Pick<AppointmentType, "id" | "startAt" | "blockedUntil" | "status" | "holdExpiresAt">

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** The first and last dates a customer can book, in the business's time zone. */
export function bookingDateRange(settings: Pick<BookingSettings, "maxDaysAhead" | "timeZone">, nowIso: string): { first: string; last: string } {
  const today = DateTime.fromISO(nowIso, { zone: settings.timeZone }).toISODate() ?? nowIso.slice(0, 10)
  return { first: today, last: shiftDate(today, settings.maxDaysAhead) }
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** The open start times ("HH:MM", earliest first) for one service on one date. */
export function bookingOpenTimes(input: {
  settings: OpenTimesSettings
  service: OpenTimesService
  date: string
  appointments: Booked[]
  nowIso: string
}): string[] {
  const { settings, service, date, nowIso } = input
  const range = bookingDateRange(settings, nowIso)
  if (date < range.first || date > range.last || settings.daysOff.includes(date)) return []
  const blocks = settings.weeklyHours[BOOKING_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]] ?? []
  const earliest = Date.parse(nowIso) + settings.minNoticeHours * 3_600_000
  const open = new Set<string>()
  for (const block of blocks) {
    const end = bookingMinutesOfDay(block.end)
    for (let start = bookingMinutesOfDay(block.start); start + service.minutes <= end; start += settings.slotStepMinutes) {
      const time = hhmm(start)
      const times = appointmentTimes({ date, startTime: time, timeZone: settings.timeZone, ...service })
      if (!times || !wallClockMatches(times, date, time, settings.timeZone)) continue
      if (Date.parse(times.startAt) < earliest) continue
      if (findAppointmentConflict(times, input.appointments, nowIso)) continue
      open.add(time)
    }
  }
  return [...open].sort()
}

// A time skipped by the spring-forward change (2:30am that night) doesn't
// exist; luxon would quietly move it an hour later.
function wallClockMatches(times: AppointmentTimes, date: string, time: string, timeZone: string): boolean {
  const local = DateTime.fromISO(times.startAt, { zone: timeZone })
  return local.toISODate() === date && local.toFormat("HH:mm") === time
}

/** Up to `limit` dates from `from` on that have at least one open time. */
export function bookingOpenDays(input: {
  settings: OpenTimesSettings
  service: OpenTimesService
  appointments: Booked[]
  nowIso: string
  from?: string
  limit: number
}): string[] {
  const range = bookingDateRange(input.settings, input.nowIso)
  const days: string[] = []
  for (let date = input.from && input.from > range.first ? input.from : range.first; date <= range.last && days.length < input.limit; date = shiftDate(date, 1)) {
    if (bookingOpenTimes({ ...input, date }).length > 0) days.push(date)
  }
  return days
}

export const ONLINE_BOOKING_COUNT_DAYS = 30

/**
 * Online bookings made in the last 30 days, and how many came through the
 * "Book now" button on the owner's website — for the Booking page. Canceled,
 * declined and abandoned (expired) ones don't count.
 */
export function onlineBookingCounts(
  appointments: Array<Pick<AppointmentType, "source" | "bookedFrom" | "createdAt" | "status" | "holdExpiresAt">>,
  nowIso: string
): { online: number; website: number } {
  const since = new Date(Date.parse(nowIso) - ONLINE_BOOKING_COUNT_DAYS * 86_400_000).toISOString()
  const counted = appointments.filter((appointment) => {
    if (appointment.source !== "online" || appointment.createdAt < since) return false
    const status = appointmentStatus(appointment, nowIso)
    return status !== "canceled" && status !== "declined" && status !== "expired"
  })
  return { online: counted.length, website: counted.filter((appointment) => appointment.bookedFrom === "website").length }
}
