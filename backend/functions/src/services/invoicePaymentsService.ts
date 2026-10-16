import type Stripe from "stripe"
import { DateTime } from "luxon"
import { db } from "../admin"
import { InvoiceSchema, type InvoiceType } from "@shared/schemas/invoice"
import { invoiceCentsByCategory, invoiceIncomeBreakdown } from "@shared/invoiceMatching"
import { publicInvoiceUrl } from "@shared/invoiceDisplay"
import { StripePayoutSchema } from "@shared/stripePayouts"
import { payoutsCol } from "./stripePayoutsStore"
import { findSharedInvoice, invoicesCol } from "./invoicesService"
import { getStripe, readPaymentAccount } from "./paymentAccountsService"
import * as entriesSvc from "./entriesService"
import * as expensesSvc from "./expensesService"

// ---------------------------------------------------------------------------
// Online invoice payments — Stripe Connect phase 2.
//
// A client taps Pay on the public invoice page → a Checkout session on the
// user's own Stripe account (direct charge: Stripe's fee comes out of the
// user's balance) → checkout.session.completed books the payment the same
// way a bank-matched payment is booked: one Entry for the full invoice
// amount, plus Stripe's actual fee as a Payment Processing Fees expense.
// Payouts are recorded so the bank deposit they become isn't counted again
// (shared/stripePayouts.ts).
// ---------------------------------------------------------------------------

const DEFAULT_TIME_ZONE = "America/Los_Angeles"
const PROCESSING_FEE_EXPENSE_ACCOUNT = "Payment Processing Fees"

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

// ---------------------------------------------------------------------------
// Checkout (public, from the share link)
// ---------------------------------------------------------------------------

export type CheckoutStart =
  | { kind: "redirect"; url: string }
  // Not payable online right now (paid, void, or payments switched off) —
  // send the client back to the invoice page, which says why.
  | { kind: "not_payable" }
  | { kind: "not_found" }

export async function isInvoicePayableOnline(workspaceId: string, invoice: InvoiceType): Promise<boolean> {
  if (invoice.status !== "sent") return false
  const account = await readPaymentAccount(workspaceId)
  return !!account && account.chargesEnabled && account.acceptOnline
}

export async function startInvoiceCheckout(shareToken: string): Promise<CheckoutStart> {
  const shared = await findSharedInvoice(shareToken)
  if (!shared) return { kind: "not_found" }
  const { workspaceId, invoice, settings } = shared
  const account = await readPaymentAccount(workspaceId)
  if (invoice.status !== "sent" || !account?.chargesEnabled || !account.acceptOnline) return { kind: "not_payable" }

  const stripe = getStripe()
  const stripeAccount = account.stripeAccountId
  const totalCents = toCents(invoice.total)
  const pageUrl = publicInvoiceUrl(shareToken)

  // Reuse the client's open session (a second tap, a back button) so one
  // invoice doesn't collect two payments.
  if (invoice.checkoutSessionId) {
    const existing = await stripe.checkout.sessions
      .retrieve(invoice.checkoutSessionId, {}, { stripeAccount })
      .catch(() => null)
    if (existing?.status === "open" && existing.amount_total === totalCents && existing.url) {
      return { kind: "redirect", url: existing.url }
    }
    if (existing?.status === "complete") return { kind: "redirect", url: `${pageUrl}?paid=1` }
  }

  const business = settings.businessName || ""
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      // Cards (with Apple Pay / Google Pay / Link where offered). Bank
      // debits are phase 3: they settle days later and need their own flow.
      payment_method_types: ["card"],
      line_items: invoice.lines.map((line) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: toCents(line.amount),
          product_data: { name: line.description.slice(0, 250) || `Invoice #${invoice.number}` },
        },
      })),
      client_reference_id: invoice.id,
      metadata: { workspaceId, invoiceId: invoice.id, invoiceNumber: invoice.number },
      payment_intent_data: {
        description: `Invoice #${invoice.number}${business ? ` from ${business}` : ""}`,
        metadata: { workspaceId, invoiceId: invoice.id, invoiceNumber: invoice.number },
      },
      success_url: `${pageUrl}?paid=1`,
      cancel_url: pageUrl,
    },
    // Same invoice, same total, same version → the same session for 24h.
    { stripeAccount, idempotencyKey: `checkout-${invoice.id}-${totalCents}-${invoice.updatedAt}` }
  )
  await invoicesCol(workspaceId).doc(invoice.id).set({ checkoutSessionId: session.id }, { merge: true })
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL")
  return { kind: "redirect", url: session.url }
}

// ---------------------------------------------------------------------------
// Webhook: checkout.session.completed
// ---------------------------------------------------------------------------

async function workspaceForStripeAccount(stripeAccountId: string): Promise<string | null> {
  const snap = await db.collection("stripeAccounts").doc(stripeAccountId).get()
  return (snap.data()?.workspaceId as string | undefined) ?? null
}

async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  return (snap.get("common.timeZone") as string | undefined) || DEFAULT_TIME_ZONE
}

export async function handleCheckoutSessionCompleted(stripeAccountId: string, session: Stripe.Checkout.Session): Promise<void> {
  const workspaceId = await workspaceForStripeAccount(stripeAccountId)
  const invoiceId = session.metadata?.invoiceId
  if (!workspaceId || !invoiceId || session.metadata?.workspaceId !== workspaceId) {
    console.warn("invoicePayments.handleCheckoutSessionCompleted: not one of ours", { stripeAccountId, session: session.id })
    return
  }
  // Card payments are paid at completion; delayed methods aren't offered yet.
  if (session.payment_status !== "paid") {
    console.warn("invoicePayments.handleCheckoutSessionCompleted: not paid yet", { session: session.id, status: session.payment_status })
    return
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  if (!paymentIntentId) throw new Error(`Checkout session ${session.id} has no PaymentIntent`)

  const stripe = getStripe()
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ["latest_charge.balance_transaction"] },
    { stripeAccount: stripeAccountId }
  )
  const charge = paymentIntent.latest_charge as Stripe.Charge | null
  const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null | undefined
  // Throwing makes the webhook answer 500, so Stripe retries once the
  // balance transaction exists.
  if (!charge || !balanceTransaction || typeof balanceTransaction === "string") {
    throw new Error(`No balance transaction yet for ${paymentIntentId}`)
  }
  const receivedCents = paymentIntent.amount_received
  const feeCents = balanceTransaction.fee
  const timeZone = await workspaceTimeZone(workspaceId)
  const paidDate = DateTime.fromSeconds(charge.created).setZone(timeZone).toISODate() ?? new Date().toISOString().slice(0, 10)

  const ref = invoicesCol(workspaceId).doc(invoiceId)
  const claim = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return { outcome: "missing" as const }
    const current = InvoiceSchema.parse(snap.data())
    if (current.status === "paid" && current.paidStripePaymentIntentId === paymentIntentId) {
      return { outcome: current.paidEntryId ? ("done" as const) : ("resume" as const), invoice: current }
    }
    if (current.status !== "sent") return { outcome: "duplicate" as const, invoice: current }
    const next = InvoiceSchema.parse({
      ...current,
      status: "paid",
      paidAt: new Date(charge.created * 1000).toISOString(),
      paidVia: "online",
      paidMethod: "pos",
      paidStripePaymentIntentId: paymentIntentId,
      paidFeeAmount: feeCents / 100,
      checkoutSessionId: session.id,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return { outcome: "claimed" as const, invoice: next }
  })

  if (claim.outcome === "done") return
  if (claim.outcome === "missing" || claim.outcome === "duplicate") {
    // Paid twice (two tabs), or paid after it was voided or settled another
    // way: give the money back rather than book it against nothing.
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "duplicate", metadata: { workspaceId, invoiceId } },
      { stripeAccount: stripeAccountId, idempotencyKey: `refund-${paymentIntentId}` }
    )
    console.warn("invoicePayments.handleCheckoutSessionCompleted: refunded a payment for an invoice that wasn't open", {
      workspaceId,
      invoiceId,
      paymentIntentId,
      status: claim.outcome === "duplicate" ? claim.invoice.status : "missing",
    })
    return
  }

  const invoice = claim.invoice
  try {
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()
    const ownerUid = workspaceSnap.data()?.ownerId as string | undefined
    if (!ownerUid) throw new Error(`Workspace ${workspaceId} has no owner`)

    // The client paid the invoice total; if it was edited after Checkout
    // opened (the session is expired on edit, so this is rare) book what was
    // actually received under the invoice's main category.
    const totalMatches = receivedCents === toCents(invoice.total)
    const [topCategory] = [...invoiceCentsByCategory(invoice.lines)].sort((a, b) => b[1] - a[1])[0]
    const incomeBreakdowns = totalMatches
      ? [invoiceIncomeBreakdown(invoice.lines, "pos")]
      : [{ paymentMethod: "pos" as const, [topCategory]: receivedCents / 100 }]
    if (!totalMatches) {
      console.warn("invoicePayments: received amount differs from invoice total", { invoiceId, receivedCents, total: invoice.total })
    }

    const entry = await entriesSvc.createEntry(workspaceId, ownerUid, {
      workspace: "independent",
      date: paidDate,
      notes: [`Invoice #${invoice.number}`, invoice.clientName, "Paid online (Stripe)"].join(" | "),
      clientMutationId: `stripe_${paymentIntentId}`,
      independent: {
        hours: 0,
        incomeBreakdowns,
        unreportedCash: 0,
        unreportedCashTips: 0,
        customIncome: [],
      },
    })
    if (feeCents > 0) {
      await expensesSvc.createExpense(workspaceId, ownerUid, {
        date: paidDate,
        amount: feeCents / 100,
        vendor: "Stripe",
        description: `Stripe fee on Invoice #${invoice.number}`,
        account: PROCESSING_FEE_EXPENSE_ACCOUNT,
        clientMutationId: `stripe_${paymentIntentId}_fee`,
      })
    }
    await ref.set({ paidEntryId: entry.id }, { merge: true })
  } catch (error) {
    // Reopen the invoice (only if this payment still holds it) and let
    // Stripe retry the webhook; the client mutation ids make the retry
    // reuse whatever was already created.
    await db
      .runTransaction(async (txn) => {
        const snap = await txn.get(ref)
        if (snap.data()?.paidStripePaymentIntentId !== paymentIntentId || snap.data()?.paidEntryId) return
        txn.set(
          ref,
          {
            status: "sent",
            paidAt: null,
            paidVia: null,
            paidMethod: null,
            paidStripePaymentIntentId: null,
            paidFeeAmount: 0,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
      })
      .catch((revertError) => console.error("invoicePayments: failed to reopen invoice", revertError))
    throw error
  }
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

// payout.created / updated / paid / failed / canceled. Recorded whether or
// not a bank is connected, so a bank connected later — and its imported
// history — still recognizes these deposits.
export async function handlePayoutEvent(stripeAccountId: string, payout: Stripe.Payout): Promise<void> {
  const workspaceId = await workspaceForStripeAccount(stripeAccountId)
  if (!workspaceId) {
    console.warn("invoicePayments.handlePayoutEvent: unknown account", stripeAccountId)
    return
  }
  if (payout.currency !== "usd") return
  const ref = payoutsCol(workspaceId).doc(payout.id)
  const nowIso = new Date().toISOString()
  const record = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const existing = snap.exists ? StripePayoutSchema.safeParse(snap.data()) : null
    const next = StripePayoutSchema.parse({
      id: payout.id,
      amount: payout.amount / 100,
      arrivalDate: new Date(payout.arrival_date * 1000).toISOString().slice(0, 10),
      status: payout.status,
      matchedPendingTransactionId: existing?.success ? existing.data.matchedPendingTransactionId : null,
      createdAt: existing?.success ? existing.data.createdAt : nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return next
  })
  // The deposit may already be in the review list (bank posted before
  // Stripe's event arrived): dismiss it now.
  if (!record.matchedPendingTransactionId && record.status !== "failed" && record.status !== "canceled") {
    const { dismissDepositMatchingStripePayout } = await import("./plaidService.js")
    await dismissDepositMatchingStripePayout(workspaceId, record)
  }
}
