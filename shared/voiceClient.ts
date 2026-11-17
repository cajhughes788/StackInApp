import { z } from "zod"

// Voice client: what the app sends when someone adds a client out loud
// ("new client Jenna Morales, 509 555 0142, jenna at gmail dot com") or says
// a note on a client's page ("she wants to go lighter next time"), and what
// comes back. Same server and daily voice limit as voice entries
// (shared/voiceEntry.ts). Nothing here saves anything — the person taps Add
// client or Save notes. The saved client list never goes to the server:
// whether they're already a client is checked on the phone.

export const VOICE_CLIENT_REMOVABLE = ["phone", "email", "address", "notes"] as const

// What's on the Add client form when someone taps "Fix by voice".
export const VoiceClientCurrentSchema = z.object({
  name: z.string().max(80).nullable(),
  phone: z.string().max(40).nullable(),
  email: z.string().max(254).nullable(),
  address: z.string().max(300).nullable(),
  notes: z.string().max(2000).nullable(),
})
export type VoiceClientCurrent = z.infer<typeof VoiceClientCurrentSchema>

export const VoiceClientRequestSchema = z.object({
  kind: z.literal("client"),
  // "add": the Add client form. "note": a note for one client's page.
  mode: z.enum(["add", "note"]),
  transcript: z.string().trim().min(1).max(1500),
  current: VoiceClientCurrentSchema.optional(),
  // What the voice button just asked for ("email", "service"): a bare answer fills those.
  asking: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})
export type VoiceClientRequest = z.infer<typeof VoiceClientRequestSchema>

export const VoiceClientResultSchema = z.object({
  // false when the words aren't about a client (or, for a note, there's no note).
  isClient: z.boolean(),
  name: z.string().trim().min(1).max(80).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().max(254).nullable(),
  // An email was said but didn't come out as a real address.
  emailUnclear: z.boolean().default(false),
  address: z.string().trim().max(300).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  // A fix like "remove the email": these boxes get emptied.
  remove: z.array(z.enum(VOICE_CLIENT_REMOVABLE)).default([]),
  // Other people named in the same breath ("and her sister Mia"), to add next.
  others: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
})
export type VoiceClientResult = z.infer<typeof VoiceClientResultSchema>

/** Phone digits in the usual US look when they're a US number; otherwise as said. */
export function tidyPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 7) return null
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  if (ten.length === 7) return `${ten.slice(0, 3)}-${ten.slice(3)}`
  return phone.trim()
}
