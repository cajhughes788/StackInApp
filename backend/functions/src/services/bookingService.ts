import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, ForbiddenError } from "../lib/httpErrors"
import { bookingSlugProblem } from "@shared/onlineBooking"
import {
  BookingSettingsInputSchema,
  BOOKING_MAX_LOCATION,
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

// bookingLinks/{slug} → { workspaceId }: who owns each public booking link,
// so two businesses can't share one. No Firestore rule allows reading it —
// only the server does.
export function bookingLinkDoc(slug: string) {
  return db.collection("bookingLinks").doc(slug)
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
  // Never saved with an address: start from the invoice business address.
  if (snap.data()?.location === undefined) settings.location = await invoiceBusinessAddress(workspaceId)
  return settings
}

async function invoiceBusinessAddress(workspaceId: string): Promise<string> {
  const { readInvoiceSettings } = await import("./invoicesService.js")
  const invoiceSettings = await readInvoiceSettings(workspaceId)
  return invoiceSettings.businessAddress.trim().slice(0, BOOKING_MAX_LOCATION)
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
  // An app version without the address field leaves the saved one alone.
  const saved = await readBookingSettings(workspaceId)
  const location = parsed.data.location ?? saved.location
  // Same for the cancellation cutoff and the booking link.
  const refundCutoffHours = parsed.data.refundCutoffHours === undefined ? saved.refundCutoffHours : parsed.data.refundCutoffHours
  const bookingSlug = parsed.data.bookingSlug ?? saved.bookingSlug
  const onlineBookingEnabled = parsed.data.onlineBookingEnabled ?? saved.onlineBookingEnabled
  const emailClients = parsed.data.emailClients ?? saved.emailClients
  const reminders = parsed.data.reminders ?? saved.reminders
  const busyAllDay = parsed.data.busyAllDay ?? saved.busyAllDay
  const noRefundRescheduleHours =
    parsed.data.noRefundRescheduleHours === undefined ? saved.noRefundRescheduleHours : parsed.data.noRefundRescheduleHours
  if (bookingSlug) {
    const problem = bookingSlugProblem(bookingSlug)
    if (problem) throw new BadRequestError(`Booking link: ${problem}`)
  }
  if (onlineBookingEnabled && !bookingSlug) throw new BadRequestError("Pick a booking link before turning online booking on.")
  if (onlineBookingEnabled && !parsed.data.services.some((service) => service.active)) {
    throw new BadRequestError("Add a service customers can book before turning online booking on.")
  }
  const nowIso = new Date().toISOString()
  const next = BookingSettingsSchema.parse({
    ...parsed.data,
    timeZone,
    location,
    refundCutoffHours,
    bookingSlug,
    onlineBookingEnabled,
    emailClients,
    reminders,
    busyAllDay,
    noRefundRescheduleHours,
    // Kept in date order, no repeats.
    daysOff: [...new Set(parsed.data.daysOff)].sort(),
    updatedAt: nowIso,
  })
  // A new link is claimed (and the old one let go) with the save itself.
  await db.runTransaction(async (txn) => {
    const claim = bookingSlug ? await txn.get(bookingLinkDoc(bookingSlug)) : null
    const previous = saved.bookingSlug && saved.bookingSlug !== bookingSlug ? await txn.get(bookingLinkDoc(saved.bookingSlug)) : null
    if (claim?.exists && claim.data()?.workspaceId !== workspaceId) {
      throw new ConflictError("That booking link is taken. Try another.")
    }
    if (bookingSlug && !claim?.exists) txn.set(bookingLinkDoc(bookingSlug), { workspaceId, createdAt: nowIso })
    if (previous?.exists && previous.data()?.workspaceId === workspaceId) txn.delete(previous.ref)
    txn.set(bookingSettingsDoc(workspaceId), next)
  })
  return next
}
