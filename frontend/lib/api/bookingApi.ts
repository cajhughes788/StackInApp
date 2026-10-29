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

/** The owner's calendar sync link (made the first time); reset makes a new one. */
export async function getCalendarFeedLink(workspaceId: string, options: { reset?: boolean } = {}): Promise<{ token: string; url: string }> {
  const res = await apiFetch<{ token: string; url: string }>(`${API_ENDPOINTS.booking.calendarFeedLink}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify({ reset: options.reset ?? false }),
  })
  return { token: res.token, url: res.url }
}

// The owner's busy calendars (busyCalendarsService.ts): never the links
// themselves, only each one's name, website and how its last read went,
// plus the busy times that block booking now.
export type BusyCalendarSummary = {
  id: string
  name: string
  host: string
  checkedAt: string | null
  okAt: string | null
  error: string | null
  busyCount: number
}
export type BusyCalendars = {
  calendars: BusyCalendarSummary[]
  busy: Array<{ start: string; end: string; calendar: string }>
}

function readBusyCalendars(res: Partial<BusyCalendars>): BusyCalendars {
  return { calendars: Array.isArray(res.calendars) ? res.calendars : [], busy: Array.isArray(res.busy) ? res.busy : [] }
}

export async function getBusyCalendars(workspaceId: string): Promise<BusyCalendars> {
  const res = await apiFetch<Partial<BusyCalendars>>(`${API_ENDPOINTS.booking.busyCalendars}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "GET",
  })
  return readBusyCalendars(res)
}

/** Adds a calendar; the server reads its link first, so a wrong one fails here. */
export async function addBusyCalendar(workspaceId: string, input: { name: string; url: string }): Promise<BusyCalendars> {
  const res = await apiFetch<Partial<BusyCalendars>>(`${API_ENDPOINTS.booking.busyCalendars}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify({ action: "add", ...input }),
  })
  return readBusyCalendars(res)
}

export async function removeBusyCalendar(workspaceId: string, id: string): Promise<BusyCalendars> {
  const res = await apiFetch<Partial<BusyCalendars>>(`${API_ENDPOINTS.booking.busyCalendars}?${query(workspaceId)}`, {
    timeout: BOOKING_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify({ action: "remove", id }),
  })
  return readBusyCalendars(res)
}
