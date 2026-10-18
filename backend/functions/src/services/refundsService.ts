import type Stripe from "stripe"
import { DateTime } from "luxon"
import { db } from "../admin"
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/httpErrors"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import type { IncomeCategory, PaymentMethod, RefundInfo } from "@shared/schemas/entry"
import {
  InvoiceSchema,
  invoiceRefundableAmount,
  type InvoiceDispute,
  type InvoicePaidMethod,
  type InvoiceRefund,
  type InvoiceType,
} from "@shared/schemas/invoice"
import { invoiceCentsByCategory } from "@shared/invoiceMatching"
import { invoicesCol } from "./invoicesService"
import { getStripe, readPaymentAccount } from "./paymentAccountsService"
import * as entriesSvc from "./entriesService"
import * as expensesSvc from "./expensesService"

// ---------------------------------------------------------------------------
// Refunds and disputes — Stripe Connect phase 4.
//
// Money going back is its own Entry (kind "refund", negative amounts) dated
// the day it went back; the original payment's Entry is never touched, so a
// closed month stays closed and every income total nets the refund out
// (shared/schemas/entry.ts). Each booking uses a deterministic client
// mutation id, so a webhook retry, a dashboard refund echoed back as an
// event, or a double tap books once.
// ---------------------------------------------------------------------------

const DEFAULT_TIME_ZONE = "America/Los_Angeles"
const PROCESSING_FEE_EXPENSE_ACCOUNT = "Payment Processing Fees"

type ManualRefundReason = InvoiceRefund["reason"]

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

async function workspaceOwner(workspaceId: string): Promise<string> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  const ownerUid = snap.data()?.ownerId as string | undefined
  if (!ownerUid) throw new Error(`Workspace ${workspaceId} has no owner`)
  return ownerUid
}

async function localDate(workspaceId: string, seconds: number): Promise<string> {
  const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  const zone = (snap.get("common.timeZone") as string | undefined) || DEFAULT_TIME_ZONE
  return DateTime.fromSeconds(seconds).setZone(zone).toISODate() ?? new Date(seconds * 1000).toISOString().slice(0, 10)
}

// The Entry payment method the invoice's payment was booked under, so the
// refund comes out of the same stream (Card / POS, Zelle, a named payer…).
function entryMethodFor(invoice: InvoiceType): PaymentMethod {
  const method: InvoicePaidMethod | null = invoice.paidMethod
  if (!method) return invoice.paidVia === "online" ? "pos" : "other"
  if (method === "check") return "other"
  if (method === "card") return "pos"
  return method
}

// Spreads a refund across the invoice's categories in proportion, largest
// remainder last, so the parts add up to the cent.
function refundCentsByCategory(invoice: InvoiceType, refundCents: number): Array<[IncomeCategory, number]> {
  const byCategory = [...invoiceCentsByCategory(invoice.lines)].filter(([, cents]) => cents > 0)
  const totalCents = byCategory.reduce((sum, [, cents]) => sum + cents, 0)
  if (totalCents <= 0) return [["services", refundCents]]
  let allocated = 0
  return byCategory.map(([category, cents], index) => {
    const share = index === byCategory.length - 1 ? refundCents - allocated : Math.floor((refundCents * cents) / totalCents)
    allocated += share
    return [category, share]
  })
}

// One refund (or dispute) Entry against an invoice: negative amounts, or
// positive for a reversed dispute. "Other" money gets matching named custom
// income so the client's own stream nets out too.
async function bookRefundEntry(params: {
  workspaceId: string
  invoice: InvoiceType
  cents: number
  date: string
  clientMutationId: string
  info: Omit<RefundInfo, "invoiceId" | "invoiceNumber" | "clientName">
}): Promise<string> {
  const { workspaceId, invoice, cents, date, clientMutationId, info } = params
  const sign = info.reason === "dispute_reversed" ? 1 : -1
  const method = entryMethodFor(invoice)
  const parts = refundCentsByCategory(invoice, cents)
  const breakdown: Record<string, unknown> = { paymentMethod: method }
  for (const [category, partCents] of parts) breakdown[category] = (sign * partCents) / 100
  const label =
    info.reason === "dispute"
      ? "Disputed"
      : info.reason === "dispute_reversed"
        ? "Dispute won"
        : "Refund"
  const entry = await entriesSvc.createEntry(
    workspaceId,
    await workspaceOwner(workspaceId),
    {
      workspace: "independent",
      date,
      notes: [label, `Invoice #${invoice.number}`, invoice.clientName].join(" | "),
      clientMutationId,
      independent: {
        hours: 0,
        incomeBreakdowns: [breakdown],
        unreportedCash: 0,
        unreportedCashTips: 0,
        customIncome:
          method === "other"
            ? parts.map(([category, partCents]) => ({ label: invoice.clientName, amount: (sign * partCents) / 100, category }))
            : [],
      },
    },
    undefined,
    {
      refund: {
        ...info,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        clientName: invoice.clientName,
      },
    }
  )
  return entry.id
}

// Books a refund on an invoice once: the Entry (idempotent by its mutation
// id), then the invoice's refunds list (skipped if the key is already there).
async function recordInvoiceRefund(
  workspaceId: string,
  invoiceId: string,
  refund: { key: string; cents: number; date: string; reason: ManualRefundReason; stripeRefundId: string | null }
): Promise<InvoiceType> {
  const ref = invoicesCol(workspaceId).doc(invoiceId)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("Invoice not found")
  const invoice = InvoiceSchema.parse(snap.data())
  const existing = invoice.refunds.find((r) => r.id === refund.key)
  if (existing?.entryId) return invoice

  const entryId = await bookRefundEntry({
    workspaceId,
    invoice,
    cents: refund.cents,
    date: refund.date,
    clientMutationId: `refund_${refund.key}`,
    info: { reason: refund.reason, stripeRefundId: refund.stripeRefundId, stripeDisputeId: null },
  })

  return db.runTransaction(async (txn) => {
    const fresh = InvoiceSchema.parse((await txn.get(ref)).data())
    if (fresh.refunds.some((r) => r.id === refund.key)) return fresh
    const next = InvoiceSchema.parse({
      ...fresh,
      refunds: [
        ...fresh.refunds,
        {
          id: refund.key,
          entryId,
          amount: refund.cents / 100,
          date: refund.date,
          reason: refund.reason,
          stripeRefundId: refund.stripeRefundId,
        },
      ],
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return next
  })
}

// ---------------------------------------------------------------------------
// Refund from 521 (updateInvoiceStatus { action: "refund" })
// ---------------------------------------------------------------------------

const STRIPE_REASON: Record<ManualRefundReason, Stripe.RefundCreateParams.Reason | undefined> = {
  requested_by_client: "requested_by_customer",
  duplicate: "duplicate",
  other: undefined,
}

export async function refundInvoice(
  workspaceId: string,
  uid: string,
  invoiceId: string,
  request: { amount: number; reason: ManualRefundReason; clientMutationId: string }
): Promise<InvoiceType> {
  await assertWorkspaceMembership(workspaceId, uid)
  // Refunds move or account for real money: owner only.
  if ((await workspaceOwner(workspaceId)) !== uid) throw new ForbiddenError("Only the workspace owner can refund payments.")

  const snap = await invoicesCol(workspaceId).doc(invoiceId).get()
  if (!snap.exists) throw new NotFoundError("Invoice not found")
  const invoice = InvoiceSchema.parse(snap.data())
  if (invoice.status !== "paid") throw new ConflictError("Only a paid invoice can be refunded.")
  const cents = toCents(request.amount)
  if (cents > toCents(invoiceRefundableAmount(invoice))) {
    throw new BadRequestError("That's more than is left to refund on this invoice.")
  }
  const today = await localDate(workspaceId, Math.floor(Date.now() / 1000))

  if (invoice.paidVia === "online" && invoice.paidStripePaymentIntentId) {
    const account = await readPaymentAccount(workspaceId)
    if (!account) throw new ConflictError("This workspace's Stripe account isn't connected anymore.")
    const refund = await getStripe().refunds.create(
      {
        payment_intent: invoice.paidStripePaymentIntentId,
        amount: cents,
        reason: STRIPE_REASON[request.reason],
        metadata: { workspaceId, invoiceId, source: "521" },
      },
      { stripeAccount: account.stripeAccountId, idempotencyKey: `refund-${invoiceId}-${request.clientMutationId}` }
    )
    if (refund.status === "failed" || refund.status === "canceled") {
      throw new ConflictError("Stripe couldn't process that refund. Check your Stripe balance and try again.")
    }
    // Same key the charge.refunded webhook uses, so it books once.
    return recordInvoiceRefund(workspaceId, invoiceId, {
      key: refund.id,
      cents,
      date: today,
      reason: request.reason,
      stripeRefundId: refund.id,
    })
  }

  // Paid outside Stripe: the user sends the money back themselves; this
  // only records it. If that payment already reached the bank feed, it's
  // hidden from expense review now (otherwise when it arrives — see
  // upsertPendingTransactionFromPlaid).
  const key = `manual_${request.clientMutationId}`
  const recorded = await recordInvoiceRefund(workspaceId, invoiceId, {
    key,
    cents,
    date: today,
    reason: request.reason,
    stripeRefundId: null,
  })
  const refund = recorded.refunds.find((r) => r.id === key)
  if (refund && !refund.plaidTransactionId) {
    const { dismissPaymentMatchingInvoiceRefund } = await import("./plaidService.js")
    await dismissPaymentMatchingInvoiceRefund(workspaceId, {
      invoiceId,
      invoiceNumber: recorded.number,
      clientName: recorded.clientName,
      refundId: refund.id,
      amount: refund.amount,
      date: refund.date,
    }).catch((error) => console.error("refundsService.refundInvoice: couldn't match the refund payment", error))
    return InvoiceSchema.parse((await invoicesCol(workspaceId).doc(invoiceId).get()).data())
  }
  return recorded
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

async function workspaceForStripeAccount(stripeAccountId: string): Promise<string | null> {
  const snap = await db.collection("stripeAccounts").doc(stripeAccountId).get()
  return (snap.data()?.workspaceId as string | undefined) ?? null
}

// The invoice an online payment paid — only the payment that actually paid
// it (a duplicate payment 521 refunded itself was never booked, so its
// refund mustn't be either).
async function invoiceForPayment(
  stripeAccountId: string,
  paymentIntentId: string | null
): Promise<{ workspaceId: string; invoice: InvoiceType } | null> {
  if (!paymentIntentId) return null
  const workspaceId = await workspaceForStripeAccount(stripeAccountId)
  if (!workspaceId) return null
  const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: stripeAccountId })
  const invoiceId = paymentIntent.metadata?.invoiceId
  if (!invoiceId || paymentIntent.metadata?.workspaceId !== workspaceId) return null
  const snap = await invoicesCol(workspaceId).doc(invoiceId).get()
  if (!snap.exists) return null
  const invoice = InvoiceSchema.parse(snap.data())
  if (invoice.paidStripePaymentIntentId !== paymentIntentId) return null
  return { workspaceId, invoice }
}

function intentId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null
}

// charge.refunded — covers refunds made in Stripe's own dashboard as well as
// ones started in 521 (already booked under the same key).
export async function handleChargeRefunded(stripeAccountId: string, charge: Stripe.Charge): Promise<void> {
  const target = await invoiceForPayment(stripeAccountId, intentId(charge.payment_intent))
  if (!target) return
  const refunds = await getStripe().refunds.list({ charge: charge.id, limit: 100 }, { stripeAccount: stripeAccountId })
  for (const refund of refunds.data) {
    if (refund.status === "failed" || refund.status === "canceled") continue
    if (target.invoice.refunds.some((r) => r.id === refund.id)) continue
    target.invoice = await recordInvoiceRefund(target.workspaceId, target.invoice.id, {
      key: refund.id,
      cents: refund.amount,
      date: await localDate(target.workspaceId, refund.created),
      reason: refund.reason === "duplicate" ? "duplicate" : refund.reason === "requested_by_customer" ? "requested_by_client" : "other",
      stripeRefundId: refund.id,
    })
  }
}

function disputeStatus(status: Stripe.Dispute.Status): InvoiceDispute["status"] {
  switch (status) {
    case "won":
    case "warning_closed":
      return "won"
    case "lost":
      return "lost"
    case "warning_needs_response":
    case "warning_under_review":
      return "inquiry"
    default:
      return "open"
  }
}

// charge.dispute.* — books what Stripe actually moved, from the dispute's own
// balance transactions: the money taken (a "dispute" refund Entry) and its
// fee (an expense); if it comes back, the money (a "dispute_reversed" Entry)
// and any fee Stripe returned (a negative expense). Each under a fixed id,
// so repeated events change nothing.
export async function handleDisputeEvent(stripeAccountId: string, dispute: Stripe.Dispute, eventType: string): Promise<void> {
  const target = await invoiceForPayment(stripeAccountId, intentId(dispute.payment_intent))
  if (!target) return
  const { workspaceId, invoice } = target
  const ownerUid = await workspaceOwner(workspaceId)
  const transactions = (dispute.balance_transactions ?? []).filter(
    (bt): bt is Stripe.BalanceTransaction => typeof bt === "object" && bt !== null
  )
  const withdrawn = transactions.filter((bt) => bt.amount < 0)
  const reinstated = transactions.filter((bt) => bt.amount > 0)
  const withdrawnFeeCents = withdrawn.reduce((sum, bt) => sum + bt.fee, 0)
  const returnedFeeCents = -reinstated.reduce((sum, bt) => sum + bt.fee, 0)

  if (withdrawn.length > 0) {
    const date = await localDate(workspaceId, withdrawn[0].created)
    await bookRefundEntry({
      workspaceId,
      invoice,
      cents: dispute.amount,
      date,
      clientMutationId: `dispute_${dispute.id}`,
      info: { reason: "dispute", stripeRefundId: null, stripeDisputeId: dispute.id },
    })
    if (withdrawnFeeCents > 0) {
      await expensesSvc.createExpense(workspaceId, ownerUid, {
        date,
        amount: withdrawnFeeCents / 100,
        vendor: "Stripe",
        description: `Dispute fee on Invoice #${invoice.number}`,
        account: PROCESSING_FEE_EXPENSE_ACCOUNT,
        clientMutationId: `dispute_${dispute.id}_fee`,
      })
    }
  }
  if (reinstated.length > 0) {
    const date = await localDate(workspaceId, reinstated[0].created)
    await bookRefundEntry({
      workspaceId,
      invoice,
      cents: dispute.amount,
      date,
      clientMutationId: `dispute_${dispute.id}_reversed`,
      info: { reason: "dispute_reversed", stripeRefundId: null, stripeDisputeId: dispute.id },
    })
    if (returnedFeeCents > 0) {
      await expensesSvc.createExpense(workspaceId, ownerUid, {
        date,
        amount: -returnedFeeCents / 100,
        vendor: "Stripe",
        description: `Dispute fee returned on Invoice #${invoice.number}`,
        account: PROCESSING_FEE_EXPENSE_ACCOUNT,
        clientMutationId: `dispute_${dispute.id}_fee_returned`,
      })
    }
  }

  const next: InvoiceDispute = {
    stripeDisputeId: dispute.id,
    status: disputeStatus(dispute.status),
    amount: dispute.amount / 100,
    reason: dispute.reason ?? null,
    evidenceDueBy: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
    fundsWithdrawn: withdrawn.length > 0,
    feeAmount: Math.max(0, withdrawnFeeCents - returnedFeeCents) / 100,
    updatedAt: new Date().toISOString(),
  }
  const previousStatus = invoice.dispute?.stripeDisputeId === dispute.id ? invoice.dispute.status : null
  await invoicesCol(workspaceId).doc(invoice.id).set({ dispute: next, updatedAt: next.updatedAt }, { merge: true })

  // Tell the owner when it opens (there's a deadline) and when it's decided.
  const opened = eventType === "charge.dispute.created" && previousStatus === null
  const decided = (next.status === "won" || next.status === "lost") && previousStatus !== next.status
  if (!opened && !decided) return
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  const money = `$${(dispute.amount / 100).toFixed(2)}`
  const due = next.evidenceDueBy
    ? new Date(next.evidenceDueBy).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null
  await sendTransactionNotification(ownerUid, {
    title: opened
      ? `${invoice.clientName} disputed a ${money} payment`
      : next.status === "won"
        ? `You won the dispute with ${invoice.clientName}`
        : `The dispute with ${invoice.clientName} was lost`,
    body: opened
      ? `Invoice #${invoice.number}.${due ? ` Respond in Stripe by ${due}.` : ""}`
      : next.status === "won"
        ? `${money} is back in your income.`
        : `The ${money} stays refunded.`,
    data: { deepLink: `stackin://invoices/${invoice.id}`, workspaceId },
  }).catch((error) => console.error("refundsService: dispute notification failed", error))
}

// After a refund Entry is deleted by hand: take it off its invoice's list so
// the invoice no longer shows (or caps on) it. Money already returned
// through Stripe stays returned — this only edits the books.
export async function forgetRefundForDeletedEntry(workspaceId: string, entryId: string, invoiceId: string | null) {
  if (!invoiceId) return
  const ref = invoicesCol(workspaceId).doc(invoiceId)
  const removed = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return null
    const invoice = InvoiceSchema.parse(snap.data())
    const refund = invoice.refunds.find((r) => r.entryId === entryId)
    if (!refund) return null
    txn.set(ref, { refunds: invoice.refunds.filter((r) => r.entryId !== entryId), updatedAt: new Date().toISOString() }, { merge: true })
    return refund
  })
  // The bank payment hidden as this refund now has nothing booked for it.
  if (removed?.plaidTransactionId) {
    const { returnPaymentForDeletedRefund } = await import("./plaidService.js")
    await returnPaymentForDeletedRefund(workspaceId, removed.plaidTransactionId)
  }
}
