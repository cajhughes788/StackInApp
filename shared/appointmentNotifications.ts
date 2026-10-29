import { appointmentDepositAmount } from "./appointmentDeposits"
import { formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatMovedFrom } from "./appointmentReschedule"
import { formatInvoiceMoney } from "./invoiceDisplay"
import type { AppointmentType } from "./schemas/appointment"

// What the owner's push says when a client acts on an appointment
// (backend/functions/src/services/appointmentNotifications.ts sends it).
export type AppointmentEvent = "booked" | "confirmed" | "declined" | "canceled" | "rescheduled"

export function appointmentNotificationText(
  appointment: AppointmentType,
  event: AppointmentEvent,
  options: { depositRefunded?: boolean } = {}
): { title: string; body: string } {
  const moved = appointment.reschedules[appointment.reschedules.length - 1]
  const when = `${appointment.serviceName} · ${formatAppointmentDate(appointment.date)} at ${formatBookingTime(appointment.startTime)}`
  const deposit = appointmentDepositAmount(appointment)
  const paid = appointment.invoiceId && deposit > 0 ? formatInvoiceMoney(deposit) : null
  const name = appointment.clientName
  switch (event) {
    case "booked":
      return { title: `New booking: ${name}`, body: `${when}${paid ? ` · ${paid} deposit paid` : ""}` }
    case "confirmed":
      return { title: `${name} confirmed`, body: `${when}${paid ? ` · ${paid} deposit paid` : ""}` }
    case "declined":
      return { title: `${name} can't make it`, body: `${when} · the time is open again` }
    case "rescheduled":
      return {
        title: `${name} moved their appointment`,
        body: `${when}${moved ? ` (was ${formatMovedFrom(moved)})` : ""}`,
      }
    case "canceled":
      return {
        title: `${name} canceled`,
        body: `${when}${paid ? ` · ${paid} deposit ${options.depositRefunded ? "refunded" : "kept"}` : ""}`,
      }
  }
}
