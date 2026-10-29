"use client"

// lib/domain/appointmentService.ts
// Appointment changes that don't make the owner wait (backgroundSave.ts):
// booking one, and Mark done, No-show, "They confirmed another way",
// canceling one with no money paid, and Resend email. Each shows at once and
// reaches the server behind it, one at a time per appointment.
//
// Money waits for the server: recording a deposit, and canceling one whose
// deposit is paid (the refund has to go through first).

import { create } from "zustand"

import { createAppointment, updateAppointment } from "@/lib/api/appointmentsApi"
import { saveInBackground } from "@/lib/domain/backgroundSave"
import { appointmentSaveKey, useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import {
  appointmentHoldExpiresAt,
  appointmentTimes,
  bookingHoursWarning,
  findAppointmentConflict,
  formatAppointmentDate,
  formatBookingTime,
  publicAppointmentUrl,
} from "@shared/appointments"
import { clientKey } from "@shared/clients"
import {
  AppointmentSchema,
  type AppointmentAction,
  type AppointmentCreateInput,
  type AppointmentType,
} from "@shared/schemas/appointment"
import type { BookingSettings } from "@shared/schemas/booking"
import type { ClientType } from "@shared/schemas/client"
import type { InvoiceType } from "@shared/schemas/invoice"

// A booking the server refused, kept so "Fix it" brings the form back filled in.
export type AppointmentDraft = { input: AppointmentCreateInput & { clientMutationId: string }; error: string }
const drafts = new Map<string, AppointmentDraft>()

export function appointmentDraft(mutationId: string): AppointmentDraft | null {
  return drafts.get(mutationId) ?? null
}

// Appointments whose booking email didn't go out.
const useEmailFailedStore = create<{ ids: Record<string, true>; mark: (id: string) => void }>((set) => ({
  ids: {},
  mark(id) {
    set((state) => ({ ids: { ...state.ids, [id]: true } }))
  },
}))

export function useBookingEmailFailed(appointmentId: string | null): boolean {
  return useEmailFailedStore((state) => (appointmentId ? !!state.ids[appointmentId] : false))
}

function newShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Shows the new appointment at once and books it in the background. Returns
 * a reason instead when it can tell now that it can't be booked.
 */
export function createAppointmentInBackground(params: {
  workspaceId: string
  input: AppointmentCreateInput & { clientMutationId: string }
  settings: BookingSettings
  savedClients: ClientType[]
  onFix: (mutationId: string) => void
}): { appointment: AppointmentType } | { error: string } {
  const { workspaceId, settings, savedClients } = params
  const times = appointmentTimes({ ...params.input, timeZone: settings.timeZone })
  if (!times) return { error: "That time doesn't exist in your time zone (the clocks change then)." }
  const nowIso = new Date().toISOString()
  if (times.startAt <= nowIso) return { error: "That time has already passed." }

  const input = { ...params.input, shareToken: params.input.shareToken ?? newShareToken() }
  // Same client the server will pick: the one chosen, else a name match.
  const client =
    savedClients.find((item) => item.id === input.clientId) ??
    savedClients.find((item) => item.nameKey === clientKey(input.clientName)) ??
    null
  const appointment = AppointmentSchema.parse({
    id: `cmid_${input.clientMutationId}`,
    workspaceId,
    clientId: client?.id ?? null,
    clientName: client?.name ?? input.clientName,
    clientEmail: input.clientEmail || client?.email || null,
    clientPhone: input.clientPhone || client?.phone || null,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    price: input.price,
    minutes: input.minutes,
    bufferMinutes: input.bufferMinutes,
    deposit: input.deposit.type === "none" ? { type: "none", value: 0 } : input.deposit,
    date: input.date,
    startTime: input.startTime,
    timeZone: settings.timeZone,
    ...times,
    status: input.askToConfirm ? "requested" : "confirmed",
    holdExpiresAt: input.askToConfirm ? appointmentHoldExpiresAt(nowIso) : null,
    shareToken: input.shareToken,
    outsideHours: bookingHoursWarning(settings, input.date, input.startTime, input.minutes) !== null,
    location: input.location ?? settings.location,
    refundCutoffHours: settings.refundCutoffHours,
    createdAt: nowIso,
    updatedAt: nowIso,
  })

  // The double-booking check the server makes, against what's on the phone.
  const store = useAppointmentsStore.getState()
  const conflict = findAppointmentConflict(appointment, store.byWorkspaceId[workspaceId]?.appointments ?? [], nowIso)
  if (conflict) {
    return {
      error: `That time overlaps with ${conflict.clientName}'s ${conflict.serviceName} on ${formatAppointmentDate(conflict.date)} at ${formatBookingTime(conflict.startTime)}.`,
    }
  }

  store.upsert(workspaceId, appointment)
  saveInBackground({
    key: appointmentSaveKey(appointment.id),
    task: async () => {
      const result = await createAppointment(workspaceId, input)
      if (result.email === "failed") useEmailFailedStore.getState().mark(appointment.id)
      return result
    },
    onSaved: (result) => {
      useAppointmentsStore.getState().upsert(workspaceId, result.appointment)
      // A new client, or a custom service kept for next time, may have been saved with it.
      void useClientsStore.getState().load(workspaceId, { force: true }).catch(() => {})
      if (input.saveAsService) void useBookingSettingsStore.getState().load(workspaceId).catch(() => {})
    },
    onFailed: (error) => {
      useAppointmentsStore.getState().remove(workspaceId, appointment.id)
      drafts.set(input.clientMutationId, {
        input,
        error: error instanceof Error && error.message ? error.message : "Couldn't book it. Check your connection and try again.",
      })
      void useAppointmentsStore.getState().load(workspaceId, { force: true }).catch(() => {})
    },
    failTitle: `Couldn't book ${input.clientName}`,
    failAction: { label: "Fix it", run: () => params.onFix(input.clientMutationId) },
  })
  return { appointment }
}

// emailedTo: "reschedule" only — where "Your appointment moved" went.
type ActionResult = { appointment: AppointmentType; shareUrl: string | null; emailedTo?: string | null }

/** What an action does on screen now, or null when it waits for the server. */
function optimistic(appointment: AppointmentType, action: AppointmentAction, invoice: InvoiceType | null): AppointmentType | null {
  const nowIso = new Date().toISOString()
  const base = { ...appointment, updatedAt: nowIso }
  switch (action.action) {
    case "complete":
      return { ...base, status: "completed", completedAt: nowIso }
    case "no_show":
      return { ...base, status: "no_show" }
    case "confirm":
      return { ...base, status: "confirmed", holdExpiresAt: null }
    case "cancel":
      // A paid deposit waits for its refund.
      if ((invoice?.payments ?? []).length > 0) return null
      return { ...base, status: "canceled", holdExpiresAt: null, canceledAt: nowIso, canceledBy: "owner", depositCheckout: null }
    case "email": {
      const to = action.to ?? appointment.clientEmail
      return to ? { ...appointment, clientEmail: to, lastEmailedAt: nowIso, lastEmailedTo: to } : null
    }
    default:
      return null
  }
}

const ACTION_FAILED: Partial<Record<AppointmentAction["action"], string>> = {
  complete: "Couldn't mark it done",
  no_show: "Couldn't mark the no-show",
  confirm: "Couldn't confirm it",
  cancel: "Couldn't cancel it",
  email: "Couldn't email the link",
}

/**
 * Finish & get paid: always waits for the server, which puts the money on
 * the appointment's invoice. shareUrl is the invoice's link (the QR code,
 * or the link to pay later).
 */
export async function finishAppointment(
  workspaceId: string,
  appointmentId: string,
  action: Extract<AppointmentAction, { action: "finish" }>
): Promise<{ appointment: AppointmentType; invoice: InvoiceType | null; shareUrl: string | null; emailedTo: string | null }> {
  const result = await updateAppointment(workspaceId, appointmentId, action)
  useAppointmentsStore.getState().upsert(workspaceId, result.appointment)
  if (result.invoice) useInvoicesStore.getState().upsertInvoice(workspaceId, result.invoice)
  return result
}

/** Runs an action on an appointment: at once when it can, else waiting for the server. */
export async function runAppointmentAction(
  workspaceId: string,
  appointment: AppointmentType,
  action: AppointmentAction,
  invoice: InvoiceType | null
): Promise<ActionResult> {
  const appointments = useAppointmentsStore.getState()
  const invoices = useInvoicesStore.getState()
  const shareUrl = appointment.shareToken ? publicAppointmentUrl(appointment.shareToken) : null
  const next = optimistic(appointment, action, invoice)
  if (!next) {
    const result = await updateAppointment(workspaceId, appointment.id, action)
    appointments.upsert(workspaceId, result.appointment)
    if (result.invoice) invoices.upsertInvoice(workspaceId, result.invoice)
    return result
  }
  appointments.upsert(workspaceId, next)
  saveInBackground({
    key: appointmentSaveKey(appointment.id),
    task: () => updateAppointment(workspaceId, appointment.id, action),
    onSaved: (result) => {
      useAppointmentsStore.getState().upsert(workspaceId, result.appointment)
      if (result.invoice) useInvoicesStore.getState().upsertInvoice(workspaceId, result.invoice)
    },
    onFailed: () => {
      useAppointmentsStore.getState().upsert(workspaceId, appointment)
      void useAppointmentsStore.getState().load(workspaceId, { force: true }).catch(() => {})
    },
    failTitle: `${ACTION_FAILED[action.action] ?? "Couldn't save that"} (${appointment.clientName})`,
  })
  return { appointment: next, shareUrl }
}
