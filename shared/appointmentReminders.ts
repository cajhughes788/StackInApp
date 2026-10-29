import { DateTime } from "luxon"

import { formatBookingTime } from "./appointments"
import type { AppointmentType } from "./schemas/appointment"
import type { BookingReminders } from "./schemas/booking"

/* ------------------------------------------------------------
 * APPOINTMENT REMINDERS — pure rules shared by the server and tests.
 *
 * A confirmed appointment gets up to two reminder emails, at the times
 * Booking setup picks (BookingSettings.reminders: hours ahead, like 24 and
 * 2). A reminder is skipped when the appointment was booked (or confirmed)
 * after its time had already come: booked 5 hours ahead, there's no "1 day
 * before". The one due is always the latest whose time has come, so when
 * two come due at once only the one closer to the appointment goes.
 *
 * The scheduled job (sendAppointmentReminders) asks every 15 minutes; each
 * reminder is sent once per appointment time, so moving an appointment
 * starts its reminders over.
 * ------------------------------------------------------------ */

// A reminder is named by how many hours ahead it goes.
export type AppointmentReminderHours = number

const HOUR_MS = 3_600_000
// How far ahead the job looks: the longest reminder there is (1 week).
export const APPOINTMENT_REMINDER_HORIZON_MS = 168 * HOUR_MS

type ReminderAppointment = Pick<AppointmentType, "status" | "startAt" | "createdAt" | "respondedAt">

/** The reminder due for this appointment now (its hours ahead), or null. */
export function dueAppointmentReminder(
  appointment: ReminderAppointment,
  reminders: BookingReminders,
  nowIso: string
): AppointmentReminderHours | null {
  if (reminders.length === 0 || appointment.status !== "confirmed" || nowIso >= appointment.startAt) return null
  const start = Date.parse(appointment.startAt)
  const now = Date.parse(nowIso)
  // When it became a booking the client is coming to.
  const bookedAt = Math.max(Date.parse(appointment.createdAt), appointment.respondedAt ? Date.parse(appointment.respondedAt) : 0)
  // The latest one whose time has come.
  const due = [...reminders].sort((a, b) => a - b).find((hours) => now >= start - hours * HOUR_MS)
  if (due === undefined) return null
  return bookedAt < start - due * HOUR_MS ? due : null
}

/** Marks one reminder for one appointment time: moving the appointment gets a new key. */
export function appointmentReminderKey(appointment: Pick<AppointmentType, "id" | "startAt">, hours: AppointmentReminderHours | "nudge"): string {
  return `reminder_${hours === "nudge" ? "nudge" : `${hours}h`}_${appointment.id}_${Date.parse(appointment.startAt)}`
}

/** "today", "tomorrow", or "on Tue, Nov 3", in the business's time zone. */
export function appointmentDayWords(appointment: Pick<AppointmentType, "startAt" | "timeZone">, nowIso: string): string {
  const zone = appointment.timeZone || "UTC"
  const start = DateTime.fromISO(appointment.startAt, { zone })
  const today = DateTime.fromISO(nowIso, { zone }).startOf("day")
  if (!start.isValid || !today.isValid) return ""
  const days = Math.round(start.startOf("day").diff(today, "days").days)
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  return `on ${start.toFormat("ccc, LLL d")}`
}

/** "today", "tomorrow", or "in 3 days, on Thu, Dec 3": the reminder's opening line. */
export function appointmentWhenWords(appointment: Pick<AppointmentType, "startAt" | "timeZone">, nowIso: string): string {
  const words = appointmentDayWords(appointment, nowIso)
  if (!words.startsWith("on ")) return words
  const zone = appointment.timeZone || "UTC"
  const days = Math.round(
    DateTime.fromISO(appointment.startAt, { zone }).startOf("day").diff(DateTime.fromISO(nowIso, { zone }).startOf("day"), "days").days
  )
  return days > 1 ? `in ${days} days, ${words}` : words
}

/** "Tue, Nov 3 at 3pm", in the business's time zone. */
export function formatReminderMoment(iso: string, timeZone: string): string {
  const at = DateTime.fromISO(iso, { zone: timeZone || "UTC" })
  if (!at.isValid) return ""
  const time = at.minute ? at.toFormat("h:mma") : at.toFormat("ha")
  return `${at.toFormat("ccc, LLL d")} at ${time.toLowerCase()}`
}

/**
 * The owner's push when a client has no email for their 1-day reminder:
 * "Tomorrow 10am: Sam has no email for a reminder".
 */
export function appointmentReminderNudgeText(
  appointment: Pick<AppointmentType, "clientName" | "startAt" | "startTime" | "timeZone">,
  nowIso: string
): { title: string; body: string } {
  const words = appointmentDayWords(appointment, nowIso).replace(/^on /, "")
  const when = `${words.charAt(0).toUpperCase()}${words.slice(1)} ${formatBookingTime(appointment.startTime)}`
  return {
    title: `${when}: ${appointment.clientName} has no email for a reminder`,
    body: "Tap to text them their appointment link.",
  }
}
