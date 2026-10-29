import { z } from "zod"

import {
  BOOKING_MAX_LOCATION,
  BookingDepositSchema,
  BookingRefundCutoffSchema,
  DEFAULT_BOOKING_REFUND_CUTOFF_HOURS,
  bookingServiceProblem,
} from "./booking"
import { InvoicePaidMethodSchema } from "./invoice"

/* --------------------------------------------------------
 * APPOINTMENTS — workspaces/{workspaceId}/appointments/{id}
 *
 * Booked by the owner in the app (step 2 of booking): a saved service or a
 * custom one, at a date and time in the workspace's time zone, either
 * confirmed at once or sent to the client to confirm. The service's name,
 * length, price and deposit are copied in, so editing a saved service later
 * never changes an appointment already booked.
 *
 * Deposits (step 3): the client pays through Stripe Checkout from their
 * link, or the owner records one paid another way. The money lives on an
 * ordinary invoice made for the appointment the first time a deposit
 * arrives (invoiceId; shared/appointmentDeposits.ts) — its payments,
 * refunds and income entries are the invoice flow's.
 * -------------------------------------------------------- */

// Waiting on the client holds the time this long, then it's released.
export const APPOINTMENT_HOLD_HOURS = 48

// "expired" is never stored by a person: a request left unanswered past its
// hold reads as expired (appointmentStatus) and is saved that way when it's
// next touched.
// "no_show": the client didn't come; any deposit is kept.
export const AppointmentStatusSchema = z.enum(["requested", "confirmed", "declined", "canceled", "completed", "expired", "no_show"])

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-25")
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00")
const IsoSchema = z.string().min(1)

const ServiceFields = {
  // The saved service it came from; null for a custom one.
  serviceId: z.string().trim().min(1).max(40).nullable(),
  serviceName: z.string().trim().min(1, "Name the service.").max(80),
  price: z.number().nonnegative().max(1_000_000),
  minutes: z.number().int().min(5).max(720),
  bufferMinutes: z.number().int().min(0).max(240),
  deposit: BookingDepositSchema,
}

export const AppointmentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string(),
  clientEmail: z.string().nullable(),
  clientPhone: z.string().nullable(),
  ...ServiceFields,
  // As the owner picked them, in the workspace's time zone.
  date: DateSchema,
  startTime: TimeSchema,
  timeZone: z.string(),
  // The same moment in UTC, for overlap checks: start, end, and end plus
  // the buffer (when the next appointment may start).
  startAt: IsoSchema,
  endAt: IsoSchema,
  blockedUntil: IsoSchema,
  status: AppointmentStatusSchema,
  // While "requested": when the hold lapses. Null otherwise.
  holdExpiresAt: IsoSchema.nullable(),
  // The client's link (appointmentShares/{token}); made on first share.
  shareToken: z.string().nullable(),
  // Booked outside the weekly hours or on a day off (the owner was warned).
  outsideHours: z.boolean().default(false),
  // Where it happens, copied in when booked (see BookingSettings.location).
  location: z.string().default(""),
  // The cancellation rule when it was booked (BookingSettings.refundCutoffHours).
  refundCutoffHours: BookingRefundCutoffSchema.default(DEFAULT_BOOKING_REFUND_CUTOFF_HOURS),
  // The invoice holding this appointment's money; null until a deposit arrives.
  invoiceId: z.string().nullable().default(null),
  // The client's open Stripe Checkout for the deposit, reused on a second tap.
  depositCheckout: z.object({ sessionId: z.string(), amountCents: z.number().int().positive() }).nullable().default(null),
  canceledBy: z.enum(["owner", "client"]).nullable().default(null),
  // Who made it: the owner in the app, or the customer on the public
  // booking page (step 4).
  source: z.enum(["owner", "online"]).default("owner"),
  // Each time it was moved to a new time (oldest first): where it was, when,
  // and who moved it. Clients may move their own once
  // (shared/appointmentReschedule.ts).
  reschedules: z
    .array(
      z.object({
        fromDate: DateSchema,
        fromStartTime: TimeSchema,
        fromStartAt: IsoSchema,
        at: IsoSchema,
        by: z.enum(["owner", "client"]),
      })
    )
    .default([]),
  // Where an online customer came from: the "Book now" button on the
  // owner's website (?via=site), or null for the plain link.
  bookedFrom: z.enum(["website"]).nullable().default(null),
  // The last time 521 emailed the client their link, and where.
  lastEmailedAt: IsoSchema.nullable().default(null),
  lastEmailedTo: z.string().nullable().default(null),
  // Recent sends, for the daily cap on resends.
  recentEmailSends: z.array(IsoSchema).default([]),
  respondedAt: IsoSchema.nullable().default(null),
  canceledAt: IsoSchema.nullable().default(null),
  completedAt: IsoSchema.nullable().default(null),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
})

export const AppointmentCreateInputSchema = z
  .object({
    // Retries of the same tap make the same appointment, never two.
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{6,128}$/),
    clientId: z.string().min(1).max(128).nullable().optional(),
    clientName: z.string().trim().min(1, "Who's the appointment for?").max(80),
    clientEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
    clientPhone: z.string().trim().max(40).nullable().optional(),
    ...ServiceFields,
    // A custom service can be kept for next time.
    saveAsService: z.boolean().default(false),
    date: DateSchema,
    startTime: TimeSchema,
    // false = booked and confirmed now; true = the client confirms by link.
    askToConfirm: z.boolean(),
    // This appointment's address; left out, it's the Booking setup one.
    location: z.string().trim().max(BOOKING_MAX_LOCATION).optional(),
    // The client's link, made by the app (random) so it can share it before
    // the server answers. Left out, the server makes one.
    shareToken: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/).optional(),
  })
  .superRefine((input, ctx) => {
    const problem = bookingServiceProblem({ name: input.serviceName, price: input.price, deposit: input.deposit })
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["deposit"] })
  })

// Money typed by the owner: positive, to the cent.
const OwnerMoneySchema = z
  .number()
  .max(100_000)
  .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Use dollars and cents.")

// Something added at the appointment ("Beard trim, $15"): its own invoice line.
export const AppointmentExtraSchema = z.object({
  description: z.string().trim().min(1, "Name the extra.").max(80),
  amount: OwnerMoneySchema.refine((amount) => amount > 0, "Give the extra a price."),
})

export type AppointmentExtra = z.infer<typeof AppointmentExtraSchema>

export const AppointmentActionSchema = z.discriminatedUnion("action", [
  // Returns the client's link, making it the first time.
  z.object({ action: z.literal("share") }),
  // Emails the client their link again; "to" also updates their address.
  z.object({ action: z.literal("email"), to: z.string().trim().email().max(254).optional() }),
  // The client said yes another way (a call, a text).
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("complete") }),
  // The client didn't come: ends it and keeps any deposit.
  z.object({ action: z.literal("no_show") }),
  // Moves it to a new time (same service and length).
  z.object({ action: z.literal("reschedule"), date: DateSchema, startTime: TimeSchema }),
  // Finish & get paid (shared/appointmentCheckout.ts): the rest, with any
  // extras and discount, goes on the appointment's invoice. "qr": the client
  // pays on their phone now. "paid": they paid another way (with any tip).
  // "later": 521 sends them the invoice to pay. Can be repeated while it's
  // unpaid, to switch how it's paid.
  z.object({
    action: z.literal("finish"),
    extras: z.array(AppointmentExtraSchema).max(10).default([]),
    discount: OwnerMoneySchema.refine((amount) => amount >= 0, "The discount can't be negative.").default(0),
    way: z.enum(["qr", "paid", "later"]),
    askForTip: z.boolean().default(true),
    paymentMethod: InvoicePaidMethodSchema.optional(),
    tipAmount: OwnerMoneySchema.refine((amount) => amount >= 0, "The tip can't be negative.").default(0),
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }),
  // The deposit was paid another way (cash, Zelle). Confirms a waiting request.
  z.object({
    action: z.literal("record_deposit"),
    paidDate: DateSchema,
    paymentMethod: InvoicePaidMethodSchema,
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }),
])

// From the client's page. "cancel" is a confirmed appointment called off by
// the client (the deposit is refunded or kept by the cancellation rule).
export const AppointmentResponseSchema = z.enum(["confirm", "decline", "cancel"])

// The client moving their own appointment from its page (/b/{token}/move).
export const AppointmentClientMoveSchema = z.object({ date: DateSchema, time: TimeSchema })

export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>
export type AppointmentType = z.infer<typeof AppointmentSchema>
export type AppointmentCreateInput = z.input<typeof AppointmentCreateInputSchema>
export type AppointmentAction = z.infer<typeof AppointmentActionSchema>
export type AppointmentResponse = z.infer<typeof AppointmentResponseSchema>

// What the public booking page posts (step 4). `key` is made fresh for each
// form, so a double tap books once; `website` is a hidden field only bots fill.
export const OnlineBookingInputSchema = z.object({
  service: z.string().trim().min(1).max(40),
  date: DateSchema,
  time: TimeSchema,
  key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email.").max(254),
  phone: z.string().trim().max(40).optional().default(""),
  website: z.string().max(200).optional().default(""),
  // "site" when they came from the owner's website button.
  via: z.string().max(20).optional().default(""),
})

export type OnlineBookingInput = z.infer<typeof OnlineBookingInputSchema>
