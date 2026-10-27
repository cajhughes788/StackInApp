import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ForbiddenError } from "../lib/httpErrors"
import {
  BookingSettingsInputSchema,
  BookingSettingsSchema,
  DEFAULT_BOOKING_TIME_ZONE,
  isValidTimeZone,
  type BookingSettings,
} from "@shared/schemas/booking"

// ---------------------------------------------------------------------------
// Booking settings — workspaces/{workspaceId}/settings/booking
// Services and hours. Only independent (self-employed) workspaces book.
// ---------------------------------------------------------------------------

export function bookingSettingsDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("settings").doc("booking")
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

export async function assertIndependentWorkspace(workspaceId: string): Promise<void> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  if (snap.data()?.type !== "independent") throw new ForbiddenError("Booking is only for self-employed workspaces.")
}

// Until booking is saved with its own, it uses the workspace's settings time zone.
async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  const timeZone = snap.data()?.common?.timeZone
  return typeof timeZone === "string" && isValidTimeZone(timeZone) ? timeZone : DEFAULT_BOOKING_TIME_ZONE
}

// Never fails a read over a bad saved value: falls back to defaults.
export async function readBookingSettings(workspaceId: string): Promise<BookingSettings> {
  const snap = await bookingSettingsDoc(workspaceId).get()
  const parsed = BookingSettingsSchema.safeParse(snap.data() ?? {})
  if (!parsed.success) {
    console.error("bookingService.readBookingSettings: invalid settings, using defaults", workspaceId, parsed.error.issues)
  }
  const settings = parsed.success ? parsed.data : BookingSettingsSchema.parse({})
  if (!settings.timeZone) settings.timeZone = await workspaceTimeZone(workspaceId)
  return settings
}

export async function getBookingSettings(workspaceId: string, uid: string): Promise<BookingSettings> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  return readBookingSettings(workspaceId)
}

// The app sends the whole thing; it replaces what's saved.
export async function saveBookingSettings(workspaceId: string, uid: string, raw: unknown): Promise<BookingSettings> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const parsed = BookingSettingsInputSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid booking settings"
    throw new BadRequestError(first, formatIssues(parsed.error))
  }
  const timeZone = parsed.data.timeZone || (await workspaceTimeZone(workspaceId))
  const next = BookingSettingsSchema.parse({
    ...parsed.data,
    timeZone,
    // Kept in date order, no repeats.
    daysOff: [...new Set(parsed.data.daysOff)].sort(),
    updatedAt: new Date().toISOString(),
  })
  await bookingSettingsDoc(workspaceId).set(next)
  return next
}
