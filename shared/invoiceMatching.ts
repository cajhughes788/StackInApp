import { isPeerToPeerDescriptor, suggestPlaidIncomePaymentMethod } from "./plaidClassification"
import { invoicePaymentOptions } from "./invoicePayments"
import type { InvoicePaymentPurpose, InvoiceType } from "./schemas/invoice"
import type { PlaidInvoiceMatch, PlaidInvoiceRef } from "./schemas/plaidPendingTransaction"

// ---------------------------------------------------------------------------
// Invoice matching
//
// Finds the invoice(s) an incoming bank deposit pays, so the income review
// can offer "Acme paid Invoice #0012" instead of booking the deposit as new
// income on top of the invoice.
//
// Each open invoice offers targets — the amounts it can be paid in
// (invoicePaymentOptions): its deposit or everything while a deposit is
// owed, otherwise what's left. A group never uses two targets of one
// invoice. Tiers, first hit wins:
//
// 1. exact        — one target equals the deposit.
// 2. combined     — 2–3 targets sum exactly to it (checks deposited together).
// 3. net_of_fees  — payment-processor deposits only: 1–3 targets whose total
//                   is above the deposit by no more than a processor's fee.
//                   A plain deposit that comes up short is more likely a short
//                   payment than a fee, so it's left to the normal review.
// 4. with_tip     — when asked for (open invoices): one invoice's final
//                   payment (its balance or the whole thing) plus a tip, the
//                   deposit above it by no more than half again. Not for
//                   processor deposits, where extra money is ambiguous.
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

// The most a tip can be, as a share of the payment it's on.
export const INVOICE_TIP_MAX_RATE = 0.5

// How far a deposit can sit from the day an invoice was marked paid by hand
// and still be that same money arriving at the bank.
export const MANUAL_PAID_LOOKBACK_DAYS = 14
export const MANUAL_PAID_LOOKAHEAD_DAYS = 3

const MAX_ALTERNATIVES = 4

// One amount an invoice could be paid in. `total` is that amount (the
// invoice's whole total for a plain unpaid invoice), `purpose` what it pays.
export type InvoiceMatchCandidate = Pick<
  InvoiceType,
  "id" | "number" | "clientName" | "total" | "issueDate" | "dueDate"
> & { purpose?: InvoicePaymentPurpose }

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
  T extends InvoiceMatchCandidate & Pick<InvoiceType, "status"> & Partial<Pick<InvoiceType, "pendingPayment">>,
>(invoices: T[], depositDate: string): T[] {
  return invoices
    .filter(
      (invoice) =>
        invoice.status === "sent" &&
        // A bank transfer through Stripe is already clearing for it.
        !invoice.pendingPayment &&
        dayDiff(depositDate, invoice.issueDate) >= 0 &&
        dayDiff(depositDate, invoice.dueDate) <= INVOICE_MATCH_MAX_DAYS_PAST_DUE
    )
    .sort(byOldestDue)
    .slice(0, INVOICE_MATCH_MAX_CANDIDATES)
}

// The targets of the open invoices a deposit could be paying.
export function openInvoiceTargets(
  invoices: Array<InvoiceType>,
  depositDate: string
): InvoiceMatchCandidate[] {
  return selectOpenInvoiceCandidates(invoices, depositDate).flatMap((invoice) =>
    invoicePaymentOptions(invoice).map((option) => ({
      id: invoice.id,
      number: invoice.number,
      clientName: invoice.clientName,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: option.amount,
      purpose: option.purpose,
    }))
  )
}

function isRecentManualPayment(payment: InvoiceType["payments"][number], depositDate: string): boolean {
  if (payment.via !== "manual") return false
  const gap = dayDiff(depositDate, payment.receivedOn)
  return gap >= -MANUAL_PAID_LOOKAHEAD_DAYS && gap <= MANUAL_PAID_LOOKBACK_DAYS
}

// Invoices with a payment recorded by hand whose money might be this
// deposit — a match means the deposit is already counted and should be
// dismissed, not booked.
export function selectManuallyPaidInvoiceCandidates<
  T extends InvoiceMatchCandidate & Pick<InvoiceType, "status" | "payments">,
>(invoices: T[], depositDate: string): T[] {
  return invoices
    .filter((invoice) => invoice.status !== "void" && invoice.payments.some((p) => isRecentManualPayment(p, depositDate)))
    .sort(byOldestDue)
    .slice(0, INVOICE_MATCH_MAX_CANDIDATES)
}

// Each recent hand-recorded payment as a target of what arrived (its tip
// included): one invoice's deposit and balance can each be the money.
export function manualPaymentTargets(invoices: Array<InvoiceType>, depositDate: string): InvoiceMatchCandidate[] {
  return selectManuallyPaidInvoiceCandidates(invoices, depositDate).flatMap((invoice) =>
    invoice.payments
      .filter((payment) => isRecentManualPayment(payment, depositDate))
      .map((payment) => ({
        id: invoice.id,
        number: invoice.number,
        clientName: invoice.clientName,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: (toCents(payment.amount) + toCents(payment.tipAmount)) / 100,
        purpose: payment.purpose,
      }))
  )
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

// Groups of `size` targets, never two of the same invoice.
function* groupsOfSize<T extends { id: string }>(items: T[], size: number, start = 0): Generator<T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = start; i <= items.length - size; i++) {
    for (const rest of groupsOfSize(items, size - 1, i + 1)) {
      if (rest.some((item) => item.id === items[i].id)) continue
      yield [items[i], ...rest]
    }
  }
}

type ScoredGroup = {
  invoices: InvoiceMatchCandidate[]
  totalCents: number
  feeCents: number
  tipCents: number
  payerMatches: number
}

function compareGroups(a: ScoredGroup, b: ScoredGroup): number {
  return (
    b.payerMatches - a.payerMatches ||
    a.feeCents - b.feeCents ||
    a.tipCents - b.tipCents ||
    a.invoices.length - b.invoices.length
  )
}

function compareGroupsByDue(a: ScoredGroup, b: ScoredGroup): number {
  for (let i = 0; i < Math.min(a.invoices.length, b.invoices.length); i++) {
    const order = byOldestDue(a.invoices[i], b.invoices[i])
    if (order !== 0) return order
  }
  return a.invoices.length - b.invoices.length
}

function toRef(target: InvoiceMatchCandidate, tipCents = 0): PlaidInvoiceRef {
  return {
    invoiceId: target.id,
    number: target.number,
    clientName: target.clientName,
    amount: target.total,
    purpose: target.purpose ?? "full",
    tipAmount: tipCents / 100,
  }
}

// `candidates` should come from openInvoiceTargets (or manualPaymentTargets
// for the already-paid check). `tips` allows the with_tip tier.
export function pickPaidInvoices(
  deposit: InvoiceMatchDeposit,
  candidates: InvoiceMatchCandidate[],
  options: { tips?: boolean } = {}
): PlaidInvoiceMatch | null {
  const depositCents = toCents(deposit.amount)
  if (depositCents <= 0 || candidates.length === 0) return null

  // Every target of the oldest-due invoices (an invoice can offer two).
  const invoiceIds = [...new Set([...candidates].sort(byOldestDue).map((target) => target.id))].slice(
    0,
    INVOICE_MATCH_MAX_CANDIDATES
  )
  const pool = [...candidates].filter((target) => invoiceIds.includes(target.id)).sort(byOldestDue)
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
          tipCents: 0,
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
      invoices: best.invoices.map((target) => toRef(target)),
      invoiceTotal: best.totalCents / 100,
      feeAmount: best.feeCents / 100,
      alternatives: tied.slice(1, 1 + MAX_ALTERNATIVES).map((group) => ({ invoices: group.invoices.map((target) => toRef(target)) })),
      alreadyPaid: false,
    }
  }

  // with_tip: one invoice's final payment and a tip on top.
  if (options.tips && !isProcessor) {
    const fits: ScoredGroup[] = pool
      .filter((target) => target.purpose === "balance" || target.purpose === "full" || target.purpose === undefined)
      .flatMap((target) => {
        const totalCents = toCents(target.total)
        const tipCents = depositCents - totalCents
        if (tipCents <= 0 || tipCents > Math.floor(totalCents * INVOICE_TIP_MAX_RATE)) return []
        return [{
          invoices: [target],
          totalCents,
          feeCents: 0,
          tipCents,
          payerMatches: clientMatchesPayer(target.clientName, deposit.payerLabel) ? 1 : 0,
        }]
      })
    if (fits.length > 0) {
      fits.sort((a, b) => compareGroups(a, b) || compareGroupsByDue(a, b))
      const [best] = fits
      const tied = fits.filter((group) => compareGroups(group, best) === 0)
      return {
        kind: "with_tip",
        invoices: [toRef(best.invoices[0], best.tipCents)],
        invoiceTotal: depositCents / 100,
        feeAmount: 0,
        alternatives: tied.slice(1, 1 + MAX_ALTERNATIVES).map((group) => ({ invoices: [toRef(group.invoices[0], group.tipCents)] })),
        alreadyPaid: false,
      }
    }
  }

  return null
}

// The group the user picked on the review card: the suggested invoices or
// one of the alternatives, given as the same set of ids in any order.
// Null when the ids don't match any offered group.
export function resolveChosenInvoiceGroup(match: PlaidInvoiceMatch, invoiceIds: string[]): PlaidInvoiceRef[] | null {
  const wanted = [...invoiceIds].sort().join("|")
  for (const group of [match.invoices, ...match.alternatives.map((alternative) => alternative.invoices)]) {
    if (group.map((ref) => ref.invoiceId).sort().join("|") === wanted) return group
  }
  return null
}

// The processing fee for a chosen group: its total minus the deposit. A
// group picked from the alternatives can have a different total than the
// suggested one, so this is worked out per group rather than read off
// match.feeAmount. Null when the group can't explain the deposit.
export function invoiceGroupFee(match: PlaidInvoiceMatch, group: PlaidInvoiceRef[], depositAmount: number): number | null {
  const feeCents = group.reduce((sum, ref) => sum + toCents(ref.amount) + toCents(ref.tipAmount), 0) - toCents(depositAmount)
  if (feeCents < 0) return null
  if (feeCents > 0 && match.kind !== "net_of_fees") return null
  return feeCents / 100
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

// ---------------------------------------------------------------------------
// Refunds the user sent a client themselves (Zelle, Venmo, a check) and
// recorded on the invoice. The refund Entry already takes the money out of
// income, so the outgoing bank payment that is that refund must not also be
// booked as an expense. A payment matches when:
//   • it's the exact amount of a recorded refund not already matched,
//   • it left within a few days of the refund's date, either side, and
//   • it looks like money sent to a person — it names the client, or it's a
//     peer-to-peer app, a check or a transfer — never a card purchase that
//     happens to cost the same.
// Closest date wins. Matches are hidden in Hidden transfers, where a wrong
// one can be restored.
// ---------------------------------------------------------------------------

export const REFUND_PAYMENT_LOOKBACK_DAYS = 3
export const REFUND_PAYMENT_LOOKAHEAD_DAYS = 10

export type RefundPaymentCandidate = {
  invoiceId: string
  invoiceNumber: string
  clientName: string
  refundId: string
  amount: number
  date: string
}

export type RefundMatchPayment = {
  date: string
  amount: number
  merchantName: string | null
  rawName: string
  personalFinanceCategoryPrimary: string | null
}

// Refunds recorded by hand on these invoices that no payment holds yet
// (or that `plaidTransactionId` itself already holds — a re-sync).
export function selectUnmatchedManualRefunds(
  invoices: Array<Pick<InvoiceType, "id" | "number" | "clientName" | "refunds">>,
  plaidTransactionId?: string
): RefundPaymentCandidate[] {
  return invoices.flatMap((invoice) =>
    (invoice.refunds ?? [])
      .filter(
        (refund) =>
          !refund.stripeRefundId &&
          !!refund.entryId &&
          (!refund.plaidTransactionId || refund.plaidTransactionId === plaidTransactionId)
      )
      .map((refund) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        clientName: invoice.clientName,
        refundId: refund.id,
        amount: refund.amount,
        date: refund.date,
      }))
  )
}

function looksLikeMoneySentToPerson(payment: RefundMatchPayment, clientName: string): boolean {
  const descriptor = normalizeName(`${payment.merchantName ?? ""} ${payment.rawName}`)
  const client = normalizeName(clientName)
  if (client.length >= 3 && ` ${descriptor} `.includes(` ${client} `)) return true
  if (isPeerToPeerDescriptor(payment.merchantName, payment.rawName)) return true
  if (/\b(check|chk|zelle|wire|transfer|xfer|ach)\b/.test(descriptor)) return true
  return payment.personalFinanceCategoryPrimary === "TRANSFER_OUT"
}

export function matchInvoiceRefundPayment(
  payment: RefundMatchPayment,
  refunds: RefundPaymentCandidate[]
): RefundPaymentCandidate | null {
  const cents = toCents(payment.amount)
  if (cents <= 0) return null
  let best: RefundPaymentCandidate | null = null
  for (const refund of refunds) {
    if (toCents(refund.amount) !== cents) continue
    // Positive: the payment left after the refund was recorded.
    const gap = dayDiff(payment.date, refund.date)
    if (gap < -REFUND_PAYMENT_LOOKBACK_DAYS || gap > REFUND_PAYMENT_LOOKAHEAD_DAYS) continue
    if (!looksLikeMoneySentToPerson(payment, refund.clientName)) continue
    if (!best || Math.abs(gap) < Math.abs(dayDiff(payment.date, best.date))) best = refund
  }
  return best
}
