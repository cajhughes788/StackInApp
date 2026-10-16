import type { Request, Response } from "express"
import Stripe from "stripe"
import { STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_SECRET_KEY } from "../secrets"
import { handleStripeAccountUpdated } from "../services/paymentAccountsService"
import {
  handleAsyncPaymentFailed,
  handleAsyncPaymentSucceeded,
  handleCheckoutSessionCompleted,
  handlePayoutEvent,
} from "../services/invoicePaymentsService"

// Events from users' Stripe Connect accounts (a separate endpoint and
// signing secret from stripeWebhook.ts, which handles 521's own
// subscriptions): account status, paid invoices, and payouts (recorded so
// their bank deposits aren't counted again). Refunds and disputes come in a
// later phase. Unhandled events get a 200 so Stripe doesn't retry them.
export async function stripeConnectWebhookHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed")
    return
  }
  const signature = req.headers["stripe-signature"]
  const rawBody = (req as any).rawBody as Buffer | undefined
  const secret = STRIPE_CONNECT_WEBHOOK_SECRET.value()
  if (typeof signature !== "string" || !rawBody || !secret) {
    res.status(400).send("Missing signature")
    return
  }

  let event: Stripe.Event
  try {
    event = new Stripe(STRIPE_SECRET_KEY.value()).webhooks.constructEvent(rawBody, signature, secret)
  } catch (error) {
    console.warn("stripeConnectWebhook: bad signature", error instanceof Error ? error.message : error)
    res.status(400).send("Invalid signature")
    return
  }

  try {
    switch (event.type) {
      case "account.updated":
        await handleStripeAccountUpdated(event.data.object as Stripe.Account)
        break
      case "checkout.session.completed":
        if (event.account) await handleCheckoutSessionCompleted(event.account, event.data.object as Stripe.Checkout.Session)
        break
      case "checkout.session.async_payment_succeeded":
        if (event.account) {
          await handleAsyncPaymentSucceeded(event.account, event.data.object as Stripe.Checkout.Session, event.created)
        }
        break
      case "checkout.session.async_payment_failed":
        if (event.account) await handleAsyncPaymentFailed(event.account, event.data.object as Stripe.Checkout.Session)
        break
      case "payout.created":
      case "payout.updated":
      case "payout.paid":
      case "payout.failed":
      case "payout.canceled":
        if (event.account) await handlePayoutEvent(event.account, event.data.object as Stripe.Payout)
        break
      default:
        break
    }
    res.status(200).json({ received: true })
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.error("stripeConnectWebhook: failed to handle", event.type, event.id, error)
    res.status(500).send("Handler failed")
  }
}
