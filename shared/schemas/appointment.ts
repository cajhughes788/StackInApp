import { z } from "zod"

import { BookingDepositSchema, bookingServiceProblem } from "./booking"

/* --------------------------------------------------------
 * APPOINTMENTS — workspaces/{workspaceId}/appointments/{id}
 *
 * Booked by the owner in the app (step 2 of booking): a saved service or a
 * custom one, at a date and time in the workspace's time zone, either
 * confirmed at once or sent to the client to confirm. The service's name,
 * length, price and deposit are copied in, so editing a saved service later
 * never changes an appointment already booked. No money moves yet.
 * -------------------------------------------------------- */

// Waiting on the client holds the time this long, then it's released.
export const APPOINTMENT_HOLD_HOURS = 48

// "expired" is never stored by a person: a request left unanswered past its
// hold reads as expired (appointmentStatus) and is saved that way when it's
// next touched.
export const AppointmentStatusSchema = z.enum(["requested", "confirmed", "declined", "canceled", "completed", "expired"])

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
  })
  .superRefine((input, ctx) => {
    const problem = bookingServiceProblem({ name: input.serviceName, price: input.price, deposit: input.deposit })
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["deposit"] })
  })

export const AppointmentActionSchema = z.discriminatedUnion("action", [
  // Returns the client's link, making it the first time.
  z.object({ action: z.literal("share") }),
  // The client said yes another way (a call, a text).
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("complete") }),
])

// From the client's page.
export const AppointmentResponseSchema = z.enum(["confirm", "decline"])

export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>
export type AppointmentType = z.infer<typeof AppointmentSchema>
export type AppointmentCreateInput = z.input<typeof AppointmentCreateInputSchema>
export type AppointmentAction = z.infer<typeof AppointmentActionSchema>
export type AppointmentResponse = z.infer<typeof AppointmentResponseSchema>
