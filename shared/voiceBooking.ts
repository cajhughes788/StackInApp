import { z } from "zod"

// Voice booking: what the app sends when someone books or moves an
// appointment out loud ("book Jenna Thursday at 2 for a cut", "move my 3 to
// 4"), and what comes back. Same server and daily voice limit as voice
// entries (shared/voiceEntry.ts). Nothing here books or moves anything — the
// app fills the New appointment form or the appointment's Change time, and
// the person taps Book or Move it.
//
// Times come back as said (hour, minute, am/pm or not). The app picks AM or
// PM from the person's booking hours (frontend/lib/voiceBookingFill.ts), and
// finds which appointment "my 3" means on the phone: appointments never go
// to the server.

const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const VoiceTimeSchema = z.object({
  // 1–12 as said, or 0–23 when said on a 24-hour clock.
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  // null when they didn't say AM or PM (or morning/afternoon/evening/night).
  meridiem: z.enum(["am", "pm"]).nullable(),
})
export type VoiceTime = z.infer<typeof VoiceTimeSchema>

// What's on the New appointment form when someone taps "Fix by voice".
export const VoiceBookingCurrentSchema = z.object({
  clientName: z.string().max(80).nullable(),
  clientEmail: z.string().max(254).nullable(),
  clientPhone: z.string().max(40).nullable(),
  serviceName: z.string().max(80).nullable(),
  price: z.number().nonnegative().max(1_000_000).nullable(),
  minutes: z.number().int().positive().max(1440),
  date: DATE_KEY.nullable(),
  // "14:00"
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  location: z.string().max(500).nullable(),
})
export type VoiceBookingCurrent = z.infer<typeof VoiceBookingCurrentSchema>

export const VoiceBookingRequestSchema = z.object({
  kind: z.literal("booking"),
  // "book": the New appointment form. "any": the Booking page, where they
  // may book a new one or move one.
  mode: z.enum(["book", "any"]),
  transcript: z.string().trim().min(1).max(1000),
  // The phone's own date, so "Thursday" means the person's Thursday.
  today: DATE_KEY,
  // Saved client and service names, so spoken names are spelled as saved.
  clients: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  services: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  current: VoiceBookingCurrentSchema.optional(),
  // What the voice button just asked for ("email", "service"): a bare answer fills those.
  asking: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})
export type VoiceBookingRequest = z.infer<typeof VoiceBookingRequestSchema>

export const VoiceBookingResultSchema = z.object({
  // "none" when what was said isn't about booking or moving an appointment.
  action: z.enum(["book", "move", "none"]),
  // Booking: who, what, and when. Moving: when it moves to.
  clientName: z.string().trim().min(1).max(80).nullable(),
  clientEmail: z.string().trim().max(254).nullable(),
  clientPhone: z.string().trim().max(40).nullable(),
  serviceName: z.string().trim().min(1).max(80).nullable(),
  price: z.number().positive().max(1_000_000).nullable(),
  minutes: z.number().int().positive().max(1440).nullable(),
  date: DATE_KEY.nullable(),
  time: VoiceTimeSchema.nullable(),
  location: z.string().trim().max(500).nullable(),
  // true for "already confirmed" / "book it now"; null = the usual choice.
  confirmNow: z.boolean().nullable(),
  // Moving: which appointment — its day, its time and/or its client.
  fromDate: DATE_KEY.nullable(),
  fromTime: VoiceTimeSchema.nullable(),
  fromClient: z.string().trim().min(1).max(80).nullable(),
})
export type VoiceBookingResult = z.infer<typeof VoiceBookingResultSchema>
