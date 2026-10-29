import { db } from "../admin"
import { parseAppointment } from "./appointmentsService"
import { readBookingSettings } from "./bookingService"
import { emailAppointmentReminder } from "./appointmentEmailService"
import {
  APPOINTMENT_REMINDER_HORIZON_MS,
  appointmentReminderKey,
  appointmentReminderNudgeText,
  dueAppointmentReminder,
} from "@shared/appointmentReminders"
import type { AppointmentType } from "@shared/schemas/appointment"
import type { BookingSettings } from "@shared/schemas/booking"

// ---------------------------------------------------------------------------
// Reminders before appointments (shared/appointmentReminders.ts), run every
// 15 minutes by sendAppointmentReminders. Confirmed appointments starting in
// the next week get their due reminder emailed; when the client has no
// email, the owner gets one push instead (at the first reminder that comes
// due), to text them.
// ---------------------------------------------------------------------------

type Workspace = { ownerId: string | null; booking: BookingSettings } | null

export async function sendDueAppointmentReminders(nowIso: string): Promise<{ emailed: number; nudged: number }> {
  const horizon = new Date(Date.parse(nowIso) + APPOINTMENT_REMINDER_HORIZON_MS).toISOString()
  const snap = await db
    .collectionGroup("appointments")
    .where("status", "==", "confirmed")
    .where("startAt", ">", nowIso)
    .where("startAt", "<=", horizon)
    .get()

  const workspaces = new Map<string, Promise<Workspace>>()
  const workspaceFor = (workspaceId: string) => {
    if (!workspaces.has(workspaceId)) workspaces.set(workspaceId, readWorkspace(workspaceId))
    return workspaces.get(workspaceId)!
  }

  let emailed = 0
  let nudged = 0
  for (const doc of snap.docs) {
    // Only workspaces/{id}/appointments.
    const workspaceRef = doc.ref.parent.parent
    if (!workspaceRef || workspaceRef.parent.id !== "workspaces") continue
    const appointment = parseAppointment(doc.data())
    if (!appointment) continue
    try {
      const workspace = await workspaceFor(workspaceRef.id)
      if (!workspace) continue
      const reminder = dueAppointmentReminder(appointment, workspace.booking.reminders, nowIso)
      if (!reminder) continue
      if (appointment.clientEmail) {
        if (await emailAppointmentReminder(workspaceRef.id, appointment, reminder, nowIso)) emailed += 1
      } else if (workspace.ownerId) {
        if (await nudgeOwner(workspaceRef.id, workspace.ownerId, appointment, nowIso)) nudged += 1
      }
    } catch (error) {
      console.error("appointmentReminders: failed", { workspaceId: workspaceRef.id, id: appointment.id }, error)
    }
  }
  return { emailed, nudged }
}

// Active independent workspaces only (booking is independent-only).
async function readWorkspace(workspaceId: string): Promise<Workspace> {
  const data = (await db.doc(`workspaces/${workspaceId}`).get()).data()
  if (!data || data.type !== "independent" || data.status !== "active") return null
  return {
    ownerId: typeof data.ownerId === "string" ? data.ownerId : null,
    booking: await readBookingSettings(workspaceId),
  }
}

// Once per appointment time; opens the appointment with the share sheet.
async function nudgeOwner(workspaceId: string, ownerUid: string, appointment: AppointmentType, nowIso: string): Promise<boolean> {
  try {
    await db.doc(`workspaces/${workspaceId}/notificationState/${appointmentReminderKey(appointment, "nudge")}`).create({ sentAt: nowIso })
  } catch {
    return false // Already told.
  }
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  await sendTransactionNotification(ownerUid, {
    ...appointmentReminderNudgeText(appointment, nowIso),
    data: { deepLink: `stackin://appointments/${appointment.id}?then=remind`, workspaceId },
  })
  return true
}
