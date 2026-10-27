import type Stripe from "stripe"
import { DateTime } from "luxon"
import { db } from "../admin"
import {
  InvoicePaymentPurposeSchema,
  InvoiceSchema,
  type InvoicePayment,
  type InvoicePaymentPurpose,
  type InvoiceType,
} from "@shared/schemas/invoice"
import { invoiceCheckoutAmounts, invoiceOffersTip, invoicePaymentOptions, type InvoiceCheckoutChoice } from "@shared/invoicePayments"
import { invoicePaidNotification, publicInvoiceUrl } from "@shared/invoiceDisplay"
import { StripePayoutSchema } from "@shared/stripePayouts"
import { payoutsCol } from "./stripePayoutsStore"
import { findSharedInvoice, invoicesCol } from "./invoicesService"
import { getStripe, readPaymentAccount } from "./paymentAccountsService"

// ---------------------------------------------------------------------------
// Online invoice payments — Stripe Connect phase 2.
//
// A client taps Pay on the public invoice page → a Checkout session on the
// user's own Stripe account (direct charge: Stripe's fee comes out of the
// user's balance) for what's left to pay → checkout.session.completed books
// it through the payment engine like any other payment: its own Entry, plus
// Stripe's actual fee as a Payment Processing Fees expense.
// Payouts are recorded so the bank deposit they become isn't counted again
// (shared/stripePayouts.ts).
// ---------------------------------------------------------------------------

const DEFAULT_TIME_ZONE = "America/Los_Angeles"

const PURPOSE_LINE_LABELS: Record<InvoicePaymentPurpose, string> = {
  deposit: "Deposit",
  balance: "Balance",
  full: "Payment",
  partial: "Payment",
}

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
  if (invoicePaymentOptions(invoice).length === 0) return { payable: false, bankTransfer: false }
  const account = await readPaymentAccount(workspaceId)
  const payable = !!account && account.chargesEnabled && account.acceptOnline
  // A quick charge is paid at the counter: cards and wallets only.
  return { payable, bankTransfer: payable && !invoice.quickCharge && account?.achStatus === "active" }
}

// The client chose what to pay (deposit, balance or everything) and a tip
// on the invoice page. The amounts come from the invoice, never the request
// (invoiceCheckoutAmounts); the tip is its own line so Stripe's receipt and
// dashboard show it, and the metadata tells the webhook exactly how much of
// the charge was the tip.
export async function startInvoiceCheckout(shareToken: string, choice: InvoiceCheckoutChoice = {}): Promise<CheckoutStart> {
  const shared = await findSharedInvoice(shareToken)
  if (!shared) return { kind: "not_found" }
  const { workspaceId, invoice, settings } = shared
  const account = await readPaymentAccount(workspaceId)
  const amounts = invoiceCheckoutAmounts(invoice, choice, invoiceOffersTip(invoice, settings.offerTips))
  if (!amounts || !account?.chargesEnabled || !account.acceptOnline) {
    return { kind: "not_payable" }
  }

  const stripe = getStripe()
  const stripeAccount = account.stripeAccountId
  const { amountCents, tipCents } = amounts
  const option = { purpose: amounts.purpose }
  const pageUrl = publicInvoiceUrl(shareToken)

  // Reuse the client's open session for the same choice (a second tap, a
  // back button) so one invoice doesn't collect two payments. A different
  // choice closes the old session first.
  if (invoice.openCheckout) {
    const existing = await stripe.checkout.sessions
      .retrieve(invoice.openCheckout.sessionId, {}, { stripeAccount })
      .catch(() => null)
    if (existing?.status === "complete") return { kind: "redirect", url: `${pageUrl}?paid=1` }
    const same =
      invoice.openCheckout.purpose === amounts.purpose &&
      invoice.openCheckout.amountCents === amountCents &&
      invoice.openCheckout.tipCents === tipCents
    if (existing?.status === "open" && same && existing.amount_total === amountCents + tipCents && existing.url) {
      return { kind: "redirect", url: existing.url }
    }
    if (existing?.status === "open") {
      await stripe.checkout.sessions.expire(existing.id, {}, { stripeAccount }).catch(() => null)
    }
  }

  const business = settings.businessName || ""
  // What this payment is for, read back by the webhook — the amounts are
  // never inferred from what arrived.
  const checkoutMetadata = {
    workspaceId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    purpose: option.purpose,
    amountCents: String(amountCents),
    tipCents: String(tipCents),
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      // Cards (with Apple Pay / Google Pay / Link where offered), plus bank
      // transfers once Stripe has enabled them on the account — 0.8% capped
      // at $5, the cheapest way for a client to pay a large invoice. A bank
      // transfer settles days later (checkout.session.async_payment_*).
      // A quick charge is paid at the counter, so no bank transfer (it takes days).
      payment_method_types: account.achStatus === "active" && !invoice.quickCharge ? ["card", "us_bank_account"] : ["card"],
      // The whole invoice: its own lines. Part of it: one line saying which.
      // A tip is a line of its own.
      line_items: [
        ...(amountCents === toCents(invoice.total)
          ? invoice.lines.map((line) => ({
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: toCents(line.amount),
                product_data: { name: line.description.slice(0, 250) || `Invoice #${invoice.number}` },
              },
            }))
          : [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: amountCents,
                  product_data: { name: `${PURPOSE_LINE_LABELS[option.purpose]} — Invoice #${invoice.number}` },
                },
              },
            ]),
        ...(tipCents > 0
          ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: tipCents, product_data: { name: "Tip" } } }]
          : []),
      ],
      client_reference_id: invoice.id,
      metadata: checkoutMetadata,
      payment_intent_data: {
        description: `Invoice #${invoice.number}${business ? ` from ${business}` : ""}`,
        metadata: checkoutMetadata,
      },
      success_url: `${pageUrl}?paid=1`,
      cancel_url: pageUrl,
    },
    // Same invoice, same amounts, same version → the same session for 24h.
    { stripeAccount, idempotencyKey: `checkout-${invoice.id}-${option.purpose}-${amountCents}-${tipCents}-${invoice.updatedAt}` }
  )
  await invoicesCol(workspaceId)
    .doc(invoice.id)
    .set({ openCheckout: { sessionId: session.id, purpose: option.purpose, amountCents, tipCents } }, { merge: true })
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
    const { purpose, amountCents, tipCents } = sessionAmounts(session)
    if (amountCents <= 0) return
    txn.set(
      ref,
      {
        pendingPayment: {
          checkoutSessionId: session.id,
          purpose,
          amount: amountCents / 100,
          tipAmount: tipCents / 100,
          startedAt: new Date().toISOString(),
        },
        paymentFailedAt: null,
        openCheckout: null,
      },
      { merge: true }
    )
  })
}

// What a Checkout session was for, from the metadata 521 set when it
// created it. Sessions without it (none should exist) count as one payment
// of everything charged.
function sessionAmounts(session: Stripe.Checkout.Session): { purpose: InvoicePaymentPurpose; amountCents: number; tipCents: number } {
  const metadata = session.metadata ?? {}
  const purpose = InvoicePaymentPurposeSchema.safeParse(metadata.purpose)
  const tipCents = Number.parseInt(metadata.tipCents ?? "0", 10)
  const amountCents = Number.parseInt(metadata.amountCents ?? "", 10)
  const total = session.amount_total ?? 0
  return {
    purpose: purpose.success ? purpose.data : "full",
    amountCents: Number.isFinite(amountCents) && amountCents > 0 ? amountCents : total - (Number.isFinite(tipCents) ? tipCents : 0),
    tipCents: Number.isFinite(tipCents) && tipCents > 0 ? tipCents : 0,
  }
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
    if (current.status !== "sent" || current.pendingPayment?.checkoutSessionId !== session.id) return null
    txn.set(ref, { pendingPayment: null, paymentFailedAt: new Date().toISOString(), openCheckout: null }, { merge: true })
    return current
  })
  if (!failed) return
  const workspaceSnap = await db.doc(`workspaces/${target.workspaceId}`).get()
  const ownerUid = workspaceSnap.data()?.ownerId as string | undefined
  if (!ownerUid) return
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  const what = failed.pendingPayment?.purpose === "deposit" ? "deposit" : "payment"
  const amount = failed.pendingPayment ? ` of $${failed.pendingPayment.amount.toFixed(2)}` : ""
  await sendTransactionNotification(ownerUid, {
    title: `${failed.clientName}'s bank ${what} failed`,
    body: `Their ${what}${amount} on Invoice #${failed.number} bounced — they can pay again from the same link.`,
    data: { deepLink: `stackin://invoices/${failed.id}`, workspaceId: target.workspaceId },
  }).catch((error) => console.error("invoicePayments: failed-payment notification failed", error))
}

// Tells the owner a client paid. Once per payment: Stripe retries webhooks,
// and a retry finds the payment already booked, so a marker is claimed first.
async function notifyOwnerOfPayment(workspaceId: string, ownerUid: string, invoice: InvoiceType, payment: InvoicePayment): Promise<void> {
  try {
    await db.doc(`workspaces/${workspaceId}/notificationState/paid_${payment.id}`).create({ sentAt: new Date().toISOString() })
  } catch {
    return // Already told (or being told) by an earlier delivery.
  }
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  await sendTransactionNotification(ownerUid, {
    ...invoicePaidNotification(invoice, payment),
    data: { deepLink: `stackin://invoices/${invoice.id}`, workspaceId },
  }).catch((error) => console.error("invoicePayments: paid notification failed", error))
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
  // Other income under the client. Cards go under Card / POS.
  const isBankTransfer = charge.payment_method_details?.type === "us_bank_account"
  const entryMethod = isBankTransfer ? ("other" as const) : ("pos" as const)

  const ownerSnap = await db.doc(`workspaces/${workspaceId}`).get()
  const ownerUid = ownerSnap.data()?.ownerId as string | undefined
  if (!ownerUid) throw new Error(`Workspace ${workspaceId} has no owner`)

  // The amounts 521 asked for, checked against what Stripe actually took.
  // If they don't add up, everything received is booked as the payment
  // (no tip) rather than guessed at.
  let { purpose, amountCents, tipCents } = sessionAmounts(session)
  if (amountCents + tipCents !== receivedCents) {
    console.warn("invoicePayments: received amount doesn't match the session's amounts", {
      invoiceId,
      receivedCents,
      amountCents,
      tipCents,
    })
    amountCents = receivedCents
    tipCents = 0
  }

  const { applyInvoicePayment, PaymentRejectedError } = await import("./invoicePaymentEngine.js")
  try {
    const { invoice, payment } = await applyInvoicePayment(
      workspaceId,
      ownerUid,
      {
        invoiceId,
        payment: {
          id: `stripe_${paymentIntentId}`,
          purpose,
          amount: amountCents / 100,
          tipAmount: tipCents / 100,
          receivedOn: paidDate,
          via: "online",
          method: entryMethod,
          plaidTransactionId: null,
          stripePaymentIntentId: paymentIntentId,
          checkoutSessionId: session.id,
          feeAmount: feeCents / 100,
        },
        settlesCheckoutSessionId: session.id,
      },
      {
        notes: [isBankTransfer ? "Paid by bank transfer (Stripe)" : "Paid online (Stripe)"],
        fee: { vendor: "Stripe", description: `Stripe fee on Invoice #${session.metadata?.invoiceNumber ?? ""}`.trim() },
      }
    )
    await notifyOwnerOfPayment(workspaceId, ownerUid, invoice, payment)
  } catch (error) {
    if (!(error instanceof PaymentRejectedError)) throw error // Stripe retries the webhook.
    // Paid twice (two tabs), or after it was voided, closed or settled
    // another way, or for more than is left: give the money back rather
    // than book it against nothing.
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "duplicate", metadata: { workspaceId, invoiceId } },
      { stripeAccount: stripeAccountId, idempotencyKey: `refund-${paymentIntentId}` }
    )
    console.warn("invoicePayments: refunded a payment the invoice couldn't take", {
      workspaceId,
      invoiceId,
      paymentIntentId,
      reason: error.reason,
    })
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
