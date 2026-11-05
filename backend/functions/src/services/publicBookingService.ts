import { randomBytes } from "node:crypto"
import { db } from "../admin"
import { BOOKING_FORM_SECRET } from "../secrets"
import { appointmentsCol, overlapQuery, parseAppointment } from "./appointmentsService"
import { bookingLinkDoc, readBookingSettings } from "./bookingService"
import { resolveClientByContact } from "./clientsService"
import { notifyOwnerAboutAppointment } from "./appointmentNotifications"
import { readInvoiceSettings } from "./invoicesService"
import { MIN_CHECKOUT_MINUTES, appointmentDepositOnline } from "@shared/appointmentDeposits"
import { APPOINTMENT_LOOKBACK_MS, appointmentTimes } from "@shared/appointments"
import { BOOKING_VIA_WEBSITE, bookingDateRange, bookingOpenDays, bookingOpenTimes } from "@shared/onlineBooking"
import { busyAsAppointments } from "@shared/busyTimes"
import {
  BOOKING_LIMITS,
  BOOKING_LIMIT_MESSAGES,
  bookingFormStampProblem,
  bookingLimitId,
  currentBookingCount,
  nextBookingCount,
  signBookingFormStamp,
  type BookingLimitCount,
  type BookingLimitKind,
} from "@shared/bookingSpamGuard"
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

export type BookingForm = { formKey: string; formStamp: string }

/** A fresh booking form: a key so a double tap books once, and a signed stamp of when it was shown. */
export function newBookingForm(slug: string): BookingForm {
  const formKey = randomBytes(16).toString("base64url")
  return { formKey, formStamp: signBookingFormStamp(BOOKING_FORM_SECRET.value(), slug, formKey, Date.now()) }
}

export type OnlineBookingResult =
  | { kind: "booked"; shareToken: string }
  | { kind: "pay"; url: string }
  | { kind: "taken" }
  // `form`: show the form again with the one they sent (sent too fast — a second tap goes through).
  | { kind: "invalid"; message: string; form?: BookingForm }
  | { kind: "limited"; message: string }
  | { kind: "not_found" }

// ---------------------------------------------------------------------------
// Limits (shared/bookingSpamGuard.ts). Counts live in bookingLimits docs,
// cleared daily by cleanupBookingLimitsDaily.
// ---------------------------------------------------------------------------

const limitDoc = (kind: BookingLimitKind, workspaceId: string, value: string) =>
  db.collection("bookingLimits").doc(bookingLimitId(kind, workspaceId, value))

function savedCount(data: FirebaseFirestore.DocumentData | undefined): BookingLimitCount | null {
  return data && typeof data.count === "number" && typeof data.windowEndsAt === "string"
    ? { count: data.count, windowEndsAt: data.windowEndsAt }
    : null
}

/** Uses one of the visitor's tries; false when they're out of them. */
async function takeVisitorTry(workspaceId: string, visitor: string): Promise<boolean> {
  const ref = limitDoc("visitor", workspaceId, visitor)
  return db.runTransaction(async (txn) => {
    const nowIso = new Date().toISOString()
    const saved = savedCount((await txn.get(ref)).data())
    if (currentBookingCount(saved, nowIso) >= BOOKING_LIMITS.visitor.max) return false
    txn.set(ref, nextBookingCount("visitor", saved, nowIso))
    return true
  })
}

/** The limit a new booking would go over (email first), or null. */
async function bookingLimitReached(workspaceId: string, email: string): Promise<BookingLimitKind | null> {
  const nowIso = new Date().toISOString()
  const [byEmail, byBusiness] = await Promise.all([
    limitDoc("email", workspaceId, email).get(),
    limitDoc("business", workspaceId, workspaceId).get(),
  ])
  if (currentBookingCount(savedCount(byEmail.data()), nowIso) >= BOOKING_LIMITS.email.max) return "email"
  if (currentBookingCount(savedCount(byBusiness.data()), nowIso) >= BOOKING_LIMITS.business.max) return "business"
  return null
}

/** Counts a booking just made against its email and its business. */
async function countBooking(workspaceId: string, email: string): Promise<void> {
  const refs = [
    { kind: "email" as const, ref: limitDoc("email", workspaceId, email) },
    { kind: "business" as const, ref: limitDoc("business", workspaceId, workspaceId) },
  ]
  await db.runTransaction(async (txn) => {
    const nowIso = new Date().toISOString()
    const snaps = await Promise.all(refs.map(({ ref }) => txn.get(ref)))
    refs.forEach(({ kind, ref }, i) => txn.set(ref, nextBookingCount(kind, savedCount(snaps[i].data()), nowIso)))
  })
}

/** `visitor`: who's booking (their address), for the tries limit; "" when unknown. */
export async function bookOnline(slug: string, raw: unknown, visitor: string): Promise<OnlineBookingResult> {
  const page = await findBookingPage(slug)
  if (!page) return { kind: "not_found" }
  if (visitor && !(await takeVisitorTry(page.workspaceId, visitor))) return { kind: "limited", message: BOOKING_LIMIT_MESSAGES.visitor }
  const parsed = OnlineBookingInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Check your details and try again." }
  const input = parsed.data
  // Only bots fill the hidden field.
  if (input.website) return { kind: "invalid", message: "Couldn't book that. Try again." }
  const stampProblem = bookingFormStampProblem(BOOKING_FORM_SECRET.value(), page.slug, input.key, input.stamp, Date.now())
  if (stampProblem === "too_fast") {
    return { kind: "invalid", message: "Couldn't book that. Try again.", form: { formKey: input.key, formStamp: input.stamp } }
  }
  if (stampProblem) return { kind: "invalid", message: "This form timed out. Check your details and book again." }
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
    const limit = await bookingLimitReached(page.workspaceId, input.email)
    if (limit) return { kind: "limited", message: BOOKING_LIMIT_MESSAGES[limit] }
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
  if (outcome.created) {
    // A missed count only loosens the limits; never fail the booking for it.
    await countBooking(page.workspaceId, input.email).catch((error) => console.error("bookOnline: count failed", error))
  }
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
