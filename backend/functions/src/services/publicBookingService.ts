import { randomBytes } from "node:crypto"
import { db } from "../admin"
import { appointmentsCol, overlapQuery, parseAppointment } from "./appointmentsService"
import { bookingLinkDoc, readBookingSettings } from "./bookingService"
import { resolveClientByContact } from "./clientsService"
import { notifyOwnerAboutAppointment } from "./appointmentNotifications"
import { readInvoiceSettings } from "./invoicesService"
import { MIN_CHECKOUT_MINUTES, appointmentDepositOnline } from "@shared/appointmentDeposits"
import { APPOINTMENT_LOOKBACK_MS, appointmentTimes } from "@shared/appointments"
import { BOOKING_VIA_WEBSITE, bookingDateRange, bookingOpenDays, bookingOpenTimes } from "@shared/onlineBooking"
import { busyAsAppointments } from "@shared/busyTimes"
import { AppointmentSchema, OnlineBookingInputSchema, type AppointmentType } from "@shared/schemas/appointment"
import type { BookingService, BookingSettings } from "@shared/schemas/booking"
import type { InvoiceSettings } from "@shared/schemas/invoice"

// ---------------------------------------------------------------------------
// The public booking page — step 4 of booking (shared/onlineBooking.ts).
//
// A customer books from the business's link: the time is checked again
// inside the same transaction as the write (the same no-double-booking rule
// as the owner's bookings). Without a deposit paid online it's confirmed at
// once. With one, it's held while they pay (Stripe Checkout, Step 3's flow)
// and confirmed when the payment arrives; an abandoned payment lets the hold
// run out and the time frees up.
// ---------------------------------------------------------------------------

const SLUG_SHAPE = /^[a-z0-9-]{3,40}$/
// Open days shown per page ("Later dates" shows the next ones).
export const BOOKING_DAYS_PER_PAGE = 14

export type BookingPage = {
  workspaceId: string
  slug: string
  booking: BookingSettings
  settings: InvoiceSettings
  onlinePayments: boolean
}

/** The business behind a booking link, if it's taking online bookings. */
export async function findBookingPage(slug: string): Promise<BookingPage | null> {
  if (!SLUG_SHAPE.test(slug)) return null
  const link = await bookingLinkDoc(slug).get()
  const workspaceId = link.data()?.workspaceId
  if (typeof workspaceId !== "string") return null
  const workspace = await db.doc(`workspaces/${workspaceId}`).get()
  if (workspace.data()?.type !== "independent") return null
  const booking = await readBookingSettings(workspaceId)
  if (!booking.onlineBookingEnabled || booking.bookingSlug !== slug) return null
  const { onlinePaymentsOn } = await import("./appointmentDepositsService.js")
  const [settings, onlinePayments] = await Promise.all([
    readInvoiceSettings(workspaceId),
    onlinePaymentsOn(workspaceId).catch(() => false),
  ])
  return { workspaceId, slug, booking, settings, onlinePayments }
}

export function bookableService(page: BookingPage, serviceId: string): BookingService | null {
  return page.booking.services.find((service) => service.id === serviceId && service.active) ?? null
}

type Blocking = Pick<AppointmentType, "id" | "startAt" | "blockedUntil" | "status" | "holdExpiresAt">

// The owner's busy times from their own calendars (busyCalendarsService.ts),
// shaped like appointments. On the page itself a stale calendar is read
// again first; a failure never stops booking.
async function busyAhead(page: BookingPage, refreshStale: boolean): Promise<Blocking[]> {
  try {
    const { busyBlocksFor } = await import("./busyCalendarsService.js")
    return busyAsAppointments(await busyBlocksFor(page.workspaceId, page.booking, { refreshStale, timeoutMs: 4000 }))
  } catch (error) {
    console.error("publicBooking: busy calendars failed", { workspaceId: page.workspaceId }, error)
    return []
  }
}

// Everything that could block a time from now to the last bookable day:
// appointments, and when the owner is busy in their own calendars.
async function appointmentsAhead(page: BookingPage, nowIso: string): Promise<Blocking[]> {
  const { last } = bookingDateRange(page.booking, nowIso)
  const from = new Date(Date.parse(nowIso) - APPOINTMENT_LOOKBACK_MS).toISOString()
  const to = new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000).toISOString()
  const [snap, busy] = await Promise.all([
    appointmentsCol(page.workspaceId).where("startAt", ">", from).where("startAt", "<", to).limit(3000).get(),
    busyAhead(page, true),
  ])
  return [...snap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? []), ...busy]
}

export async function openDays(page: BookingPage, service: BookingService, from?: string): Promise<{ days: string[]; moreFrom: string | null }> {
  const nowIso = new Date().toISOString()
  const appointments = await appointmentsAhead(page, nowIso)
  // One extra tells whether there are later dates.
  const days = bookingOpenDays({ settings: page.booking, service, appointments, nowIso, from, limit: BOOKING_DAYS_PER_PAGE + 1 })
  const more = days.length > BOOKING_DAYS_PER_PAGE ? days[BOOKING_DAYS_PER_PAGE] : null
  return { days: days.slice(0, BOOKING_DAYS_PER_PAGE), moreFrom: more }
}

export async function openTimes(page: BookingPage, service: BookingService, date: string): Promise<string[]> {
  const nowIso = new Date().toISOString()
  const appointments = await appointmentsAhead(page, nowIso)
  return bookingOpenTimes({ settings: page.booking, service, date, appointments, nowIso })
}

export function newFormKey(): string {
  return randomBytes(16).toString("base64url")
}

export type OnlineBookingResult =
  | { kind: "booked"; shareToken: string }
  | { kind: "pay"; url: string }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "not_found" }

export async function bookOnline(slug: string, raw: unknown): Promise<OnlineBookingResult> {
  const page = await findBookingPage(slug)
  if (!page) return { kind: "not_found" }
  const parsed = OnlineBookingInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Check your details and try again." }
  const input = parsed.data
  // Only bots fill the hidden field.
  if (input.website) return { kind: "invalid", message: "Couldn't book that. Try again." }
  const service = bookableService(page, input.service)
  if (!service) return { kind: "invalid", message: "That service isn't available anymore." }
  const times = appointmentTimes({ date: input.date, startTime: input.time, timeZone: page.booking.timeZone, ...service })
  if (!times) return { kind: "taken" }

  const ref = appointmentsCol(page.workspaceId).doc(`web_${input.key}`)
  // Busy times are read once, outside the transaction (not Firestore data
  // that could change under it).
  const busy = await busyAhead(page, false)
  const existing = await ref.get()
  if (!existing.exists) {
    // A quick check before saving a client for a time that's already gone.
    const quick = bookingOpenTimes({ settings: page.booking, service, date: input.date, appointments: await appointmentsAhead(page, new Date().toISOString()), nowIso: new Date().toISOString() })
    if (!quick.includes(input.time)) return { kind: "taken" }
  }
  const client = existing.exists
    ? null
    : await resolveClientByContact(page.workspaceId, { clientName: input.name, clientEmail: input.email, clientPhone: input.phone })
  const payOnline = appointmentDepositOnline(service, page.onlinePayments)

  const outcome = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    // A retry of the same form.
    if (snap.exists) {
      const appointment = parseAppointment(snap.data())
      return appointment ? { appointment, created: false } : null
    }
    const nearbySnap = await txn.get(overlapQuery(page.workspaceId, times.startAt, times.blockedUntil))
    const nearby = [...nearbySnap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? []), ...busy]
    const nowIso = new Date().toISOString()
    if (!bookingOpenTimes({ settings: page.booking, service, date: input.date, appointments: nearby, nowIso }).includes(input.time)) return null
    const shareToken = randomBytes(16).toString("base64url")
    const appointment = AppointmentSchema.parse({
      id: ref.id,
      workspaceId: page.workspaceId,
      clientId: client!.id,
      clientName: input.name,
      clientEmail: input.email,
      clientPhone: input.phone || null,
      serviceId: service.id,
      serviceName: service.name,
      price: service.price,
      minutes: service.minutes,
      bufferMinutes: service.bufferMinutes,
      deposit: service.deposit.type === "none" ? { type: "none", value: 0 } : service.deposit,
      date: input.date,
      startTime: input.time,
      timeZone: page.booking.timeZone,
      ...times,
      // Paying the deposit confirms it (Step 3); the time is theirs meanwhile.
      status: payOnline ? "requested" : "confirmed",
      holdExpiresAt: payOnline ? new Date(Date.parse(nowIso) + (MIN_CHECKOUT_MINUTES + 1) * 60_000).toISOString() : null,
      shareToken,
      outsideHours: false,
      location: page.booking.location,
      refundCutoffHours: page.booking.refundCutoffHours,
      source: "online",
      bookedFrom: input.via === BOOKING_VIA_WEBSITE ? "website" : null,
      respondedAt: payOnline ? null : nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.create(ref, appointment)
    txn.create(db.collection("appointmentShares").doc(shareToken), { workspaceId: page.workspaceId, appointmentId: ref.id, createdAt: nowIso })
    return { appointment, created: true }
  })
  if (!outcome) return { kind: "taken" }
  const { appointment } = outcome
  const token = appointment.shareToken!

  if (appointment.status === "requested") {
    const { startAppointmentCheckout } = await import("./appointmentDepositsService.js")
    const checkout = await startAppointmentCheckout(token)
    if (checkout.kind === "redirect") return { kind: "pay", url: checkout.url }
    return { kind: "booked", shareToken: token }
  }
  if (outcome.created) {
    await notifyOwnerOfOnlineBooking(page.workspaceId, appointment)
    const { emailAppointmentAutomatically } = await import("./appointmentEmailService.js")
    await emailAppointmentAutomatically(page.workspaceId, appointment, "booked")
  }
  return { kind: "booked", shareToken: token }
}

/** Tells the owner a customer booked online. Once per appointment (Stripe and form retries). */
export async function notifyOwnerOfOnlineBooking(workspaceId: string, appointment: AppointmentType): Promise<void> {
  await notifyOwnerAboutAppointment(workspaceId, appointment, "booked")
}
