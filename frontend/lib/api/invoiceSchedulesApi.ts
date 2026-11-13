import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import {
  InvoiceScheduleSchema,
  type InvoiceScheduleCreateInput,
  type InvoiceSchedulePatch,
  type InvoiceScheduleType,
} from "@shared/schemas/invoiceSchedule"

// Repeating invoices wait for the server, like quotes (quotesApi.ts).
const SCHEDULE_TIMEOUT_MS = 30_000

function readSchedule(raw: unknown): InvoiceScheduleType | null {
  const parsed = InvoiceScheduleSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.warn("invoiceSchedulesApi: skipping a schedule that doesn't parse", parsed.error.issues)
  return null
}

function requireSchedule(raw: unknown): InvoiceScheduleType {
  const schedule = readSchedule(raw)
  if (!schedule) throw new Error("The server sent back a repeating invoice this version of the app can't read. Refresh and try again.")
  return schedule
}

function query(workspaceId: string, scheduleId?: string): string {
  const base = `workspaceId=${encodeURIComponent(workspaceId)}`
  return scheduleId ? `${base}&scheduleId=${encodeURIComponent(scheduleId)}` : base
}

export async function getInvoiceSchedules(workspaceId: string): Promise<InvoiceScheduleType[]> {
  const res = await apiFetch<{ schedules: InvoiceScheduleType[] }>(`${API_ENDPOINTS.invoiceSchedules.get}?${query(workspaceId)}`, {
    timeout: SCHEDULE_TIMEOUT_MS,
    method: "GET",
  })
  return (res.schedules ?? []).flatMap((raw) => readSchedule(raw) ?? [])
}

/** Starts repeating an invoice (it counts as the first). */
export async function createInvoiceSchedule(workspaceId: string, input: InvoiceScheduleCreateInput): Promise<InvoiceScheduleType> {
  const res = await apiFetch<{ schedule: InvoiceScheduleType }>(`${API_ENDPOINTS.invoiceSchedules.save}?${query(workspaceId)}`, {
    timeout: SCHEDULE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(input),
  })
  return requireSchedule(res.schedule)
}

/** edit / pause / resume / stop. */
export async function updateInvoiceSchedule(workspaceId: string, scheduleId: string, patch: InvoiceSchedulePatch): Promise<InvoiceScheduleType> {
  const res = await apiFetch<{ schedule: InvoiceScheduleType }>(`${API_ENDPOINTS.invoiceSchedules.save}?${query(workspaceId, scheduleId)}`, {
    timeout: SCHEDULE_TIMEOUT_MS,
    method: "PATCH",
    body: JSON.stringify(patch),
  })
  return requireSchedule(res.schedule)
}
