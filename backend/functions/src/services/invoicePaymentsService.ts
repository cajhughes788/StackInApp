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

// What the public page offers: nothing, or Pay (with bank transfer when the
// account has it). Never while a bank transfer is already clearing.
export async function invoiceOnlinePayment(
  workspaceId: string,
  invoice: InvoiceType
): Promise<{ payable: boolean; bankTransfer: boolean }> {
  if (invoice.status !== "sent" || invoice.pendingPaymentAt) return { payable: false, bankTransfer: false }
  const account = await readPaymentAccount(workspaceId)
  const payable = !!account && account.chargesEnabled && account.acceptOnline
  return { payable, bankTransfer: payable && account?.achStatus === "active" }
}

export async function startInvoiceCheckout(shareToken: string): Promise<CheckoutStart> {
  const shared = await findSharedInvoice(shareToken)
  if (!shared) return { kind: "not_found" }
  const { workspaceId, invoice, settings } = shared
  const account = await readPaymentAccount(workspaceId)
  if (invoice.status !== "sent" || invoice.pendingPaymentAt || !account?.chargesEnabled || !account.acceptOnline) {
    return { kind: "not_payable" }
  }

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
      // Cards (with Apple Pay / Google Pay / Link where offered), plus bank
      // transfers once Stripe has enabled them on the account — 0.8% capped
      // at $5, the cheapest way for a client to pay a large invoice. A bank
      // transfer settles days later (checkout.session.async_payment_*).
      payment_method_types: account.achStatus === "active" ? ["card", "us_bank_account"] : ["card"],
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

async function sessionTarget(stripeAccountId: string, session: Stripe.Checkout.Session) {
  const workspaceId = await workspaceForStripeAccount(stripeAccountId)
  const invoiceId = session.metadata?.invoiceId
  if (!workspaceId || !invoiceId || session.metadata?.workspaceId !== workspaceId) {
    console.warn("invoicePayments: Checkout session isn't one of ours", { stripeAccountId, session: session.id })
    return null
  }
  return { workspaceId, invoiceId }
}

// checkout.session.completed: a card payment is paid now; a bank transfer
// has only started and settles in a few business days.
export async function handleCheckoutSessionCompleted(stripeAccountId: string, session: Stripe.Checkout.Session): Promise<void> {
  const target = await sessionTarget(stripeAccountId, session)
  if (!target) return
  if (session.payment_status === "paid") {
    await bookPaidSession(stripeAccountId, target.workspaceId, target.invoiceId, session)
    return
  }
  // Bank transfer under way: the invoice stays open but isn't payable again
  // (no second payment while this one clears).
  const ref = invoicesCol(target.workspaceId).doc(target.invoiceId)
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return
    const current = InvoiceSchema.parse(snap.data())
    if (current.status !== "sent") return
    txn.set(
      ref,
      { pendingPaymentAt: new Date().toISOString(), paymentFailedAt: null, checkoutSessionId: session.id },
      { merge: true }
    )
  })
}

// checkout.session.async_payment_succeeded: the bank transfer cleared.
export async function handleAsyncPaymentSucceeded(
  stripeAccountId: string,
  session: Stripe.Checkout.Session,
  eventCreated: number
): Promise<void> {
  const target = await sessionTarget(stripeAccountId, session)
  if (!target) return
  await bookPaidSession(stripeAccountId, target.workspaceId, target.invoiceId, session, eventCreated)
}

// checkout.session.async_payment_failed: the bank transfer bounced. The
// invoice is payable again, and the owner is told.
export async function handleAsyncPaymentFailed(stripeAccountId: string, session: Stripe.Checkout.Session): Promise<void> {
  const target = await sessionTarget(stripeAccountId, session)
  if (!target) return
  const ref = invoicesCol(target.workspaceId).doc(target.invoiceId)
  const failed = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return null
    const current = InvoiceSchema.parse(snap.data())
    if (current.status !== "sent" || current.checkoutSessionId !== session.id) return null
    txn.set(
      ref,
      { pendingPaymentAt: null, paymentFailedAt: new Date().toISOString(), checkoutSessionId: null },
      { merge: true }
    )
    return current
  })
  if (!failed) return
  const workspaceSnap = await db.doc(`workspaces/${target.workspaceId}`).get()
  const ownerUid = workspaceSnap.data()?.ownerId as string | undefined
  if (!ownerUid) return
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  await sendTransactionNotification(ownerUid, {
    title: `${failed.clientName}'s bank payment failed`,
    body: `Invoice #${failed.number} is open again — they can pay from the same link.`,
    data: { deepLink: `stackin://invoices/${failed.id}`, workspaceId: target.workspaceId },
  }).catch((error) => console.error("invoicePayments: failed-payment notification failed", error))
}

async function bookPaidSession(
  stripeAccountId: string,
  workspaceId: string,
  invoiceId: string,
  session: Stripe.Checkout.Session,
  // When the money actually arrived; defaults to the charge time (cards).
  paidAtSeconds?: number
): Promise<void> {
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
  const paidSeconds = paidAtSeconds ?? charge.created
  const timeZone = await workspaceTimeZone(workspaceId)
  const paidDate = DateTime.fromSeconds(paidSeconds).setZone(timeZone).toISODate() ?? new Date().toISOString().slice(0, 10)
  // A bank transfer has no Entry payment method of its own: booked as named
  // Other income under the client, like a check. Cards go under Card / POS.
  const isBankTransfer = charge.payment_method_details?.type === "us_bank_account"
  const entryMethod = isBankTransfer ? ("other" as const) : ("pos" as const)

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
      paidAt: new Date(paidSeconds * 1000).toISOString(),
      paidVia: "online",
      paidMethod: entryMethod,
      pendingPaymentAt: null,
      paymentFailedAt: null,
      paidStripePaymentIntentId: paymentIntentId,
      paidFeeAmount: feeCents / 100,
      checkoutSessionId: session.id,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return { outcome: "claimed" as const, invoice: next, previousPendingAt: current.pendingPaymentAt }
  })

  if (claim.outcome === "done") return
  if (claim.outcome === "missing" || claim.outcome === "duplicate") {
    // Paid twice (two tabs), or paid after it was voided or settled another
    // way: give the money back rather than book it against nothing.
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "duplicate", metadata: { workspaceId, invoiceId } },
      { stripeAccount: stripeAccountId, idempotencyKey: `refund-${paymentIntentId}` }
    )
    console.warn("invoicePayments: refunded a payment for an invoice that wasn't open", {
      workspaceId,
      invoiceId,
      paymentIntentId,
      status: claim.outcome === "duplicate" ? claim.invoice.status : "missing",
    })
    return
  }

  const invoice = claim.invoice
  const previousPendingAt = claim.outcome === "claimed" ? claim.previousPendingAt : null
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
      ? [invoiceIncomeBreakdown(invoice.lines, entryMethod)]
      : [{ paymentMethod: entryMethod, [topCategory]: receivedCents / 100 }]
    const customIncome = !isBankTransfer
      ? []
      : totalMatches
        ? [...invoiceCentsByCategory(invoice.lines)].map(([category, cents]) => ({
            label: invoice.clientName,
            amount: cents / 100,
            category,
          }))
        : [{ label: invoice.clientName, amount: receivedCents / 100, category: topCategory }]
    if (!totalMatches) {
      console.warn("invoicePayments: received amount differs from invoice total", { invoiceId, receivedCents, total: invoice.total })
    }

    const entry = await entriesSvc.createEntry(workspaceId, ownerUid, {
      workspace: "independent",
      date: paidDate,
      notes: [`Invoice #${invoice.number}`, invoice.clientName, isBankTransfer ? "Paid by bank transfer (Stripe)" : "Paid online (Stripe)"].join(" | "),
      clientMutationId: `stripe_${paymentIntentId}`,
      independent: {
        hours: 0,
        incomeBreakdowns,
        unreportedCash: 0,
        unreportedCashTips: 0,
        customIncome,
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
            // A cleared bank transfer stays "processing" so it can't be paid twice.
            pendingPaymentAt: previousPendingAt,
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
