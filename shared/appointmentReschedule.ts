import { appointmentStatus, formatAppointmentDate, formatBookingTime, type AppointmentTimes } from "./appointments"
import type { AppointmentType } from "./schemas/appointment"
import type { BookingSettings } from "./schemas/booking"

/* ------------------------------------------------------------
 * RESCHEDULING — moving an appointment to a new time (same service and
 * length). Pure rules shared by the server, the app and tests.
 *
 * The owner can move a waiting or confirmed appointment any time before it
 * starts. A client can move their own confirmed one once, from their link,
 * to one of the business's open times, up to the free-cancel cutoff (with
 * deposits never refunded, Booking setup picks how long before — 24 hours
 * by default — or not at all). The deposit, the invoice and the cancellation rule stay with
 * the appointment; the cutoff and reminders follow its new time.
 * ------------------------------------------------------------ */

export const CLIENT_RESCHEDULE_LIMIT = 1

type Movable = Pick<AppointmentType, "status" | "holdExpiresAt" | "startAt" | "refundCutoffHours" | "reschedules">

/** Whether the owner can move it now: waiting or confirmed, and not started. */
export function ownerCanReschedule(appointment: Pick<AppointmentType, "status" | "holdExpiresAt" | "startAt">, nowIso: string): boolean {
  const status = appointmentStatus(appointment, nowIso)
  return (status === "requested" || status === "confirmed") && nowIso < appointment.startAt
}

/** The last moment the client can move it themselves, or null if they can't. */
export function clientRescheduleDeadline(
  appointment: Pick<AppointmentType, "startAt" | "refundCutoffHours">,
  noRefundHours: BookingSettings["noRefundRescheduleHours"]
): string | null {
  const hours = appointment.refundCutoffHours ?? noRefundHours
  if (hours === null) return null
  return new Date(Date.parse(appointment.startAt) - hours * 3_600_000).toISOString()
}

// The client's page while they move it: a warning first ("you can only do
// this once, until …"), then open days, a day's open times, "Move to …?".
export type ClientMoveView =
  | { step: "warn"; deadline: string }
  | { step: "days"; days: string[]; moreFrom: string | null }
  | { step: "times"; date: string; times: string[]; taken?: boolean }
  | { step: "confirm"; date: string; time: string }

export type ClientRescheduleCheck =
  | { ok: true; deadline: string }
  | { ok: false; reason: "status" | "used" | "late" | "off" }

/** Whether the client can move it from their link now, and why not. */
export function clientCanReschedule(
  appointment: Movable,
  noRefundHours: BookingSettings["noRefundRescheduleHours"],
  nowIso: string
): ClientRescheduleCheck {
  if (appointmentStatus(appointment, nowIso) !== "confirmed" || nowIso >= appointment.startAt) return { ok: false, reason: "status" }
  if (appointment.reschedules.filter((move) => move.by === "client").length >= CLIENT_RESCHEDULE_LIMIT) {
    return { ok: false, reason: "used" }
  }
  const deadline = clientRescheduleDeadline(appointment, noRefundHours)
  if (deadline === null) return { ok: false, reason: "off" }
  if (nowIso >= deadline) return { ok: false, reason: "late" }
  return { ok: true, deadline }
}

/** The appointment at its new time, with the move recorded. */
export function rescheduledAppointment(
  appointment: AppointmentType,
  move: { date: string; startTime: string; times: AppointmentTimes; outsideHours: boolean; by: "owner" | "client"; nowIso: string }
): AppointmentType {
  return {
    ...appointment,
    date: move.date,
    startTime: move.startTime,
    ...move.times,
    outsideHours: move.outsideHours,
    reschedules: [
      ...appointment.reschedules,
      { fromDate: appointment.date, fromStartTime: appointment.startTime, fromStartAt: appointment.startAt, at: move.nowIso, by: move.by },
    ],
    updatedAt: move.nowIso,
  }
}

/** "Tue, Dec 2 at 10am": where a move came from. */
export function formatMovedFrom(move: { fromDate: string; fromStartTime: string }, thisYear?: string): string {
  return `${formatAppointmentDate(move.fromDate, thisYear)} at ${formatBookingTime(move.fromStartTime)}`
}
