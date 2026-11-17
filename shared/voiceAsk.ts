import { z } from "zod"

// Ask 521 (Home's mic): what the app sends when someone asks a question
// ("how much did I make this week?"), asks to open a page ("show my October
// P&L"), or says something to log ("42 on gas at Shell"), and what comes
// back: only WHAT they asked for. Claude never sees a single amount or
// record. The app works out every number from the person's own data with the
// same math its screens use (frontend/lib/voiceAskAnswer.ts), and a "log"
// goes to that form's own voice fill. Same server and daily voice limit as
// voice entries; a "log" counts once (the form's fill is the one counted).

const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const VOICE_ASK_TOPICS = [
  "income", // how much they made
  "tips",
  "hours", // hours worked
  "expenses", // what they spent (category optional)
  "profit", // income − expenses
  "compare_income", // this period vs another
  "owed", // who owes them / unpaid invoices
  "overdue", // overdue invoices
  "appointments", // what's on a day
  "next_appointment", // their next appointment (client optional)
  "client_paid", // how much one client has paid
] as const
export type VoiceAskTopic = (typeof VOICE_ASK_TOPICS)[number]

export const VOICE_ASK_PERIOD_KINDS = [
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
  "this_quarter", "last_quarter", "this_year", "last_year",
  // A named month, quarter, year or day (month 1–12, quarter 1–4, year, date).
  "month", "quarter", "year", "day",
  "all_time",
] as const

export const VoiceAskPeriodSchema = z.object({
  kind: z.enum(VOICE_ASK_PERIOD_KINDS),
  month: z.number().int().min(1).max(12).nullable(),
  quarter: z.number().int().min(1).max(4).nullable(),
  year: z.number().int().min(2000).max(2100).nullable(),
  date: DATE_KEY.nullable(),
})
export type VoiceAskPeriod = z.infer<typeof VoiceAskPeriodSchema>

export const VOICE_ASK_PAGES = [
  "home", "pl", "earnings", "invoices", "overdue", "unpaid", "quotes", "clients", "client", "booking", "receipts", "expenses",
] as const
export type VoiceAskPage = (typeof VOICE_ASK_PAGES)[number]

// How they were paid, as income lines save it ("how much came in on Venmo").
export const VOICE_ASK_PAYMENT_METHODS = ["cash", "card", "venmo", "apple_cash", "zelle", "check", "cash_app"] as const
export type VoiceAskPaymentMethod = (typeof VOICE_ASK_PAYMENT_METHODS)[number]

export const VOICE_ASK_FORMS = ["entry", "expense", "invoice", "quote", "booking", "client"] as const
export type VoiceAskForm = (typeof VOICE_ASK_FORMS)[number]

export const VoiceAskRequestSchema = z.object({
  kind: z.literal("ask"),
  transcript: z.string().trim().min(1).max(1000),
  today: DATE_KEY,
  workspaceType: z.enum(["w2", "independent"]),
  // Names only, so spoken names are spelled as saved.
  clients: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  expenseCategories: z.array(z.string().trim().min(1).max(100)).max(150).default([]),
})
export type VoiceAskRequest = z.infer<typeof VoiceAskRequestSchema>

export const VoiceAskResultSchema = z.object({
  // question: answer it. open: go to a page. log: hand the words to a form.
  // none: none of these (or something 521 can't do, like taxes or settings).
  intent: z.enum(["question", "open", "log", "none"]),
  topic: z.enum(VOICE_ASK_TOPICS).nullable(),
  period: VoiceAskPeriodSchema.nullable(),
  // compare_income: the other period ("compared to last month").
  comparePeriod: VoiceAskPeriodSchema.nullable(),
  // An expense category, copied from the list.
  category: z.string().trim().min(1).max(100).nullable(),
  // A client's name, as saved when it sounds like one.
  client: z.string().trim().min(1).max(80).nullable(),
  page: z.enum(VOICE_ASK_PAGES).nullable(),
  form: z.enum(VOICE_ASK_FORMS).nullable(),
  // income / tips / compare_income: only money paid this way.
  paymentMethod: z.enum(VOICE_ASK_PAYMENT_METHODS).nullable().default(null),
  // Something they narrowed the question by that the fields above can't hold
  // ("PayPal", "haircuts", "at the salon"), in their words: the app says it
  // can't split by that yet instead of answering a bigger question.
  unsupported: z.string().trim().min(1).max(80).nullable().default(null),
  // log: false when they only named the form ("add an expense"), so the app
  // opens it listening instead of filling it from nothing.
  hasDetails: z.boolean().default(true),
})
export type VoiceAskResult = z.infer<typeof VoiceAskResultSchema>
