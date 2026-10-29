import { db } from "../admin"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import { appointmentsCol, conflictMessage, findSharedAppointment, overlapQuery, parseAppointment, type SharedAppointment } from "./appointmentsService"
import { readBookingSettings } from "./bookingService"
import { invoicesCol } from "./invoicesService"
import type { AppointmentEmailResult } from "./appointmentEmailService"
import { appointmentInvoiceFields } from "@shared/appointmentDeposits"
import {
  clientCanReschedule,
  ownerCanReschedule,
  rescheduledAppointment,
  type ClientMoveView,
  type ClientRescheduleCheck,
} from "@shared/appointmentReschedule"
import { APPOINTMENT_LOOKBACK_MS, appointmentTimes, bookingHoursWarning, findAppointmentConflict } from "@shared/appointments"
import { busyAsAppointments } from "@shared/busyTimes"
import { bookingDateRange, bookingOpenDays, bookingOpenTimes } from "@shared/onlineBooking"
import { AppointmentSchema, type AppointmentType } from "@shared/schemas/appointment"
import type { BookingSettings } from "@shared/schemas/booking"
import { InvoiceSchema } from "@shared/schemas/invoice"

// ---------------------------------------------------------------------------
// Rescheduling (shared/appointmentReschedule.ts): the owner moves an
// appointment from the app; a client moves their own once from their link,
// to one of the business's open times. Either way it's the same appointment
// — deposit, invoice and link — at a new time.
// ---------------------------------------------------------------------------

type Blocking = Pick<AppointmentType, "id" | "startAt" | "blockedUntil" | "status" | "holdExpiresAt">

// Days the client can pick, then times on a day (the booking page's rules).
const MOVE_DAYS_PER_PAGE = 14

async function busyBlocking(workspaceId: string, booking: BookingSettings, refreshStale: boolean): Promise<Blocking[]> {
  try {
    const { busyBlocksFor } = await import("./busyCalendarsService.js")
    return busyAsAppointments(await busyBlocksFor(workspaceId, booking, { refreshStale, timeoutMs: 4000 }))
  } catch (error) {
    console.error("appointmentReschedule: busy calendars failed", { workspaceId }, error)
    return []
  }
}

// Everything that blocks a time from now to the last bookable day, except
// the appointment being moved (it may move into its own old time).
async function blockingAhead(workspaceId: string, booking: BookingSettings, excludeId: string, nowIso: string): Promise<Blocking[]> {
  const { last } = bookingDateRange(booking, nowIso)
  const from = new Date(Date.parse(nowIso) - APPOINTMENT_LOOKBACK_MS).toISOString()
  const to = new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000).toISOString()
  const [snap, busy] = await Promise.all([
    appointmentsCol(workspaceId).where("startAt", ">", from).where("startAt", "<", to).limit(3000).get(),
    busyBlocking(workspaceId, booking, true),
  ])
  const appointments = snap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? []).filter((item) => item.id !== excludeId)
  return [...appointments, ...busy]
}

/** What the client's page shows for moving: open days, a day's open times, or the confirm step. */
export async function clientMoveView(
  shared: SharedAppointment,
  // null: only whether they may (the page itself, not picking a time).
  query: { date?: string; from?: string; time?: string } | null
): Promise<{ check: ClientRescheduleCheck; view: ClientMoveView | null }> {
  const booking = await readBookingSettings(shared.workspaceId)
  const nowIso = new Date().toISOString()
  const check = clientCanReschedule(shared.appointment, booking.noRefundRescheduleHours, nowIso)
  if (!check.ok || !query) return { check, view: null }
  const service = { minutes: shared.appointment.minutes, bufferMinutes: shared.appointment.bufferMinutes }
  const appointments = await blockingAhead(shared.workspaceId, booking, shared.appointment.id, nowIso)
  const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null
  if (!date) {
    const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : undefined
    const days = bookingOpenDays({ settings: booking, service, appointments, nowIso, from, limit: MOVE_DAYS_PER_PAGE + 1 })
    return {
      check,
      view: { step: "days", days: days.slice(0, MOVE_DAYS_PER_PAGE), moreFrom: days.length > MOVE_DAYS_PER_PAGE ? days[MOVE_DAYS_PER_PAGE] : null },
    }
  }
  // Its own current time isn't a move.
  const times = bookingOpenTimes({ settings: booking, service, date, appointments, nowIso }).filter(
    (time) => !(date === shared.appointment.date && time === shared.appointment.startTime)
  )
  if (query.time && times.includes(query.time)) return { check, view: { step: "confirm", date, time: query.time } }
  return { check, view: { step: "times", date, times, taken: !!query.time } }
}

type MoveTarget = { date: string; startTime: string }

/**
 * Moves the appointment and records it. The owner may pick any free time
 * (outside their hours is allowed and flagged, as when booking); a client
 * only an open time, within their one move and the deadline.
 */
async function moveAppointment(
  workspaceId: string,
  appointmentId: string,
  target: MoveTarget,
  by: "owner" | "client"
): Promise<{ before: AppointmentType; after: AppointmentType } | "taken" | "not_allowed"> {
  const booking = await readBookingSettings(workspaceId)
  const busy = by === "client" ? await busyBlocking(workspaceId, booking, false) : []
  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const stored = snap.exists ? parseAppointment(snap.data()) : null
    if (!stored) throw new NotFoundError("Appointment not found")
    const nowIso = new Date().toISOString()
    if (by === "owner" && !ownerCanReschedule(stored, nowIso)) {
      throw new ConflictError("Only a waiting or confirmed appointment that hasn't started can be moved.")
    }
    if (by === "client" && !clientCanReschedule(stored, booking.noRefundRescheduleHours, nowIso).ok) return "not_allowed"

    const times = appointmentTimes({ ...target, timeZone: stored.timeZone, minutes: stored.minutes, bufferMinutes: stored.bufferMinutes })
    if (!times) throw new BadRequestError("That date and time don't exist in your time zone.")
    if (times.startAt <= nowIso) throw new BadRequestError("That time has already passed.")
    if (times.startAt === stored.startAt) throw new BadRequestError("That's the time it already has.")

    const nearbySnap = await txn.get(overlapQuery(workspaceId, times.startAt, times.blockedUntil))
    const nearby = nearbySnap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? []).filter((item) => item.id !== stored.id)
    if (by === "owner") {
      const conflict = findAppointmentConflict(times, nearby, nowIso)
      if (conflict) throw new ConflictError(conflictMessage(conflict))
    } else {
      const open = bookingOpenTimes({
        settings: booking,
        service: { minutes: stored.minutes, bufferMinutes: stored.bufferMinutes },
        date: target.date,
        appointments: [...nearby, ...busy],
        nowIso,
      })
      if (!open.includes(target.startTime)) return "taken"
    }

    const after = AppointmentSchema.parse(
      rescheduledAppointment(stored, {
        ...target,
        times,
        outsideHours: bookingHoursWarning(booking, target.date, target.startTime, stored.minutes) !== null,
        by,
        nowIso,
      })
    )
    txn.set(ref, after)
    return { before: stored, after }
  })
}

// The appointment's invoice names its date: keep it in step (and its due
// date, while it's open).
async function moveInvoice(workspaceId: string, before: AppointmentType, after: AppointmentType): Promise<void> {
  if (!after.invoiceId) return
  try {
    const ref = invoicesCol(workspaceId).doc(after.invoiceId)
    await db.runTransaction(async (txn) => {
      const parsed = InvoiceSchema.safeParse((await txn.get(ref)).data())
      if (!parsed.success) return
      const invoice = parsed.data
      const oldLine = appointmentInvoiceFields(before, invoice.issueDate).lines[0].description
      const newLine = appointmentInvoiceFields(after, invoice.issueDate).lines[0].description
      const lines = invoice.lines.map((line) => (line.description === oldLine ? { ...line, description: newLine } : line))
      const dueDate = invoice.status === "sent" && after.date >= invoice.issueDate ? after.date : invoice.dueDate
      txn.set(ref, InvoiceSchema.parse({ ...invoice, lines, dueDate, updatedAt: new Date().toISOString() }))
    })
  } catch (error) {
    // The appointment moved either way; only the invoice's wording lags.
    console.error("appointmentReschedule: invoice update failed", { workspaceId, id: after.id }, error)
  }
}

/** The owner's "Change time". Emails the client the new time when Booking setup says so. */
export async function rescheduleByOwner(
  workspaceId: string,
  appointmentId: string,
  target: MoveTarget
): Promise<{ appointment: AppointmentType; email: AppointmentEmailResult }> {
  const moved = await moveAppointment(workspaceId, appointmentId, target, "owner")
  if (moved === "taken" || moved === "not_allowed") throw new ConflictError("That time isn't available.")
  await moveInvoice(workspaceId, moved.before, moved.after)
  const { emailAppointmentMoved } = await import("./appointmentEmailService.js")
  const { result, appointment } = await emailAppointmentMoved(workspaceId, moved.after, "owner")
  return { appointment, email: result }
}

/** The client moving their own appointment from its link. */
export async function rescheduleByClient(token: string, target: MoveTarget): Promise<"moved" | "taken" | "not_allowed" | "not_found"> {
  const shared = await findSharedAppointment(token)
  if (!shared) return "not_found"
  const moved = await moveAppointment(shared.workspaceId, shared.appointment.id, target, "client")
  if (moved === "taken" || moved === "not_allowed") return moved
  await moveInvoice(shared.workspaceId, moved.before, moved.after)
  const { notifyOwnerAboutAppointment } = await import("./appointmentNotifications.js")
  await notifyOwnerAboutAppointment(shared.workspaceId, moved.after, "rescheduled")
  const { emailAppointmentMoved } = await import("./appointmentEmailService.js")
  await emailAppointmentMoved(shared.workspaceId, moved.after, "client")
  return "moved"
}
