import { appointmentDepositAmount } from "./appointmentDeposits"
import { appointmentLocationLine, appointmentStatus } from "./appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "./invoiceDisplay"
import type { AppointmentType } from "./schemas/appointment"

// ---------------------------------------------------------------------------
// The owner's calendar sync link (/cal/{token}.ics): their appointments as
// an iCalendar file (RFC 5545) that Google Calendar, Apple Calendar and
// Outlook subscribe to and re-read on their own schedule. Read-only.
//
// Times are written in UTC, so every calendar shows them right wherever the
// phone is. Each appointment keeps one UID, so a change replaces the event
// and one that's gone (canceled) drops out on the next refresh.
// ---------------------------------------------------------------------------

export const CALENDAR_FEED_BASE_URL = "https://app.the521app.com/cal/"
export const CALENDAR_FEED_NAME = "521 Bookings"

export function calendarFeedUrl(token: string): string {
  return `${CALENDAR_FEED_BASE_URL}${token}.ics`
}

/** The same link for "Subscribe" on Apple devices. */
export function calendarFeedWebcalUrl(token: string): string {
  return calendarFeedUrl(token).replace(/^https:/, "webcal:")
}

/**
 * Google Calendar's "Add calendar from URL", filled in — by way of Google's
 * sign-in, which keeps the link through signing in ("continue") and goes
 * straight on when already signed in. Opened directly, signing in drops it.
 */
export function googleCalendarSubscribeUrl(token: string): string {
  const subscribe = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calendarFeedWebcalUrl(token))}`
  return `https://accounts.google.com/ServiceLogin?service=cl&passive=true&continue=${encodeURIComponent(subscribe)}`
}

/**
 * Outlook's "Subscribe from web", filled in — as a deeplink through
 * Microsoft's account picker (what Microsoft's own "Sign in" uses), which
 * keeps it through signing in; already signed in, it's one tap. The plain
 * page sends signed-out phones to a marketing page that drops it.
 */
export function outlookCalendarSubscribeUrl(token: string): string {
  const subscribe = `calendar/0/addfromweb?url=${encodeURIComponent(calendarFeedUrl(token))}&name=${encodeURIComponent(CALENDAR_FEED_NAME)}`
  return `https://outlook.live.com/mail/?prompt=select_account&deeplink=${encodeURIComponent(subscribe)}`
}

/** Whether an appointment belongs in the feed: it's happening (or happened). */
export function inCalendarFeed(appointment: AppointmentType, nowIso: string): boolean {
  const status = appointmentStatus(appointment, nowIso)
  // A customer who left the online payment page booked nothing.
  if (appointment.source === "online" && status === "expired") return false
  return status === "confirmed" || status === "requested" || status === "completed" || status === "no_show"
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

/** Lines over 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ""
  let size = 0
  for (const char of line) {
    const charSize = new TextEncoder().encode(char).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + charSize > limit) {
      parts.push(current)
      current = ""
      size = 0
    }
    current += char
    size += charSize
  }
  parts.push(current)
  return parts.join("\r\n ")
}

/** 2026-10-28T19:15:00.000Z → 20261028T191500Z */
function icsTime(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

export type CalendarFeedMoney = "paid" | "due" | "none"

export function buildCalendarFeed(params: {
  appointments: AppointmentType[]
  // Deposit state per appointment id (from its invoice); missing = none.
  deposits: Record<string, CalendarFeedMoney>
  businessName: string
  timeZone: string
  nowIso: string
}): string {
  const { appointments, deposits, nowIso } = params
  const stamp = icsTime(nowIso)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//521//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(CALENDAR_FEED_NAME)}`,
    `X-WR-CALDESC:${escapeText(`Appointments for ${params.businessName.trim() || "your business"}, from 521.`)}`,
    ...(params.timeZone ? [`X-WR-TIMEZONE:${params.timeZone}`] : []),
    // Asks calendars to check often; Google and others may wait longer.
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ]
  for (const appointment of appointments) {
    if (!inCalendarFeed(appointment, nowIso)) continue
    const status = appointmentStatus(appointment, nowIso)
    const prefix = status === "requested" ? "Waiting: " : status === "no_show" ? "No-show: " : ""
    const deposit = appointmentDepositAmount(appointment)
    const money = deposits[appointment.id] ?? (deposit > 0 ? "due" : "none")
    const notes = [
      status === "requested" ? "Waiting for the client to confirm." : null,
      appointment.clientPhone ? `Phone: ${formatInvoicePhone(appointment.clientPhone)}` : null,
      appointment.clientEmail ? `Email: ${appointment.clientEmail}` : null,
      `Price: ${formatInvoiceMoney(appointment.price)}`,
      deposit > 0 ? `Deposit: ${formatInvoiceMoney(deposit)} ${money === "paid" ? "paid" : "due"}` : null,
      appointment.source === "online" ? "Booked online." : null,
      "Manage it in 521.",
    ].filter((line): line is string => line !== null)
    const place = appointmentLocationLine(appointment.location)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${appointment.id}@the521app.com`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsTime(appointment.updatedAt)}`,
      `DTSTART:${icsTime(appointment.startAt)}`,
      `DTEND:${icsTime(appointment.endAt)}`,
      `SUMMARY:${escapeText(`${prefix}${appointment.serviceName} · ${appointment.clientName}`)}`,
      ...(place ? [`LOCATION:${escapeText(place)}`] : []),
      `DESCRIPTION:${escapeText(notes.join("\n"))}`,
      `STATUS:${status === "requested" ? "TENTATIVE" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    )
  }
  lines.push("END:VCALENDAR")
  return lines.map(fold).join("\r\n") + "\r\n"
}
