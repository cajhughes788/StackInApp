import { suggestPlaidIncomePaymentMethod } from "./plaidClassification"
import type { IncomeBreakdown, IncomeCategory, PaymentMethod } from "./schemas/entry"
import type { InvoiceLine, InvoiceType } from "./schemas/invoice"
import type { PlaidInvoiceMatch, PlaidInvoiceRef } from "./schemas/plaidPendingTransaction"

// ---------------------------------------------------------------------------
// Invoice matching
//
// Finds the invoice(s) an incoming bank deposit pays, so the income review
// can offer "Acme paid Invoice #0012" instead of booking the deposit as new
// income on top of the invoice. Tiers, first hit wins:
//
// 1. exact        — one invoice equals the deposit.
// 2. combined     — 2–3 invoices sum exactly to it (checks deposited together).
// 3. net_of_fees  — payment-processor deposits only: 1–3 invoices whose total
//                   is above the deposit by no more than a processor's fee.
//                   A plain deposit that comes up short is more likely a short
//                   payment than a fee, so it's left to the normal review.
//
// Within a tier, groups whose client matches the payer's remembered name win,
// then the smallest fee, then fewer invoices. Groups still tied on those are
// a real coin flip, so the match comes back with `alternatives` and the user
// picks — oldest-due only decides which one is listed first.
//
// All amounts are compared in integer cents.
// ---------------------------------------------------------------------------

// Days after the due date a deposit can still pay an invoice.
export const INVOICE_MATCH_MAX_DAYS_PAST_DUE = 90

// Only the oldest-due open invoices are considered, which bounds the group
// search (15 choose ≤3 = 575 groups).
export const INVOICE_MATCH_MAX_CANDIDATES = 15

export const INVOICE_MATCH_MAX_GROUP_SIZE = 3

// Covers Stripe (2.9% + 30¢), Square (2.6–3.5% + 15¢), PayPal (~3.5% + 49¢)
// and instant-payout fees on top.
export const INVOICE_FEE_MAX_RATE = 0.05
export const INVOICE_FEE_MAX_FLAT_CENTS = 100

// How far a deposit can sit from the day an invoice was marked paid by hand
// and still be that same money arriving at the bank.
export const MANUAL_PAID_LOOKBACK_DAYS = 14
export const MANUAL_PAID_LOOKAHEAD_DAYS = 3

const MAX_ALTERNATIVES = 4

export type InvoiceMatchCandidate = Pick<
  InvoiceType,
  "id" | "number" | "clientName" | "total" | "issueDate" | "dueDate"
>

export type InvoiceMatchDeposit = {
  date: string
  amount: number
  merchantName: string | null
  rawName: string
  // The payer's remembered "Who paid you?" name (plaidIncomeMemory.incomeLabel).
  payerLabel: string | null
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

function dayDiff(later: string, earlier: string): number {
  return (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / 86400000
}

function byOldestDue(a: InvoiceMatchCandidate, b: InvoiceMatchCandidate): number {
  return a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number)
}

// Open invoices a deposit on `depositDate` could be paying.
export function selectOpenInvoiceCandidates<
  T extends InvoiceMatchCandidate & Pick<InvoiceType, "status"> & Partial<Pick<InvoiceType, "pendingPaymentAt">>,
>(invoices: T[], depositDate: string): T[] {
  return invoices
    .filter(
      (invoice) =>
        invoice.status === "sent" &&
        // A bank transfer through Stripe is already clearing for it.
        !invoice.pendingPaymentAt &&
        dayDiff(depositDate, invoice.issueDate) >= 0 &&
        dayDiff(depositDate, invoice.dueDate) <= INVOICE_MATCH_MAX_DAYS_PAST_DUE
    )
    .sort(byOldestDue)
    .slice(0, INVOICE_MATCH_MAX_CANDIDATES)
}

// Invoices marked paid by hand whose money might be this deposit — a match
// means the deposit is already counted and should be dismissed, not booked.
export function selectManuallyPaidInvoiceCandidates<
  T extends InvoiceMatchCandidate & Pick<InvoiceType, "status" | "paidVia" | "paidAt">,
>(invoices: T[], depositDate: string): T[] {
  return invoices
    .filter((invoice) => {
      if (invoice.status !== "paid" || invoice.paidVia !== "manual" || !invoice.paidAt) return false
      const gap = dayDiff(depositDate, invoice.paidAt.slice(0, 10))
      return gap >= -MANUAL_PAID_LOOKAHEAD_DAYS && gap <= MANUAL_PAID_LOOKBACK_DAYS
    })
    .sort(byOldestDue)
    .slice(0, INVOICE_MATCH_MAX_CANDIDATES)
}

export function isPaymentProcessorDeposit(merchantName: string | null, rawName: string): boolean {
  return suggestPlaidIncomePaymentMethod(merchantName, rawName) === "pos"
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// "Acme" matches "Acme Corp" and vice versa; very short names never match on
// containment alone.
function clientMatchesPayer(clientName: string, payerLabel: string | null): boolean {
  if (!payerLabel) return false
  const client = normalizeName(clientName)
  const payer = normalizeName(payerLabel)
  if (!client || !payer) return false
  if (client === payer) return true
  const shorter = client.length <= payer.length ? client : payer
  const longer = shorter === client ? payer : client
  return shorter.length >= 3 && ` ${longer} `.includes(` ${shorter} `)
}

function* groupsOfSize<T>(items: T[], size: number, start = 0): Generator<T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = start; i <= items.length - size; i++) {
    for (const rest of groupsOfSize(items, size - 1, i + 1)) yield [items[i], ...rest]
  }
}

type ScoredGroup = {
  invoices: InvoiceMatchCandidate[]
  totalCents: number
  feeCents: number
  payerMatches: number
}

function compareGroups(a: ScoredGroup, b: ScoredGroup): number {
  return b.payerMatches - a.payerMatches || a.feeCents - b.feeCents || a.invoices.length - b.invoices.length
}

function compareGroupsByDue(a: ScoredGroup, b: ScoredGroup): number {
  for (let i = 0; i < Math.min(a.invoices.length, b.invoices.length); i++) {
    const order = byOldestDue(a.invoices[i], b.invoices[i])
    if (order !== 0) return order
  }
  return a.invoices.length - b.invoices.length
}

function toRef(invoice: InvoiceMatchCandidate): PlaidInvoiceRef {
  return { invoiceId: invoice.id, number: invoice.number, clientName: invoice.clientName, amount: invoice.total }
}

// `candidates` should come from selectOpenInvoiceCandidates (or
// selectManuallyPaidInvoiceCandidates for the already-paid check).
export function pickPaidInvoices(
  deposit: InvoiceMatchDeposit,
  candidates: InvoiceMatchCandidate[]
): PlaidInvoiceMatch | null {
  const depositCents = toCents(deposit.amount)
  if (depositCents <= 0 || candidates.length === 0) return null

  const pool = [...candidates].sort(byOldestDue).slice(0, INVOICE_MATCH_MAX_CANDIDATES)
  const isProcessor = isPaymentProcessorDeposit(deposit.merchantName, deposit.rawName)

  const tiers: Array<{ kind: PlaidInvoiceMatch["kind"]; sizes: number[]; netOfFees: boolean }> = [
    { kind: "exact", sizes: [1], netOfFees: false },
    { kind: "combined", sizes: [2, 3], netOfFees: false },
    ...(isProcessor ? [{ kind: "net_of_fees" as const, sizes: [1, 2, 3], netOfFees: true }] : []),
  ]

  for (const tier of tiers) {
    const fits: ScoredGroup[] = []
    for (const size of tier.sizes) {
      if (size > INVOICE_MATCH_MAX_GROUP_SIZE) continue
      for (const group of groupsOfSize(pool, size)) {
        const totalCents = group.reduce((sum, invoice) => sum + toCents(invoice.total), 0)
        const feeCents = totalCents - depositCents
        if (tier.netOfFees) {
          const maxFeeCents = Math.round(totalCents * INVOICE_FEE_MAX_RATE) + INVOICE_FEE_MAX_FLAT_CENTS
          if (feeCents <= 0 || feeCents > maxFeeCents) continue
        } else if (feeCents !== 0) {
          continue
        }
        fits.push({
          invoices: group,
          totalCents,
          feeCents,
          payerMatches: group.filter((invoice) => clientMatchesPayer(invoice.clientName, deposit.payerLabel)).length,
        })
      }
    }
    if (fits.length === 0) continue

    fits.sort((a, b) => compareGroups(a, b) || compareGroupsByDue(a, b))
    const [best] = fits
    const tied = fits.filter((group) => compareGroups(group, best) === 0)

    return {
      kind: tier.kind,
      invoices: best.invoices.map(toRef),
      invoiceTotal: best.totalCents / 100,
      feeAmount: best.feeCents / 100,
      alternatives: tied.slice(1, 1 + MAX_ALTERNATIVES).map((group) => group.invoices.map(toRef)),
      alreadyPaid: false,
    }
  }

  return null
}

// The group the user picked on the review card: the suggested invoices or
// one of the alternatives, given as the same set of ids in any order.
// Null when the ids don't match any offered group.
export function resolveChosenInvoiceGroup(match: PlaidInvoiceMatch, invoiceIds: string[]): PlaidInvoiceRef[] | null {
  const wanted = [...invoiceIds].sort().join("|")
  for (const group of [match.invoices, ...match.alternatives]) {
    if (group.map((ref) => ref.invoiceId).sort().join("|") === wanted) return group
  }
  return null
}

// The processing fee for a chosen group: its total minus the deposit. A
// group picked from the alternatives can have a different total than the
// suggested one, so this is worked out per group rather than read off
// match.feeAmount. Null when the group can't explain the deposit.
export function invoiceGroupFee(match: PlaidInvoiceMatch, group: PlaidInvoiceRef[], depositAmount: number): number | null {
  const feeCents = group.reduce((sum, ref) => sum + toCents(ref.amount), 0) - toCents(depositAmount)
  if (feeCents < 0) return null
  if (feeCents > 0 && match.kind !== "net_of_fees") return null
  return feeCents / 100
}

// An invoice's lines as one Entry income breakdown, summed per category.
export function invoiceIncomeBreakdown(lines: InvoiceLine[], paymentMethod: PaymentMethod): IncomeBreakdown {
  const breakdown: IncomeBreakdown = { paymentMethod }
  for (const [category, cents] of invoiceCentsByCategory(lines)) breakdown[category] = cents / 100
  return breakdown
}

export function invoiceCentsByCategory(lines: InvoiceLine[]): Map<IncomeCategory, number> {
  const byCategory = new Map<IncomeCategory, number>()
  for (const line of lines) byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + toCents(line.amount))
  return byCategory
}

// Splits a payout's fee across the invoices it paid, in proportion to each
// invoice's amount, with leftover cents on the last one so the parts add up
// to the fee exactly.
export function allocateInvoiceFee(group: Array<{ amount: number }>, feeAmount: number): number[] {
  const feeCents = toCents(feeAmount)
  const totalCents = group.reduce((sum, ref) => sum + toCents(ref.amount), 0)
  if (feeCents <= 0 || totalCents <= 0) return group.map(() => 0)
  let allocated = 0
  return group.map((ref, index) => {
    const share =
      index === group.length - 1 ? feeCents - allocated : Math.floor((feeCents * toCents(ref.amount)) / totalCents)
    allocated += share
    return share / 100
  })
}
