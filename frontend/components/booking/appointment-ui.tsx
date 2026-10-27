"use client"

import { cn } from "@/lib/utils"
import {
  APPOINTMENT_STATUS_LABELS,
  appointmentEndTime,
  formatAppointmentDate,
  formatBookingTime,
} from "@shared/appointments"
import type { AppointmentStatus, AppointmentType } from "@shared/schemas/appointment"

const TONE_CLASSES: Record<AppointmentStatus, string> = {
  requested: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  confirmed: "bg-accent text-emerald-800 dark:text-emerald-300",
  completed: "bg-secondary text-foreground",
  declined: "bg-secondary text-muted-foreground",
  canceled: "bg-secondary text-muted-foreground line-through",
  expired: "bg-secondary text-muted-foreground",
}

const SHORT_LABELS: Record<AppointmentStatus, string> = {
  requested: "Waiting",
  confirmed: "Confirmed",
  completed: "Done",
  declined: "Declined",
  canceled: "Canceled",
  expired: "Expired",
}

export function AppointmentStatusPill({ status, short }: { status: AppointmentStatus; short?: boolean }) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASSES[status])}>
      {short ? SHORT_LABELS[status] : APPOINTMENT_STATUS_LABELS[status]}
    </span>
  )
}

/** "9am – 9:45am". */
export function appointmentTimeRange(appointment: Pick<AppointmentType, "startTime" | "minutes">): string {
  return `${formatBookingTime(appointment.startTime)} – ${formatBookingTime(appointmentEndTime(appointment.startTime, appointment.minutes))}`
}

/** "Thu, Dec 3 · 9am – 9:45am". */
export function appointmentWhen(appointment: Pick<AppointmentType, "date" | "startTime" | "minutes">): string {
  return `${formatAppointmentDate(appointment.date, String(new Date().getFullYear()))} · ${appointmentTimeRange(appointment)}`
}

export function appointmentDepositAmount(appointment: Pick<AppointmentType, "price" | "deposit">): number {
  if (appointment.deposit.type === "fixed") return appointment.deposit.value
  if (appointment.deposit.type === "percent") return Math.round(appointment.price * appointment.deposit.value) / 100
  return 0
}
