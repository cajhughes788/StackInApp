import { db } from "../admin"
import { ConflictError } from "../lib/httpErrors"
import { InvoiceSchema, type InvoicePayment, type InvoiceType } from "@shared/schemas/invoice"
import {
  entryPaymentMethodFor,
  invoiceBalanceDue,
  invoicePaymentBreakdown,
  invoicePaymentCustomIncome,
  invoicePaymentEntryMutationId,
  invoiceWithPayments,
} from "@shared/invoicePayments"
import { expireCheckoutSession, invoicesCol } from "./invoicesService"
import * as entriesSvc from "./entriesService"
import * as expensesSvc from "./expensesService"

// ---------------------------------------------------------------------------
// The invoice payment engine — the one way money is attached to or taken off
// an invoice (docs/invoice-payments-architecture.md). Manual payments, bank
// matches and Stripe payments all go through it.
//
// A payment is applied in three steps:
// 1. claim   — one transaction appends it to invoice.payments (entryId null),
//              so a racing payment can't overpay the invoice;
// 2. book    — its income Entry (and fee Expense), keyed by the payment id,
//              so a retry finds what it already made;
// 3. attach  — the Entry id goes onto the payment.
// If the Entry was never made, a failure releases the claim. Once it
// exists, the claim stays (the money is booked): a retry with the same
// payment id resumes — it finds the Entry by its key and attaches it.
// ---------------------------------------------------------------------------

export const PROCESSING_FEE_EXPENSE_ACCOUNT = "Payment Processing Fees"

export type PaymentInput = Omit<InvoicePayment, "entryId" | "createdAt">

export type PaymentClaimRequest = {
  invoiceId: string
  payment: PaymentInput
  // A Stripe payment that was clearing (invoice.pendingPayment) and has now
  // settled: allowed through, and the pending marker is cleared.
  settlesCheckoutSessionId?: string | null
}

export type ClaimedPayment = {
  invoiceId: string
  // claimed: new. resume: claimed earlier, never booked. done: fully booked.
  outcome: "claimed" | "resume" | "done"
  invoice: InvoiceType
  payment: InvoicePayment
  previousPendingPayment: InvoiceType["pendingPayment"]
}

export type RejectionReason = "missing" | "not_open" | "clearing" | "over_balance"

export class PaymentRejectedError extends ConflictError {
  constructor(
    readonly invoiceId: string,
    readonly reason: RejectionReason,
    message: string
  ) {
    super(message)
    this.name = "PaymentRejectedError"
  }
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

// Step 1, for one or more invoices at once (a deposit can pay several):
// all-or-nothing. A payment id already on the invoice is a retry, not a
// second payment.
export async function claimInvoicePayments(workspaceId: string, requests: PaymentClaimRequest[]): Promise<ClaimedPayment[]> {
  const refs = requests.map((request) => invoicesCol(workspaceId).doc(request.invoiceId))
  const staleSessions: string[] = []
  const claimed = await db.runTransaction(async (txn) => {
    const snaps = await txn.getAll(...refs)
    const nowIso = new Date().toISOString()
    const results: ClaimedPayment[] = []
    const writes: Array<() => void> = []
    snaps.forEach((snap, index) => {
      const request = requests[index]
      if (!snap.exists) throw new PaymentRejectedError(request.invoiceId, "missing", "That invoice no longer exists.")
      const current = InvoiceSchema.parse(snap.data())
      const existing = current.payments.find((payment) => payment.id === request.payment.id)
      if (existing) {
        results.push({
          invoiceId: current.id,
          outcome: existing.entryId ? "done" : "resume",
          invoice: current,
          payment: existing,
          previousPendingPayment: current.pendingPayment,
        })
        return
      }
      if (current.status !== "sent" && current.status !== "draft") {
        throw new PaymentRejectedError(current.id, "not_open", `Invoice #${current.number} is ${current.status === "paid" ? "already paid" : current.status}.`)
      }
      const settlesPending =
        !!current.pendingPayment &&
        !!request.settlesCheckoutSessionId &&
        current.pendingPayment.checkoutSessionId === request.settlesCheckoutSessionId
      if (current.pendingPayment && !settlesPending) {
        throw new PaymentRejectedError(current.id, "clearing", `A bank payment for invoice #${current.number} is still clearing.`)
      }
      if (toCents(request.payment.amount) > toCents(invoiceBalanceDue(current))) {
        throw new PaymentRejectedError(
          current.id,
          "over_balance",
          `That's more than the $${invoiceBalanceDue(current).toFixed(2)} left on invoice #${current.number}.`
        )
      }
      const payment: InvoicePayment = { ...request.payment, entryId: null, createdAt: nowIso }
      // A client's open Checkout was for the old balance.
      if (current.openCheckout) staleSessions.push(current.openCheckout.sessionId)
      const next = InvoiceSchema.parse({
        ...invoiceWithPayments(current, [...current.payments, payment]),
        openCheckout: null,
        pendingPayment: settlesPending ? null : current.pendingPayment,
        paymentFailedAt: null,
        updatedAt: nowIso,
      })
      writes.push(() => txn.set(refs[index], next))
      results.push({ invoiceId: current.id, outcome: "claimed", invoice: next, payment, previousPendingPayment: current.pendingPayment })
    })
    for (const write of writes) write()
    return results
  })
  for (const sessionId of staleSessions) await expireCheckoutSession(workspaceId, sessionId)
  return claimed
}

// Step 2: the payment's income Entry. Its tip goes on "tips"; "Other" money
// (a bank transfer) is named after the client. Checks have their own source.
export async function bookPaymentEntry(
  workspaceId: string,
  uid: string,
  invoice: InvoiceType,
  payment: InvoicePayment,
  notes: Array<string | null>
): Promise<string> {
  const method = entryPaymentMethodFor(payment.method)
  const created = await entriesSvc.createEntry(workspaceId, uid, {
    workspace: "independent",
    date: payment.receivedOn,
    notes: [`Invoice #${invoice.number}`, invoice.clientName, purposeNote(payment), ...notes].filter(Boolean).join(" | "),
    clientMutationId: invoicePaymentEntryMutationId(invoice.id, payment.id),
    independent: {
      hours: 0,
      incomeBreakdowns: [invoicePaymentBreakdown(invoice.lines, payment.amount, payment.tipAmount, method)],
      unreportedCash: 0,
      unreportedCashTips: 0,
      customIncome:
        method === "other" ? invoicePaymentCustomIncome(invoice.lines, payment.amount, payment.tipAmount, invoice.clientName) : [],
    },
  })
  return created.id
}

function purposeNote(payment: InvoicePayment): string | null {
  switch (payment.purpose) {
    case "deposit":
      return "Deposit"
    case "balance":
      return "Balance"
    case "partial":
      return "Partial payment"
    case "full":
      return null
  }
}

// Step 3.
export async function attachPaymentEntry(workspaceId: string, invoiceId: string, paymentId: string, entryId: string): Promise<InvoiceType> {
  const ref = invoicesCol(workspaceId).doc(invoiceId)
  return db.runTransaction(async (txn) => {
    const current = InvoiceSchema.parse((await txn.get(ref)).data())
    const payments = current.payments.map((payment) => (payment.id === paymentId ? { ...payment, entryId } : payment))
    const next = InvoiceSchema.parse({ ...invoiceWithPayments(current, payments), updatedAt: new Date().toISOString() })
    txn.set(ref, next)
    return next
  })
}

// Undoes step 1 after a failed booking: takes the payment off again, but
// only while nothing was booked for it, and puts back a clearing payment it
// had settled.
export async function releasePaymentClaims(workspaceId: string, claims: ClaimedPayment[]): Promise<void> {
  const toRelease = claims.filter((claim) => claim.outcome !== "done")
  if (toRelease.length === 0) return
  await db
    .runTransaction(async (txn) => {
      const refs = toRelease.map((claim) => invoicesCol(workspaceId).doc(claim.invoiceId))
      const snaps = await txn.getAll(...refs)
      snaps.forEach((snap, index) => {
        if (!snap.exists) return
        const current = InvoiceSchema.parse(snap.data())
        const claim = toRelease[index]
        const held = current.payments.find((payment) => payment.id === claim.payment.id)
        if (!held || held.entryId) return
        const next = InvoiceSchema.parse({
          ...invoiceWithPayments(
            current,
            current.payments.filter((payment) => payment.id !== claim.payment.id)
          ),
          pendingPayment: current.pendingPayment ?? claim.previousPendingPayment,
          updatedAt: new Date().toISOString(),
        })
        txn.set(refs[index], next)
      })
    })
    .catch((error) => console.error("invoicePaymentEngine.releasePaymentClaims: failed to release", error))
}

export type FeeExpense = { vendor: string; description: string }

// Claim, book and attach one payment. Its fee (payment.feeAmount) is booked
// as a Payment Processing Fees expense when `fee` is given. Returns the
// invoice as saved and the Entry id.
export async function applyInvoicePayment(
  workspaceId: string,
  uid: string,
  request: PaymentClaimRequest,
  options: { notes?: Array<string | null>; fee?: FeeExpense | null } = {}
): Promise<{ invoice: InvoiceType; payment: InvoicePayment; entryId: string }> {
  const [claim] = await claimInvoicePayments(workspaceId, [request])
  if (claim.outcome === "done") return { invoice: claim.invoice, payment: claim.payment, entryId: claim.payment.entryId! }
  let entryId: string | null = null
  try {
    entryId = await bookPaymentEntry(workspaceId, uid, claim.invoice, claim.payment, options.notes ?? [])
    if (options.fee && claim.payment.feeAmount > 0) {
      await expensesSvc.createExpense(workspaceId, uid, {
        date: claim.payment.receivedOn,
        amount: claim.payment.feeAmount,
        vendor: options.fee.vendor,
        description: options.fee.description,
        account: PROCESSING_FEE_EXPENSE_ACCOUNT,
        clientMutationId: `${claim.payment.id}_fee`,
      })
    }
    const invoice = await attachPaymentEntry(workspaceId, claim.invoiceId, claim.payment.id, entryId)
    return { invoice, payment: { ...claim.payment, entryId }, entryId }
  } catch (error) {
    if (!entryId) await releasePaymentClaims(workspaceId, [claim])
    throw error
  }
}

// Takes payments off an invoice — after their Entries were deleted. The
// status follows the money (a paid invoice reopens).
export async function removeInvoicePayments(workspaceId: string, invoiceId: string, paymentIds: string[]): Promise<InvoiceType | null> {
  const ref = invoicesCol(workspaceId).doc(invoiceId)
  const remove = new Set(paymentIds)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return null
    const current = InvoiceSchema.parse(snap.data())
    if (!current.payments.some((payment) => remove.has(payment.id))) return current
    const next = InvoiceSchema.parse({
      ...invoiceWithPayments(
        current,
        current.payments.filter((payment) => !remove.has(payment.id))
      ),
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return next
  })
}

// The invoices (and their payments) an Entry was booked for.
export async function invoicesForPaymentEntry(
  workspaceId: string,
  entryId: string
): Promise<Array<{ invoice: InvoiceType; payment: InvoicePayment }>> {
  const snap = await invoicesCol(workspaceId).where("paymentEntryIds", "array-contains", entryId).get()
  return snap.docs.flatMap((doc) => {
    const parsed = InvoiceSchema.safeParse(doc.data())
    if (!parsed.success) return []
    const payment = parsed.data.payments.find((p) => p.entryId === entryId)
    return payment ? [{ invoice: parsed.data, payment }] : []
  })
}
