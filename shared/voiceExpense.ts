import { z } from "zod"

// Voice expense: what the app sends when someone says an expense out loud
// ("spent 42 on gas at Shell yesterday", "drove 18 miles to a client"), and
// the fields that come back to fill the Add expense form. Same server and
// daily voice limit as voice entries (shared/voiceEntry.ts). Nothing here
// saves anything — the person checks the form and taps Save expense.

const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const NAME = z.string().trim().min(1).max(100)

// What's on the form when someone taps "Fix by voice". Only sent for a fix.
export const VoiceExpenseCurrentSchema = z.object({
  date: DATE_KEY.nullable(),
  amount: z.number().positive().max(1_000_000).nullable(),
  vendor: z.string().max(100).nullable(),
  description: z.string().max(200).nullable(),
  category: z.string().max(100).nullable(),
  miles: z.number().positive().max(5000).nullable(),
  parkingAndTolls: z.number().positive().max(100_000).nullable(),
})
export type VoiceExpenseCurrent = z.infer<typeof VoiceExpenseCurrentSchema>

export const VoiceExpenseRequestSchema = z.object({
  kind: z.literal("expense"),
  transcript: z.string().trim().min(1).max(1000),
  // The phone's own date, so "yesterday" means the person's day.
  today: DATE_KEY,
  // Whose learned merchants to check. The server checks the person belongs to it.
  workspaceId: z.string().min(1).max(200),
  // The categories this form offers, exactly as the picker shows them.
  categories: z.array(NAME).min(1).max(150),
  // The vehicle category's label when mileage can be logged; else null.
  vehicleCategory: NAME.nullable(),
  current: VoiceExpenseCurrentSchema.optional(),
  // What the voice button just asked for ("email", "service"): a bare answer fills those.
  asking: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})
export type VoiceExpenseRequest = z.infer<typeof VoiceExpenseRequestSchema>

// How the category was picked, best first: the person said it, a past
// decision about this merchant, or Claude's guess (shown as "check it").
export const VOICE_CATEGORY_SOURCES = ["said", "learned", "suggested"] as const
export type VoiceCategorySource = (typeof VOICE_CATEGORY_SOURCES)[number]

export const VoiceExpenseResultSchema = z.object({
  // false when what was said isn't an expense at all.
  isExpense: z.boolean(),
  date: DATE_KEY.nullable(),
  amount: z.number().positive().max(1_000_000).nullable(),
  vendor: z.string().max(100).nullable(),
  description: z.string().max(200).nullable(),
  // One of the request's categories, or null = ask.
  category: z.string().max(100).nullable(),
  categorySource: z.enum(VOICE_CATEGORY_SOURCES).nullable(),
  miles: z.number().positive().max(5000).nullable(),
  // "9 miles each way" / "round trip, 9 each way": miles is one way. The app
  // doubles it only after the person confirms.
  roundTrip: z.boolean().default(false),
  parkingAndTolls: z.number().positive().max(100_000).nullable(),
  // Phone speech writes "ninety-one twenty-one" as "9121", so a bare
  // four-digit amount is read as dollars and cents (91.21). This is the
  // whole-dollar reading (9121) for the note's "It was $9,121" button; null
  // when the amount wasn't read that way.
  amountAsWhole: z.number().positive().nullable().default(null),
})
export type VoiceExpenseResult = z.infer<typeof VoiceExpenseResultSchema>

/** Phone speech writes "ninety-one twenty-one" as "9121" and "forty-five
 * ninety-nine" as "4599", with no dot. When the amount is one of those
 * plain four-digit numbers in the words, it's read as dollars and cents.
 * Not when it ends in 00 ("twelve hundred" = 1200), has a $ sign, comma or
 * dot, or is followed by "dollars"/"bucks" — those are what they say.
 * Three digits stay whole dollars: "one twenty" means $120. */
export function readSpokenCents(transcript: string, amount: number | null): { amount: number | null; amountAsWhole: number | null } {
  if (amount === null || !Number.isInteger(amount) || amount < 1000 || amount > 9999 || amount % 100 === 0) {
    return { amount, amountAsWhole: null }
  }
  const pattern = /(^|[^\d$.,])(\d{4})(?![\d.,]*\d)(?!\s*(?:dollars?|bucks|grand)\b)/gi
  for (const match of transcript.matchAll(pattern)) {
    if (Number(match[2]) === amount) return { amount: amount / 100, amountAsWhole: amount }
  }
  return { amount, amountAsWhole: null }
}
