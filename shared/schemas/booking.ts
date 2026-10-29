import { z } from "zod"

/* --------------------------------------------------------
 * BOOKING SETTINGS — workspaces/{workspaceId}/settings/booking
 *
 * What customers can book (services) and when (weekly hours, days off,
 * notice, how far ahead), for one workspace. Customers read it through the
 * public booking page (step 4, shared/onlineBooking.ts) once it's on. Times are wall-clock "HH:MM" in the
 * workspace's own time zone, so 9:00 stays 9:00 across daylight saving.
 * -------------------------------------------------------- */

export const BOOKING_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
export type BookingDay = (typeof BOOKING_DAYS)[number]

export const BOOKING_SLOT_STEPS = [15, 30, 60] as const
export const BOOKING_MAX_SERVICES = 50
export const BOOKING_MAX_DAYS_OFF = 366
export const BOOKING_MAX_BLOCKS_PER_DAY = 4
export const BOOKING_MAX_LOCATION = 300

// How long before an appointment a client can still cancel and get their
// deposit back. null = deposits are never refunded when the client cancels.
export const BOOKING_REFUND_CUTOFF_OPTIONS = [24, 48, 72, 168] as const
export const DEFAULT_BOOKING_REFUND_CUTOFF_HOURS = 24
export const BookingRefundCutoffSchema = z.number().int().min(0).max(168).nullable()

// Reminder emails to clients before a confirmed appointment
// (shared/appointmentReminders.ts): up to two, each this many hours ahead,
// earliest first. [] = off. Saves from before the choice was added read
// "off" → [], "day" → [24], "day_and_hours" → [24, 2].
export const BOOKING_REMINDER_OPTIONS = [
  { hours: 168, label: "1 week before" },
  { hours: 72, label: "3 days before" },
  { hours: 48, label: "2 days before" },
  { hours: 24, label: "1 day before" },
  { hours: 4, label: "4 hours before" },
  { hours: 2, label: "2 hours before" },
  { hours: 1, label: "1 hour before" },
] as const
export const BOOKING_MAX_REMINDERS = 2
export const DEFAULT_BOOKING_REMINDERS: number[] = [24]
const REMINDER_HOURS = new Set<number>(BOOKING_REMINDER_OPTIONS.map((option) => option.hours))
const LEGACY_REMINDERS: Record<string, number[]> = { off: [], day: [24], day_and_hours: [24, 2] }
export const BookingRemindersSchema = z.preprocess(
  (value) => (typeof value === "string" ? LEGACY_REMINDERS[value] ?? value : value),
  z
    .array(z.number().refine((hours) => REMINDER_HOURS.has(hours), "Pick a reminder time from the list."))
    .max(BOOKING_MAX_REMINDERS, `Up to ${BOOKING_MAX_REMINDERS} reminders.`)
    .refine((hours) => new Set(hours).size === hours.length, "Pick two different reminder times.")
    .transform((hours) => [...hours].sort((a, b) => b - a))
)

// Used when a workspace has no time zone saved anywhere (matches payPeriods).
export const DEFAULT_BOOKING_TIME_ZONE = "America/Los_Angeles"

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00")
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-25")

export function bookingMinutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number)
  return hours * 60 + minutes
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

export const BookingHoursBlockSchema = z.object({
  start: TimeSchema,
  end: TimeSchema,
})

export const BookingDepositSchema = z.object({
  type: z.enum(["none", "fixed", "percent"]),
  value: z.number().nonnegative().max(10_000_000),
})

export const BookingServiceSchema = z
  .object({
    // Made on the device; stays the same when the service is renamed.
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1, "Give the service a name.").max(80),
    price: z.number().nonnegative().max(1_000_000),
    minutes: z.number().int().min(5).max(720),
    deposit: BookingDepositSchema,
    // Kept free after the appointment (cleanup, travel) before the next one.
    bufferMinutes: z.number().int().min(0).max(240),
    // Off = hidden from customers, kept for later.
    active: z.boolean(),
  })
  .superRefine((service, ctx) => {
    const problem = bookingServiceProblem(service)
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["deposit"] })
  })

const WeeklyHoursSchema = z.object(
  Object.fromEntries(
    BOOKING_DAYS.map((day) => [day, z.array(BookingHoursBlockSchema).max(BOOKING_MAX_BLOCKS_PER_DAY)])
  ) as Record<BookingDay, z.ZodArray<typeof BookingHoursBlockSchema>>
)

export const DEFAULT_BOOKING_WEEKLY_HOURS: Record<BookingDay, Array<{ start: string; end: string }>> = {
  sun: [],
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [],
}

const BookingSettingsFields = z.object({
  services: z.array(BookingServiceSchema).max(BOOKING_MAX_SERVICES),
  weeklyHours: WeeklyHoursSchema,
  daysOff: z.array(DateSchema).max(BOOKING_MAX_DAYS_OFF),
  // No bookings that start sooner than this.
  minNoticeHours: z.number().int().min(0).max(168),
  // No bookings further out than this.
  maxDaysAhead: z.number().int().min(1).max(365),
  // Start times offered: every 15, 30 or 60 minutes.
  slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  // IANA name, e.g. "America/Chicago". "" until saved: the server fills it
  // from the workspace's settings time zone when it's read.
  timeZone: z.string().max(64),
  // Where appointments happen, as typed (may be several lines). Copied onto
  // each new appointment and shown to the client. "" = no fixed place.
  // Optional on input: a save from an app version without it keeps the
  // saved one (bookingService).
  location: z.string().trim().max(BOOKING_MAX_LOCATION).optional(),
  // Free cancellation up to this many hours before (deposit refunded);
  // later, the deposit is kept. Optional on input like location.
  refundCutoffHours: BookingRefundCutoffSchema.optional(),
  // The public booking page: on or off, and its link name
  // (app.the521app.com/book/{slug}, unique across 521 — bookingLinks/{slug}).
  // Optional on input like location.
  onlineBookingEnabled: z.boolean().optional(),
  bookingSlug: z.string().trim().toLowerCase().max(40).optional(),
  // 521 emails clients their appointment link (booked, asked to confirm,
  // canceled by the owner). Optional on input like location.
  emailClients: z.boolean().optional(),
  // Reminder emails before appointments. Optional on input like location.
  reminders: BookingRemindersSchema.optional(),
  // All-day events in the owner's busy calendars block the whole day
  // (shared/busyTimes.ts). Optional on input like location.
  busyAllDay: z.boolean().optional(),
})

function refineSettings(settings: z.infer<typeof BookingSettingsFields>, ctx: z.RefinementCtx) {
  const problem = bookingSettingsProblem(settings)
  if (problem) ctx.addIssue({ code: "custom", message: problem.message, path: problem.path })
}

// What the app sends: the whole thing, every time.
export const BookingSettingsInputSchema = BookingSettingsFields.superRefine(refineSettings)

// What's stored and read back: defaults fill anything missing.
export const BookingSettingsSchema = z.object({
  services: BookingSettingsFields.shape.services.default([]),
  weeklyHours: WeeklyHoursSchema.default(DEFAULT_BOOKING_WEEKLY_HOURS),
  daysOff: BookingSettingsFields.shape.daysOff.default([]),
  minNoticeHours: BookingSettingsFields.shape.minNoticeHours.default(2),
  maxDaysAhead: BookingSettingsFields.shape.maxDaysAhead.default(60),
  slotStepMinutes: BookingSettingsFields.shape.slotStepMinutes.default(30),
  timeZone: BookingSettingsFields.shape.timeZone.default(""),
  location: z.string().trim().max(BOOKING_MAX_LOCATION).default(""),
  refundCutoffHours: BookingRefundCutoffSchema.default(DEFAULT_BOOKING_REFUND_CUTOFF_HOURS),
  onlineBookingEnabled: z.boolean().default(false),
  // "" until a link is picked.
  bookingSlug: z.string().max(40).default(""),
  emailClients: z.boolean().default(true),
  reminders: BookingRemindersSchema.default(DEFAULT_BOOKING_REMINDERS),
  busyAllDay: z.boolean().default(false),
  updatedAt: z.string().optional(),
})

export type BookingHoursBlock = z.infer<typeof BookingHoursBlockSchema>
export type BookingDeposit = z.infer<typeof BookingDepositSchema>
export type BookingService = z.infer<typeof BookingServiceSchema>
export type BookingWeeklyHours = z.infer<typeof WeeklyHoursSchema>
export type BookingSettingsInput = z.infer<typeof BookingSettingsInputSchema>
export type BookingSettings = z.infer<typeof BookingSettingsSchema>
export type BookingReminders = z.infer<typeof BookingRemindersSchema>

/** Why this service can't be saved, or null. */
export function bookingServiceProblem(service: Pick<BookingService, "name" | "price" | "deposit">): string | null {
  const { deposit } = service
  if (deposit.type === "none") return null
  const label = service.name.trim() || "This service"
  if (!(deposit.value > 0)) return `${label}: enter the deposit amount, or choose None.`
  if (deposit.type === "percent" && deposit.value >= 100) return `${label}: a percent deposit has to be under 100%.`
  if (deposit.type === "fixed" && deposit.value > service.price) return `${label}: the deposit can't be more than the price.`
  return null
}

/** Why one day's hours can't be saved, or null. Blocks may come in any order. */
export function bookingDayHoursProblem(blocks: BookingHoursBlock[]): string | null {
  const sorted = [...blocks].sort((a, b) => bookingMinutesOfDay(a.start) - bookingMinutesOfDay(b.start))
  for (let index = 0; index < sorted.length; index += 1) {
    const block = sorted[index]
    if (bookingMinutesOfDay(block.end) <= bookingMinutesOfDay(block.start)) return "Each block of hours has to end after it starts."
    const next = sorted[index + 1]
    if (next && bookingMinutesOfDay(next.start) < bookingMinutesOfDay(block.end)) return "Two blocks of hours overlap."
  }
  return null
}

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** Every date from `from` through `to`, both included ([] if `to` is earlier). */
export function bookingDatesInRange(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to && dates.length <= BOOKING_MAX_DAYS_OFF; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

/** Days off as runs of back-to-back dates, e.g. Dec 20–25 instead of six dates. */
export function bookingDayOffRanges(dates: string[]): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = []
  for (const date of [...new Set(dates)].sort()) {
    const last = ranges[ranges.length - 1]
    if (last && shiftDate(last.end, 1) === date) last.end = date
    else ranges.push({ start: date, end: date })
  }
  return ranges
}

export const BOOKING_DAY_NAMES: Record<BookingDay, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
}

/** The first thing wrong with these settings (message and where), or null. */
export function bookingSettingsProblem(
  settings: Pick<BookingSettingsInput, "services" | "weeklyHours" | "timeZone">
): { message: string; path: Array<string | number> } | null {
  const ids = new Set<string>()
  for (const [index, service] of settings.services.entries()) {
    if (ids.has(service.id)) return { message: "Two services share an id.", path: ["services", index, "id"] }
    ids.add(service.id)
  }
  for (const day of BOOKING_DAYS) {
    const problem = bookingDayHoursProblem(settings.weeklyHours[day])
    if (problem) return { message: `${BOOKING_DAY_NAMES[day]}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`, path: ["weeklyHours", day] }
  }
  if (settings.timeZone !== "" && !isValidTimeZone(settings.timeZone)) {
    return { message: "That time zone isn't recognized.", path: ["timeZone"] }
  }
  return null
}
