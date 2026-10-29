import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import {
  AppointmentSchema,
  type AppointmentAction,
  type AppointmentCreateInput,
  type AppointmentType,
} from "@shared/schemas/appointment"
import { InvoiceSchema, type InvoiceType } from "@shared/schemas/invoice"

// Appointments — see shared/schemas/appointment.ts. apiFetch, not tryWrite:
// whether a time is free is decided by the server, so a queued replay could
// book a slot someone else took since. Rarely used, so allow a cold start.
const APPOINTMENT_TIMEOUT_MS = 30_000

function readAppointment(raw: unknown): AppointmentType | null {
  const parsed = AppointmentSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.warn("appointmentsApi: skipping an appointment that doesn't parse", parsed.error.issues)
  return null
}

function requireAppointment(raw: unknown): AppointmentType {
  const appointment = readAppointment(raw)
  if (!appointment) throw new Error("The server sent back an appointment this version of the app can't read. Refresh and try again.")
  return appointment
}

function query(workspaceId: string, appointmentId?: string): string {
  const base = `workspaceId=${encodeURIComponent(workspaceId)}`
  return appointmentId ? `${base}&appointmentId=${encodeURIComponent(appointmentId)}` : base
}

/** From 30 days ago on, soonest first. */
export async function getAppointments(workspaceId: string): Promise<AppointmentType[]> {
  const res = await apiFetch<{ appointments: unknown[] }>(`${API_ENDPOINTS.appointments.get}?${query(workspaceId)}`, {
    timeout: APPOINTMENT_TIMEOUT_MS,
    method: "GET",
  })
  return (res.appointments ?? []).flatMap((raw) => readAppointment(raw) ?? [])
}

/** Books it (or asks the client); shareUrl is the client's link when they're asked to confirm. */
export async function createAppointment(
  workspaceId: string,
  input: AppointmentCreateInput
): Promise<{ appointment: AppointmentType; shareUrl: string | null; email: AppointmentEmailResult }> {
  const res = await apiFetch<{ appointment: unknown; shareUrl: string | null; email?: AppointmentEmailResult }>(
    `${API_ENDPOINTS.appointments.create}?${query(workspaceId)}`,
    { timeout: APPOINTMENT_TIMEOUT_MS, method: "POST", body: JSON.stringify(input) }
  )
  return { appointment: requireAppointment(res.appointment), shareUrl: res.shareUrl ?? null, email: res.email ?? "none" }
}

// Whether booking emailed the client their link (appointmentEmailService.ts).
export type AppointmentEmailResult = "sent" | "failed" | "off" | "none"

/** Also returns the appointment's invoice (its deposit) once it has one. */
export async function updateAppointment(
  workspaceId: string,
  appointmentId: string,
  action: AppointmentAction
): Promise<{ appointment: AppointmentType; shareUrl: string | null; invoice: InvoiceType | null; emailedTo: string | null }> {
  const res = await apiFetch<{ appointment: unknown; shareUrl: string | null; invoice?: unknown; emailedTo?: string | null }>(
    `${API_ENDPOINTS.appointments.update}?${query(workspaceId, appointmentId)}`,
    { timeout: APPOINTMENT_TIMEOUT_MS, method: "POST", body: JSON.stringify(action) }
  )
  const invoice = res.invoice ? InvoiceSchema.safeParse(res.invoice) : null
  return {
    appointment: requireAppointment(res.appointment),
    shareUrl: res.shareUrl ?? null,
    invoice: invoice?.success ? invoice.data : null,
    // "finish" with "later": where the invoice was emailed.
    emailedTo: res.emailedTo ?? null,
  }
}
