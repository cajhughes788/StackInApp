import sgMail from "@sendgrid/mail"
import { db } from "../admin"
import { SENDGRID_API_KEY } from "../secrets"
import { TooManyRequestsError } from "../lib/httpErrors"
import { appointmentsCol, parseAppointment } from "./appointmentsService"
import { readBookingSettings } from "./bookingService"
import { readInvoiceSettings } from "./invoicesService"
import { appointmentDepositOnline, appointmentMoney } from "@shared/appointmentDeposits"
import { buildAppointmentEmail, type AppointmentEmailKind } from "@shared/appointmentEmail"
import { appointmentReminderKey, type AppointmentReminderHours } from "@shared/appointmentReminders"
import { publicAppointmentUrl } from "@shared/appointments"
import { AppointmentSchema, type AppointmentType } from "@shared/schemas/appointment"

// ---------------------------------------------------------------------------
// 521 emails a client their appointment link: when the owner books it
// (asked to confirm, or booked), when a customer books online, and when the
// owner cancels. Also on the owner's Resend. Sent like invoice emails
// (invoiceEmailService.ts): "Business via 521", Reply-To the business.
//
// Automatic emails go once per appointment and kind (appointmentEmails/
// {kind}_{id}), only while Booking setup's "Email clients automatically" is
// on. They never block or undo the booking: a failure is reported back so
// the owner can share the link instead.
// ---------------------------------------------------------------------------

export const APPOINTMENT_EMAIL_FROM = "bookings@the521app.com"
const MAX_SENDS_PER_APPOINTMENT_PER_DAY = 5
const MAX_SENDS_PER_WORKSPACE_PER_DAY = 100
const DAY_MS = 86_400_000

export type AppointmentEmailResult = "sent" | "failed" | "off" | "none"

function sentDoc(workspaceId: string, kind: AppointmentEmailKind, appointmentId: string) {
  return db.doc(`workspaces/${workspaceId}/appointmentEmails/${kind}_${appointmentId}`)
}

function counterDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("counters").doc("appointmentEmails")
}

/** The email for this appointment as it stands now. */
export function appointmentEmailKind(appointment: AppointmentType): AppointmentEmailKind {
  return appointment.status === "canceled" ? "canceled" : appointment.status === "requested" ? "request" : "booked"
}

/**
 * An automatic email: skipped when the client has no email, the owner turned
 * them off, or this one already went. Never throws.
 */
export async function emailAppointmentAutomatically(
  workspaceId: string,
  appointment: AppointmentType,
  kind: AppointmentEmailKind,
  options: { depositRefunded?: boolean } = {}
): Promise<{ result: AppointmentEmailResult; appointment: AppointmentType }> {
  if (!appointment.clientEmail || !appointment.shareToken) return { result: "none", appointment }
  try {
    const booking = await readBookingSettings(workspaceId)
    if (!booking.emailClients) return { result: "off", appointment }
    try {
      await sentDoc(workspaceId, kind, appointment.id).create({ at: new Date().toISOString() })
    } catch {
      return { result: "sent", appointment } // Already sent (a retry of the same tap).
    }
    try {
      const updated = await sendAppointmentEmail(workspaceId, appointment, kind, appointment.clientEmail, options)
      return { result: "sent", appointment: updated }
    } catch (error) {
      // Lets a later retry try again.
      await sentDoc(workspaceId, kind, appointment.id).delete().catch(() => null)
      throw error
    }
  } catch (error) {
    console.error("appointmentEmail: automatic email failed", { workspaceId, id: appointment.id, kind }, error)
    return { result: "failed", appointment }
  }
}

/**
 * A reminder before the appointment (appointmentRemindersService.ts), once
 * per appointment time. True when it went. A failed send isn't retried:
 * the job runs every 15 minutes, and a bad address would use up the
 * workspace's daily emails.
 */
export async function emailAppointmentReminder(
  workspaceId: string,
  appointment: AppointmentType,
  reminder: AppointmentReminderHours,
  nowIso: string
): Promise<boolean> {
  if (!appointment.clientEmail || !appointment.shareToken) return false
  try {
    await db.doc(`workspaces/${workspaceId}/appointmentEmails/${appointmentReminderKey(appointment, reminder)}`).create({ at: nowIso })
  } catch {
    return false // Already sent.
  }
  await sendAppointmentEmail(workspaceId, appointment, "reminder", appointment.clientEmail, { nowIso })
  return true
}

/**
 * "Your appointment moved", once per new time, when Booking setup's "Email
 * clients automatically" is on and the client has an email. Never throws.
 */
export async function emailAppointmentMoved(
  workspaceId: string,
  appointment: AppointmentType,
  by: "owner" | "client"
): Promise<{ result: AppointmentEmailResult; appointment: AppointmentType }> {
  const movedFrom = appointment.reschedules[appointment.reschedules.length - 1]
  if (!appointment.clientEmail || !appointment.shareToken || !movedFrom) return { result: "none", appointment }
  const marker = db.doc(`workspaces/${workspaceId}/appointmentEmails/moved_${appointment.id}_${Date.parse(appointment.startAt)}`)
  try {
    const booking = await readBookingSettings(workspaceId)
    if (!booking.emailClients) return { result: "off", appointment }
    try {
      await marker.create({ at: new Date().toISOString() })
    } catch {
      return { result: "sent", appointment } // Already sent.
    }
    try {
      const updated = await sendAppointmentEmail(workspaceId, appointment, "moved", appointment.clientEmail, { movedFrom, movedBy: by })
      return { result: "sent", appointment: updated }
    } catch (error) {
      await marker.delete().catch(() => null)
      throw error
    }
  } catch (error) {
    console.error("appointmentEmail: moved email failed", { workspaceId, id: appointment.id }, error)
    return { result: "failed", appointment }
  }
}

/** The owner's Resend: the email for where the appointment stands now, to `to` (saved as their address). */
export async function resendAppointmentEmail(workspaceId: string, appointment: AppointmentType, to: string): Promise<AppointmentType> {
  const now = Date.now()
  const recent = appointment.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS)
  if (recent.length >= MAX_SENDS_PER_APPOINTMENT_PER_DAY) {
    throw new TooManyRequestsError("This appointment has been emailed several times today. Share the link instead.")
  }
  return sendAppointmentEmail(workspaceId, appointment, appointmentEmailKind(appointment), to, {})
}

async function sendAppointmentEmail(
  workspaceId: string,
  appointment: AppointmentType,
  kind: AppointmentEmailKind,
  to: string,
  options: {
    depositRefunded?: boolean
    nowIso?: string
    movedFrom?: { fromDate: string; fromStartTime: string }
    movedBy?: "owner" | "client"
  }
): Promise<AppointmentType> {
  // Workspace daily cap, reserved before sending.
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  await db.runTransaction(async (txn) => {
    const counter = await txn.get(counterDoc(workspaceId))
    const count = counter.data()?.date === today ? Number(counter.data()?.count ?? 0) : 0
    if (count >= MAX_SENDS_PER_WORKSPACE_PER_DAY) {
      throw new TooManyRequestsError("You've sent a lot of appointment emails today. Share the link instead.")
    }
    txn.set(counterDoc(workspaceId), { date: today, count: count + 1 }, { merge: true })
  })

  const { onlinePaymentsOn, readAppointmentInvoice } = await import("./appointmentDepositsService.js")
  const [settings, onlinePayments, invoice] = await Promise.all([
    readInvoiceSettings(workspaceId),
    onlinePaymentsOn(workspaceId).catch(() => false),
    readAppointmentInvoice(workspaceId, appointment).catch(() => null),
  ])
  const email = buildAppointmentEmail({
    kind,
    appointment,
    settings,
    link: publicAppointmentUrl(appointment.shareToken!),
    depositDueOnline: appointmentDepositOnline(appointment, onlinePayments) && appointmentMoney(appointment, invoice).kind === "due",
    depositRefunded: options.depositRefunded,
    nowIso: options.nowIso,
    movedFrom: options.movedFrom,
    movedBy: options.movedBy,
  })

  sgMail.setApiKey(SENDGRID_API_KEY.value())
  await sgMail.send({
    to,
    from: { email: APPOINTMENT_EMAIL_FROM, name: `${(settings.businessName || "521").slice(0, 60)} via 521` },
    ...(settings.businessEmail ? { replyTo: settings.businessEmail } : {}),
    subject: email.subject,
    text: email.text,
    html: email.html,
    categories: ["appointment"],
    // Click tracking would rewrite the private link through SendGrid's domain.
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  })

  // Recorded without touching updatedAt: sending changes nothing about the booking.
  const sentAt = new Date().toISOString()
  const ref = appointmentsCol(workspaceId).doc(appointment.id)
  return db.runTransaction(async (txn) => {
    const fresh = parseAppointment((await txn.get(ref)).data()) ?? appointment
    const next = AppointmentSchema.parse({
      ...fresh,
      clientEmail: to,
      lastEmailedAt: sentAt,
      lastEmailedTo: to,
      recentEmailSends: [...fresh.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS), sentAt].slice(-10),
    })
    txn.set(ref, next)
    return next
  })
}
