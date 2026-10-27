import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { BookingSettingsSchema, type BookingSettings, type BookingSettingsInput } from "@shared/schemas/booking"

// Booking setup (services and hours) — see shared/schemas/booking.ts.
// apiFetch, not tryWrite: a save replaces the whole thing, so a queued
// replay could undo a later change. Rarely used, so allow for a cold start.
const BOOKING_TIMEOUT_MS = 30_000

function readSettings(raw: unknown): BookingSettings {
  const parsed = BookingSettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : BookingSettingsSchema.parse({})
}

function query(workspaceId: string): string {
  return `workspaceId=${encodeURIComponent(workspaceId)}`
}

export async function getBookingSettings(workspaceId: string): Promise<BookingSettings> {
  const res = await apiFetch<{ settings: BookingSettings }>(`${API_ENDPOINTS.booking.getSettings}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "GET",
  })
  return readSettings(res.settings)
}

/** Replaces the saved services and hours with these. */
export async function saveBookingSettings(workspaceId: string, input: BookingSettingsInput): Promise<BookingSettings> {
  const res = await apiFetch<{ settings: BookingSettings }>(`${API_ENDPOINTS.booking.saveSettings}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(input),
  })
  return readSettings(res.settings)
}
