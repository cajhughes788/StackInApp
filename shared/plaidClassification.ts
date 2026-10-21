import { suggestExpenseCategoryFromText } from "./expenseKeywordMatching"
import type { RecurringCadence } from "./schemas/recurringRule"
import type { PaymentMethod } from "./schemas/entry"
import type { PlaidSuggestionSource } from "./schemas/plaidPendingTransaction"

export type { PlaidSuggestionSource }

export type PlaidClassificationInput = {
  merchantName: string | null
  rawName: string
  personalFinanceCategoryPrimary: string | null
  personalFinanceCategoryDetailed?: string | null
  // Plaid's personal_finance_category.confidence_level (VERY_HIGH, HIGH,
  // MEDIUM, LOW, UNKNOWN); null when Plaid didn't send one.
  personalFinanceCategoryConfidence?: string | null
  amount: number
}

export type PlaidClassificationResult = {
  suggestedExpenseAccount: string | null
  isBusinessGuess: boolean | null
  confidence: number
  suggestionSource: PlaidSuggestionSource | null
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

// The key income memory (shared/schemas/plaidIncomeMemory.ts) is stored
// under. Unlike normalizePlaidMerchantKey, digit-runs are always stripped:
// on a deposit, the leftover digits are a per-payment reference ("Zelle
// payment from JOHN SMITH 18273645"), and stripping them is exactly what
// lets every payment from the same person land on one payer. Different
// payers still differ by name.
export function normalizePlaidPayerKey(merchantName: string | null, rawName: string): string {
  return legacyPlaidMerchantKey(merchantName, rawName)
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

// Detailed-tier overrides, checked before the primary map above. Only
// entries where the detailed category says something the primary one
// gets wrong — rent filed under RENT_AND_UTILITIES isn't a utility, and
// office supplies or electronics aren't consumables. null means "this
// detailed category has no business analogue": no guess at all, rather
// than falling back to the primary tier's (e.g. a donation or a tax
// payment is not a deductible expense, whatever GOVERNMENT_AND_NON_PROFIT
// maps to). Uses Plaid's v1 taxonomy names; an unrecognized detailed value
// just falls back to the primary map.
const PFC_DETAILED_TO_EXPENSE_CATEGORY: Record<string, string | null> = {
  RENT_AND_UTILITIES_RENT: "Rent / Booth Rent",
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: "Office Expenses",
  GENERAL_MERCHANDISE_ELECTRONICS: "Equipment",
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "Work Clothing",
  GENERAL_MERCHANDISE_PET_SUPPLIES: null,
  GENERAL_MERCHANDISE_TOBACCO_AND_VAPE: null,
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: null,
  GENERAL_SERVICES_EDUCATION: "Education & Training",
  GENERAL_SERVICES_INSURANCE: "Insurance",
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: "Office Expenses",
  GENERAL_SERVICES_AUTOMOTIVE: "Vehicle & Transportation",
  GENERAL_SERVICES_CHILDCARE: null,
  HOME_IMPROVEMENT_FURNITURE: "Equipment",
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: "Cleaning & Sanitation",
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: null,
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: null,
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: null,
  BANK_FEES_INTEREST_CHARGE: "Interest on Loan",
}

// Primary-tier PFC values confident enough to imply a business expense on
// their own (a rent/utilities or transportation charge on a linked business
// account is very likely business use). Everything else stays "no guess"
// unless the keyword matcher finds a stronger signal.
const CONFIDENT_BUSINESS_PFC = new Set(["RENT_AND_UTILITIES", "TRANSPORTATION", "LOAN_PAYMENTS", "BANK_FEES"])

// Order: Plaid's category, then keywords, then a Plaid category Plaid itself
// rated LOW (its docs: "there may be other categories that are more
// accurate") — a keyword hit on the merchant name beats that.
export function classifyPlaidTransaction(input: PlaidClassificationInput): PlaidClassificationResult {
  const primary = input.personalFinanceCategoryPrimary
  const detailed = input.personalFinanceCategoryDetailed ?? null
  const hasDetailedMapping = detailed !== null && Object.prototype.hasOwnProperty.call(PFC_DETAILED_TO_EXPENSE_CATEGORY, detailed)
  const pfcCategory = hasDetailedMapping
    ? PFC_DETAILED_TO_EXPENSE_CATEGORY[detailed as string]
    : primary
    ? PFC_TO_EXPENSE_CATEGORY[primary] ?? null
    : null
  const pfcSource: PlaidSuggestionSource = hasDetailedMapping ? "plaid_detailed" : "plaid_primary"
  const isLowConfidence = input.personalFinanceCategoryConfidence === "LOW"

  if (pfcCategory && !isLowConfidence) {
    const isHighConfidence =
      input.personalFinanceCategoryConfidence === "VERY_HIGH" || input.personalFinanceCategoryConfidence === "HIGH"
    return {
      suggestedExpenseAccount: pfcCategory,
      isBusinessGuess: CONFIDENT_BUSINESS_PFC.has(primary as string) ? true : null,
      confidence: isHighConfidence ? 0.7 : 0.6,
      suggestionSource: pfcSource,
    }
  }

  const keywordCategory = suggestExpenseCategoryFromText(input.merchantName ?? input.rawName)
  if (keywordCategory) {
    return {
      suggestedExpenseAccount: keywordCategory,
      isBusinessGuess: null,
      confidence: 0.4,
      suggestionSource: "keyword",
    }
  }

  if (pfcCategory) {
    return {
      suggestedExpenseAccount: pfcCategory,
      isBusinessGuess: null,
      confidence: 0.3,
      suggestionSource: "plaid_low_confidence",
    }
  }

  return {
    suggestedExpenseAccount: null,
    isBusinessGuess: null,
    confidence: 0,
    suggestionSource: null,
  }
}

// A deposited check: "CHECK DEPOSIT", "MOBILE CHECK DEP", "DEPOSIT - CHECK
// #1042", "REMOTE DEPOSIT", "eDeposit". \bcheck\b never matches
// "checking", so transfers from a checking account aren't caught.
const CHECK_DEPOSIT_PATTERN =
  /\b(check|cheque|chk)s?\s*(deposit|dep)\b|\b(deposit|dep)\b[\s\-:#*]*(of\s+)?(check|cheque|chk)\b|\b(mobile|remote)\s*(deposit|dep)\b|\bedeposit\b/

// Best guess at how an incoming bank deposit was paid, for the income
// review's default payment method. A bank only ever sees the payout — a
// Venmo cash-out, a Square/Stripe settlement — so this keys off whichever
// payment app's name appears in the descriptor, falling back to "other".
// Order matters: the first match wins. Cash App comes before the processor
// pattern because its deposits often read "SQ *CASH APP" / "Square Cash";
// a check deposit is matched last so "Venmo … deposit" stays Venmo.
const INCOME_PAYMENT_METHOD_PATTERNS: Array<[RegExp, PaymentMethod]> = [
  [/\bvenmo\b/, "venmo"],
  [/\bzelle\b/, "zelle"],
  [/\bapple\s*(cash|pay)\b/, "apple_cash"],
  [/\bcash\s*app\b|\bsquare\s*cash\b/, "cash_app"],
  [/\b(square|stripe|clover|shopify|toast|paypal)\b|\bsq \*/, "pos"],
  [CHECK_DEPOSIT_PATTERN, "check"],
]

// Checks and Cash App are only suggested to workspaces that turned that
// income source on. Without it a deposit is classified exactly as before
// those sources existed (a check → "other", "SQ *CASH APP" → "pos"), so an
// app version that doesn't know them never receives one. Omitted = both off.
export type OptInIncomeSources = { checks?: boolean; cashApp?: boolean }

export function suggestPlaidIncomePaymentMethod(
  merchantName: string | null,
  rawName: string,
  optIn: OptInIncomeSources = {}
): PaymentMethod {
  const haystack = `${merchantName ?? ""} ${rawName}`.toLowerCase()
  for (const [pattern, method] of INCOME_PAYMENT_METHOD_PATTERNS) {
    if (method === "check" && !optIn.checks) continue
    if (method === "cash_app" && !optIn.cashApp) continue
    if (pattern.test(haystack)) return method
  }
  return "other"
}

// ---------------------------------------------------------------------------
// Transfer detection
//
// Money moving between the user's own accounts — paying the credit card from
// checking, moving money to savings, a loan disbursement — is neither income
// nor an expense. These get recorded but dismissed silently (see
// upsertPendingTransactionFromPlaid in plaidService).
//
// A transfer wrongly flagged hides real income, so this is deliberately
// conservative:
// - Payment-app descriptors (Venmo, Zelle, Cash App, PayPal, Apple Cash) are
//   never treated as transfers, whatever Plaid's category says. Plaid files
//   client payments through those apps under TRANSFER_IN too.
// - "transfer" is only for signals that hold up on their own: money arriving
//   on a credit card or loan account, and Plaid categories that only ever
//   mean own-account movement (credit card payment, savings, investment
//   accounts, loan proceeds).
// - Everything else that looks transfer-ish ("possible_transfer"), or that
//   Plaid didn't categorize at all ("unknown"), only counts once a matching
//   opposite transaction shows up on another linked account. See
//   isPlaidTransferPair.
// ---------------------------------------------------------------------------
export type PlaidTransferSignal = "transfer" | "possible_transfer" | "unknown"

// ---------------------------------------------------------------------------
// Refund detection
//
// Money coming back from a merchant: a return to Home Depot, a fee the bank
// reversed. It isn't income, and it isn't a transfer either. It reduces an
// expense, so it's reviewed on the Expenses tab and booked as a negative
// expense (see confirmRefundTransaction in plaidService).
//
// Plaid keeps the merchant's own spending category on a refund
// (GENERAL_MERCHANDISE, FOOD_AND_DRINK, …), unlike real income (INCOME) or
// money moving between accounts (TRANSFER_*, LOAN_PAYMENTS). Payment-app
// deposits are never refunds: Plaid sometimes guesses a spending category
// for them, and they're usually client money.
// ---------------------------------------------------------------------------
const NON_SPENDING_PRIMARY = new Set(["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"])

export type PlaidRefundInput = {
  merchantName: string | null
  rawName: string
  personalFinanceCategoryPrimary: string | null
  direction: "expense" | "income"
  // Whether a confirmed purchase from the same merchant was found to apply
  // this against — the strongest refund signal, and the only one when
  // Plaid didn't categorize the deposit.
  hasMatchingPurchase: boolean
}

export function isLikelyPlaidRefund(input: PlaidRefundInput): boolean {
  if (input.direction !== "income") return false
  if (isPeerToPeerDescriptor(input.merchantName, input.rawName)) return false
  if (input.hasMatchingPurchase) return true
  const primary = input.personalFinanceCategoryPrimary
  return primary !== null && !NON_SPENDING_PRIMARY.has(primary)
}

// How far back a refund looks for the purchase it reverses — covers typical
// 30–90 day return windows plus statement lag.
export const REFUND_MATCH_MAX_DAYS = 120

type RefundCandidatePurchase = { date: string; amount: number }

// Picks the purchase a refund most likely reverses: same merchant (the
// caller's query), on or before the refund date, within
// REFUND_MATCH_MAX_DAYS, and at least as large (a partial refund can't
// exceed the purchase). An exact amount wins; otherwise the most recent.
export function pickRefundedPurchase<T extends RefundCandidatePurchase>(
  refund: { date: string; amount: number },
  purchases: T[]
): T | null {
  const refundTime = Date.parse(`${refund.date}T12:00:00Z`)
  const eligible = purchases.filter((purchase) => {
    const gapDays = (refundTime - Date.parse(`${purchase.date}T12:00:00Z`)) / 86400000
    return gapDays >= 0 && gapDays <= REFUND_MATCH_MAX_DAYS && purchase.amount + 0.005 >= refund.amount
  })
  const exact = eligible.filter((purchase) => Math.abs(purchase.amount - refund.amount) < 0.005)
  const pool = exact.length > 0 ? exact : eligible
  return pool.reduce<T | null>((best, purchase) => (!best || purchase.date > best.date ? purchase : best), null)
}

export type PlaidTransferInput = {
  merchantName: string | null
  rawName: string
  personalFinanceCategoryPrimary: string | null
  personalFinanceCategoryDetailed: string | null
  direction: "expense" | "income"
  // Plaid account type of the account the transaction is on (depository,
  // credit, loan, investment, …); null when the account isn't known.
  accountType: string | null
  // Refunds are checked first (see isLikelyPlaidRefund) — a refund landing
  // on a credit card must not be swallowed by the card-inflow transfer rule.
  isRefund?: boolean
}

const PEER_TO_PEER_PATTERN = /\b(venmo|zelle|cash\s*app|square\s*cash|paypal|apple\s*cash)\b/

export function isPeerToPeerDescriptor(merchantName: string | null, rawName: string): boolean {
  return PEER_TO_PEER_PATTERN.test(`${merchantName ?? ""} ${rawName}`.toLowerCase())
}

const OWN_ACCOUNT_TRANSFER_DETAILED = new Set([
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "TRANSFER_IN_SAVINGS",
  "TRANSFER_OUT_SAVINGS",
  "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
  "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
  "TRANSFER_IN_CASH_ADVANCES_AND_LOANS",
])

const TRANSFER_LIKE_PRIMARY = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"])

export function classifyPlaidTransferSignal(input: PlaidTransferInput): PlaidTransferSignal | null {
  if (input.isRefund) return null
  if (isPeerToPeerDescriptor(input.merchantName, input.rawName)) return null
  // A credit card or loan balance only goes down from a payment or a
  // refund — neither is income.
  if (input.direction === "income" && (input.accountType === "credit" || input.accountType === "loan")) {
    return "transfer"
  }
  if (input.personalFinanceCategoryDetailed && OWN_ACCOUNT_TRANSFER_DETAILED.has(input.personalFinanceCategoryDetailed)) {
    return "transfer"
  }
  if (input.personalFinanceCategoryPrimary && TRANSFER_LIKE_PRIMARY.has(input.personalFinanceCategoryPrimary)) {
    return "possible_transfer"
  }
  if (!input.personalFinanceCategoryPrimary) return "unknown"
  return null
}

// Money from Venmo only reaches a bank as a cash-out from the user's own
// Venmo balance (client payments land in Venmo, not the bank), so any Venmo
// deposit is one. Whether it's income depends on the workspace: if the
// user imports their Venmo statement, the payments themselves are already
// booked from there and the cash-out is just a transfer.
export function isVenmoCashoutDescriptor(
  merchantName: string | null,
  rawName: string,
  direction: "expense" | "income"
): boolean {
  return direction === "income" && /\bvenmo\b/.test(`${merchantName ?? ""} ${rawName}`.toLowerCase())
}

// Opposite-direction, same-amount transactions on two different linked
// accounts within this many days are treated as the two halves of one
// transfer — ACH between banks commonly takes 1–3 business days.
export const TRANSFER_PAIR_MAX_DAYS = 4

type TransferPairSide = {
  accountId: string
  direction: "expense" | "income"
  amount: number
  date: string
  transferSignal: PlaidTransferSignal | null
}

export function isPlaidTransferPair(a: TransferPairSide, b: TransferPairSide): boolean {
  if (!a.transferSignal || !b.transferSignal) return false
  // Two uncategorized transactions that happen to share an amount are
  // much more likely a coincidence than a transfer.
  if (a.transferSignal === "unknown" && b.transferSignal === "unknown") return false
  if (a.accountId === b.accountId || a.direction === b.direction) return false
  if (Math.abs(a.amount - b.amount) > 0.005) return false
  const gapDays = Math.abs(
    (new Date(`${a.date}T12:00:00Z`).getTime() - new Date(`${b.date}T12:00:00Z`).getTime()) / 86400000
  )
  return gapDays <= TRANSFER_PAIR_MAX_DAYS
}

// A starting name for "Who paid you?" when a deposit is classified as
// "Paid via: Other" — the payer or platform, which is what's worth tracking
// for taxes (it's what you check 1099-NEC / 1099-K forms against). Prefers
// Plaid's enriched merchant name ("DoorDash"); otherwise strips banking noise
// and reference numbers from the raw descriptor ("ACME CORP ACH CREDIT 0412"
// → "Acme Corp"). Null when nothing recognizable is left ("MOBILE DEPOSIT").
const PAYER_NOISE_WORDS = new Set([
  "ach", "credit", "debit", "deposit", "deposits", "payout", "payouts", "payment", "payments", "pmt", "ppd", "ccd",
  "web", "id", "dir", "direct", "dep", "transfer", "xfer", "online", "from", "mobile", "edeposit", "pos", "inst",
  "instant", "orig", "co", "name", "des", "desc", "date", "indn", "trn", "ref", "chk", "sav", "acct", "account", "usa",
])

export function suggestPayerName(merchantName: string | null, rawName: string): string | null {
  const enriched = merchantName?.trim()
  if (enriched && enriched.replace(/[^a-zA-Z]/g, "").length >= 2) return enriched.slice(0, 40)
  const words = rawName
    .replace(/[*#:/\\|_.,]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/\d/.test(word) && !PAYER_NOISE_WORDS.has(word.toLowerCase()))
    .slice(0, 4)
  if (words.length === 0) return null
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
  return name.replace(/[^a-zA-Z]/g, "").length >= 2 ? name.slice(0, 40) : null
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
