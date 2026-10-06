import { suggestExpenseCategoryFromText } from "./expenseKeywordMatching"
import type { RecurringCadence } from "./schemas/recurringRule"

export type PlaidClassificationInput = {
  merchantName: string | null
  rawName: string
  personalFinanceCategoryPrimary: string | null
  amount: number
}

export type PlaidClassificationResult = {
  suggestedExpenseAccount: string | null
  isBusinessGuess: boolean | null
  confidence: number
}

// Normalizes a merchant name into a stable key for
// shared/schemas/plaidMerchantMemory.ts — lowercased, punctuation and
// digit-runs stripped (store numbers like "Target 1147" or "Shell #4021"
// would otherwise create a separate memory entry per store location).
//
// Digit-stripping only happens when Plaid has already identified a real,
// named merchant (`merchantName` present) — in that case any leftover
// digits genuinely are just store-number noise. When there's no enriched
// merchant name and this falls back to the raw, unenriched bank descriptor,
// embedded digits are far more likely to be a per-transaction reference (a
// Zelle/Venmo transfer, an order or invoice number) that actually
// distinguishes one real transaction or counterparty from another —
// stripping those would wrongly collapse unrelated transfers into a single
// inflated "merchant" (surfacing as an inaccurate "seen N times" count for
// something that only happened once).
export function normalizePlaidMerchantKey(merchantName: string | null, rawName: string): string {
  const hasEnrichedName = Boolean(merchantName && merchantName.trim().length > 0)
  const source = (hasEnrichedName ? merchantName! : rawName).toLowerCase()
  let normalized = source.replace(/[^a-z0-9\s]/g, " ")
  if (hasEnrichedName) {
    normalized = normalized.replace(/\b\d+\b/g, " ")
  }
  return normalized.replace(/\s+/g, " ").trim()
}

// The key format used before raw descriptors kept their digits: digit-runs
// were always stripped. Merchant memory (and pending transactions) written
// back then are stored under this key, so lookups for un-enriched merchants
// fall back to it — see resolveMerchantKey in backend plaidService. Only
// differs from normalizePlaidMerchantKey when there's no merchantName.
export function legacyPlaidMerchantKey(merchantName: string | null, rawName: string): string {
  return (merchantName ?? rawName)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Some banks/card networks mask an embedded account or card number directly
// in their own raw transaction descriptor (e.g. "POS DEBIT ************1234").
// When Plaid's merchant enrichment (merchant_name) comes back empty for a
// transaction like that, falling back to the raw descriptor as-is means the
// user sees a wall of asterisks instead of a name. Treat a string with too
// few real letters, or dominated by mask characters, as unusable.
function isUnhelpfulPlaidName(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const letters = trimmed.replace(/[^a-zA-Z]/g, "")
  if (letters.length < 2) return true
  const maskChars = (trimmed.match(/\*/g) ?? []).length
  return maskChars / trimmed.length > 0.4
}

// The single place that decides what a human sees for a Plaid transaction's
// name — used anywhere a merchant/vendor name is shown or stored for
// display (the review card, push notifications, merchant memory, the
// confirmed expense's own vendor field). Prefers the enriched merchant
// name, falls back to the raw descriptor, and only resorts to a plain
// placeholder when both are unhelpful.
export function resolvePlaidDisplayName(merchantName: string | null, rawName: string): string {
  if (merchantName && !isUnhelpfulPlaidName(merchantName)) return merchantName
  if (!isUnhelpfulPlaidName(rawName)) return rawName
  return "Unknown merchant"
}

// Maps Plaid's Personal Finance Category taxonomy (primary tier) to the
// app's own EXPENSE_CATEGORY_GUIDE labels (shared/expenseCategories.ts).
// Stays conservative — only categories with a clear business-expense
// analogue get a mapping; everything else falls through to the keyword
// matcher, and if that also comes up empty, isBusinessGuess stays null.
const PFC_TO_EXPENSE_CATEGORY: Record<string, string> = {
  RENT_AND_UTILITIES: "Utilities",
  TRANSPORTATION: "Vehicle & Transportation",
  TRAVEL: "Travel",
  GENERAL_SERVICES: "Professional Fees",
  GENERAL_MERCHANDISE: "Supplies",
  HOME_IMPROVEMENT: "Supplies",
  PERSONAL_CARE: "Supplies",
  GOVERNMENT_AND_NON_PROFIT: "Taxes & Licenses",
  LOAN_PAYMENTS: "Interest on Loan",
  BANK_FEES: "Payment Processing Fees",
}

// Primary-tier PFC values confident enough to imply a business expense on
// their own (a rent/utilities or transportation charge on a linked business
// account is very likely business use). Everything else stays "no guess"
// unless the keyword matcher finds a stronger signal.
const CONFIDENT_BUSINESS_PFC = new Set(["RENT_AND_UTILITIES", "TRANSPORTATION", "LOAN_PAYMENTS", "BANK_FEES"])

export function classifyPlaidTransaction(input: PlaidClassificationInput): PlaidClassificationResult {
  const pfcCategory = input.personalFinanceCategoryPrimary
    ? PFC_TO_EXPENSE_CATEGORY[input.personalFinanceCategoryPrimary] ?? null
    : null

  if (pfcCategory) {
    return {
      suggestedExpenseAccount: pfcCategory,
      isBusinessGuess: CONFIDENT_BUSINESS_PFC.has(input.personalFinanceCategoryPrimary as string) ? true : null,
      confidence: 0.6,
    }
  }

  const keywordCategory = suggestExpenseCategoryFromText(input.merchantName ?? input.rawName)
  if (keywordCategory) {
    return {
      suggestedExpenseAccount: keywordCategory,
      isBusinessGuess: null,
      confidence: 0.4,
    }
  }

  return {
    suggestedExpenseAccount: null,
    isBusinessGuess: null,
    confidence: 0,
  }
}

// Two amounts count as "the same recurring charge" if they're within $3 or
// 10%, whichever is larger — covers small subscription price bumps without
// matching unrelated purchases at the same merchant.
export function isSimilarRecurringAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(3, Math.abs(a) * 0.1)
}

// Looks only at the gap between the two most recent occurrences — enough to
// recognize a cadence without needing a full history, and self-correcting
// since it's re-evaluated on every confirm. A gap that falls in none of these
// windows (e.g. an irregular one-off repeat) returns null rather than
// guessing at the nearest cadence.
export function detectRecurringCadence(sortedDatesAscending: string[]): RecurringCadence | null {
  if (sortedDatesAscending.length < 2) return null
  const last = sortedDatesAscending[sortedDatesAscending.length - 1]
  const prev = sortedDatesAscending[sortedDatesAscending.length - 2]
  const gapDays = Math.round(
    (new Date(`${last}T12:00:00Z`).getTime() - new Date(`${prev}T12:00:00Z`).getTime()) / 86400000
  )
  if (gapDays >= 5 && gapDays <= 9) return { freq: "weekly" }
  if (gapDays >= 11 && gapDays <= 17) return { freq: "biweekly" }
  if (gapDays >= 26 && gapDays <= 33) return { freq: "monthly" }
  return null
}
