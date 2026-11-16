import { z } from "zod"

// Voice entry: what the app sends when someone says an entry out loud
// ("270 today, 9 to 5, 40 in tips"), and the fields that come back to fill
// the Add entry form. Nothing here saves anything — the person always checks
// the filled form and taps Add entry themselves.

// Where a spoken amount goes. Matches the entry form's own field names.
// "tipsUnsure" = tips with no way to tell which tips field;
// "unsure" = an amount with nothing saying what it was.
export const VOICE_AMOUNT_TARGETS = [
  // Independent workspaces
  "venmo",
  "appleCash",
  "zelle",
  "checks",
  "cashApp",
  "posSales",
  "cashSales",
  "posTips",
  "cashTips",
  // W-2 workspaces
  "cardTips",
  "reportedCash",
  // Both
  "personalCash",
  "tipsUnsure",
  "unsure",
] as const
export type VoiceAmountTarget = (typeof VOICE_AMOUNT_TARGETS)[number]

export const VOICE_SPLIT_CATEGORIES = ["services", "tips", "products", "other"] as const

export const VoiceEntryRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(1000),
  // The phone's own date, so "today" / "yesterday" / "Monday" mean the
  // person's day, not the server's.
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workspaceType: z.enum(["w2", "independent"]),
  // Only the fields this workspace's form shows.
  fields: z.array(z.enum(VOICE_AMOUNT_TARGETS)).max(20),
  // W-2 positions the person set up, so "worked the bar" can pick one.
  positions: z
    .array(z.object({ id: z.string().max(100), title: z.string().max(100) }))
    .max(30)
    .default([]),
})
export type VoiceEntryRequest = z.infer<typeof VoiceEntryRequestSchema>

export const VoiceEntryAmountSchema = z.object({
  target: z.enum(VOICE_AMOUNT_TARGETS),
  // Only for Venmo / Apple Pay / Zelle / Checks / Cash App: which part of
  // the payment this was ("60 in Venmo tips" → tips). null = not said.
  category: z.enum(VOICE_SPLIT_CATEGORIES).nullable(),
  amount: z.number().positive().max(1_000_000),
})
export type VoiceEntryAmount = z.infer<typeof VoiceEntryAmountSchema>

export const VoiceEntryResultSchema = z.object({
  // false when what was said isn't an entry at all.
  isEntry: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  hours: z.number().positive().max(24).nullable(),
  // 24-hour "HH:MM".
  inTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  outTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  positionId: z.string().nullable(),
  amounts: z.array(VoiceEntryAmountSchema).max(20),
  notes: z.string().max(500).nullable(),
})
export type VoiceEntryResult = z.infer<typeof VoiceEntryResultSchema>
