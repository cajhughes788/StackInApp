import { db } from "../admin"
import { appointmentNotificationText, type AppointmentEvent } from "@shared/appointmentNotifications"
import type { AppointmentType } from "@shared/schemas/appointment"

// Pushes to the owner when a client acts on an appointment: books online,
// confirms, says they can't make it, or cancels. Once per appointment and
// event, since Stripe and form posts can retry.

export async function notifyOwnerAboutAppointment(
  workspaceId: string,
  appointment: AppointmentType,
  event: AppointmentEvent,
  options: { depositRefunded?: boolean } = {}
): Promise<void> {
  try {
    await db.doc(`workspaces/${workspaceId}/notificationState/${event}_${appointment.id}`).create({ sentAt: new Date().toISOString() })
  } catch {
    return // Already told.
  }
  try {
    const ownerUid = (await db.doc(`workspaces/${workspaceId}`).get()).data()?.ownerId as string | undefined
    if (!ownerUid) return
    const { sendTransactionNotification } = await import("./pushNotificationService.js")
    await sendTransactionNotification(ownerUid, {
      ...appointmentNotificationText(appointment, event, options),
      data: { deepLink: `stackin://appointments/${appointment.id}`, workspaceId },
    })
  } catch (error) {
    console.error("appointmentNotifications: push failed", { workspaceId, id: appointment.id, event }, error)
  }
}
