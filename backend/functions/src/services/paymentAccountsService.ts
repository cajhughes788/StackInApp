import Stripe from "stripe"
import { auth, db } from "../admin"
import { STRIPE_SECRET_KEY } from "../secrets"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, ForbiddenError } from "../lib/httpErrors"
import {
  PaymentAccountActionSchema,
  PaymentAccountSchema,
  paymentAccountStatusFrom,
  type PaymentAccount,
  type StripeAccountSnapshot,
} from "@shared/schemas/paymentAccount"

// ---------------------------------------------------------------------------
// Stripe Connect accounts — phase 1: sign-up, status, dashboard link.
// See shared/schemas/paymentAccount.ts for the model.
// ---------------------------------------------------------------------------

// Where Stripe sends the person after its hosted sign-up. The page bounces
// back into the iOS app (stackin://stripe/onboarding-return) or, on the web,
// to Invoice settings. frontend/app/stripe-return/page.tsx.
const APP_HOSTING_URL = "https://stackin.web.app"

let stripeClient: Stripe | null = null
export function getStripe(): Stripe {
  if (stripeClient) return stripeClient
  const key = STRIPE_SECRET_KEY.value()
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  stripeClient = new Stripe(key)
  return stripeClient
}

function paymentAccountDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("settings").doc("payments")
}

function stripeAccountsIndex(stripeAccountId: string) {
  return db.collection("stripeAccounts").doc(stripeAccountId)
}

export async function readPaymentAccount(workspaceId: string): Promise<PaymentAccount | null> {
  const snap = await paymentAccountDoc(workspaceId).get()
  if (!snap.exists) return null
  const parsed = PaymentAccountSchema.safeParse(snap.data())
  if (!parsed.success) {
    console.error("paymentAccountsService: invalid payment account", workspaceId, parsed.error.issues)
    return null
  }
  return parsed.data
}

export async function getPaymentAccount(workspaceId: string, uid: string): Promise<PaymentAccount | null> {
  await assertWorkspaceMembership(workspaceId, uid)
  return readPaymentAccount(workspaceId)
}

// Payouts land in the account owner's bank, so only the owner manages it.
async function assertWorkspaceOwner(workspaceId: string, uid: string): Promise<{ name: string }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  const workspace = snap.data() as { ownerId?: string; type?: string; name?: string } | undefined
  if (workspace?.type !== "independent") {
    throw new BadRequestError("Online payments are only available in an independent workspace.")
  }
  if (workspace.ownerId !== uid) {
    throw new ForbiddenError("Only the workspace owner can set up online payments.")
  }
  return { name: workspace.name ?? "" }
}

// Writes Stripe's view of the account onto our doc. Used after sign-up,
// on "refresh", and by the account.updated webhook.
export async function syncPaymentAccount(workspaceId: string, account: StripeAccountSnapshot & { id: string }) {
  const ref = paymentAccountDoc(workspaceId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const current = snap.exists ? PaymentAccountSchema.safeParse(snap.data()) : null
    if (!current?.success || current.data.stripeAccountId !== account.id) return null
    const derived = paymentAccountStatusFrom(account)
    const next = PaymentAccountSchema.parse({
      ...current.data,
      ...derived,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return next
  })
}

async function ensureStripeAccount(workspaceId: string, uid: string, workspaceName: string): Promise<PaymentAccount> {
  const existing = await readPaymentAccount(workspaceId)
  if (existing) return existing

  const [settingsSnap, user] = await Promise.all([
    db.doc(`workspaces/${workspaceId}/settings/invoicing`).get(),
    auth.getUser(uid).catch(() => null),
  ])
  const businessName = (settingsSnap.data()?.businessName as string | undefined)?.trim() || workspaceName || undefined

  // Same key for 24h: a double tap or a retry gets the same account back
  // instead of a second one.
  const account = await getStripe().accounts.create(
    {
      country: "US",
      email: user?.email ?? undefined,
      controller: {
        fees: { payer: "account" },
        losses: { payments: "stripe" },
        requirement_collection: "stripe",
        stripe_dashboard: { type: "express" },
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        // Bank transfers in Checkout (phase 3): 0.8%, capped at $5.
        us_bank_account_ach_payments: { requested: true },
      },
      business_profile: businessName ? { name: businessName } : undefined,
      metadata: { workspaceId },
    },
    { idempotencyKey: `connect-account-${workspaceId}` }
  )

  const nowIso = new Date().toISOString()
  const created = PaymentAccountSchema.parse({
    stripeAccountId: account.id,
    ...paymentAccountStatusFrom(account),
    acceptOnline: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  return db.runTransaction(async (txn) => {
    const ref = paymentAccountDoc(workspaceId)
    const snap = await txn.get(ref)
    // Lost a race to a concurrent request: theirs is the same account (same
    // idempotency key), so keep what's there.
    if (snap.exists) return PaymentAccountSchema.parse(snap.data())
    txn.set(ref, created)
    txn.set(stripeAccountsIndex(account.id), { workspaceId, createdAt: nowIso })
    return created
  })
}

async function onboardingLink(stripeAccountId: string, client: "native" | "browser"): Promise<string> {
  const back = (result: "done" | "refresh") => `${APP_HOSTING_URL}/stripe-return?result=${result}&client=${client}`
  const link = await getStripe().accountLinks.create({
    account: stripeAccountId,
    type: "account_onboarding",
    return_url: back("done"),
    refresh_url: back("refresh"),
    collection_options: { fields: "eventually_due" },
  })
  return link.url
}

export async function updatePaymentAccount(
  workspaceId: string,
  uid: string,
  raw: unknown
): Promise<{ paymentAccount: PaymentAccount | null; url?: string }> {
  const parsed = PaymentAccountActionSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid payment account action", parsed.error.issues)
  const action = parsed.data
  const { name } = await assertWorkspaceOwner(workspaceId, uid)

  switch (action.action) {
    case "onboard": {
      const account = await ensureStripeAccount(workspaceId, uid, name)
      // Accounts created before bank transfers existed: ask for that
      // capability now, so the sign-up link collects anything it needs.
      if (account.achStatus === "unrequested") {
        await getStripe()
          .accounts.update(account.stripeAccountId, { capabilities: { us_bank_account_ach_payments: { requested: true } } })
          .catch((error) => {
            console.warn("paymentAccountsService: couldn't request bank transfers", account.stripeAccountId, error instanceof Error ? error.message : error)
          })
      }
      return { paymentAccount: account, url: await onboardingLink(account.stripeAccountId, action.client) }
    }
    case "refresh": {
      const existing = await readPaymentAccount(workspaceId)
      if (!existing) return { paymentAccount: null }
      const account = await getStripe().accounts.retrieve(existing.stripeAccountId)
      return { paymentAccount: (await syncPaymentAccount(workspaceId, account)) ?? existing }
    }
    case "dashboard": {
      const existing = await readPaymentAccount(workspaceId)
      if (!existing?.detailsSubmitted) throw new ConflictError("Finish setting up with Stripe first.")
      const link = await getStripe().accounts.createLoginLink(existing.stripeAccountId)
      return { paymentAccount: existing, url: link.url }
    }
    case "set_accept_online": {
      const ref = paymentAccountDoc(workspaceId)
      const next = await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref)
        if (!snap.exists) throw new ConflictError("Set up online payments first.")
        const current = PaymentAccountSchema.parse(snap.data())
        if (action.acceptOnline && !current.chargesEnabled) {
          throw new ConflictError("Stripe hasn't enabled payments on your account yet.")
        }
        const updated = PaymentAccountSchema.parse({
          ...current,
          acceptOnline: action.acceptOnline,
          updatedAt: new Date().toISOString(),
        })
        txn.set(ref, updated)
        return updated
      })
      return { paymentAccount: next }
    }
  }
}

// account.updated (stripeConnectWebhook): find the workspace by the index.
export async function handleStripeAccountUpdated(account: Stripe.Account): Promise<void> {
  const indexSnap = await stripeAccountsIndex(account.id).get()
  const workspaceId = indexSnap.data()?.workspaceId as string | undefined
  if (!workspaceId) {
    console.warn("paymentAccountsService.handleStripeAccountUpdated: unknown account", account.id)
    return
  }
  await syncPaymentAccount(workspaceId, account)
}

// Account/workspace deletion. Stripe only deletes an account with a zero
// balance; otherwise it's left in place (the owner can still reach it via
// Stripe's own Express login) and only our records go. Best-effort.
export async function deletePaymentAccountForWorkspace(workspaceId: string): Promise<void> {
  const existing = await readPaymentAccount(workspaceId)
  if (!existing) return
  try {
    await getStripe().accounts.del(existing.stripeAccountId)
  } catch (error) {
    console.warn("paymentAccountsService.deletePaymentAccountForWorkspace: Stripe kept the account", {
      workspaceId,
      stripeAccountId: existing.stripeAccountId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  await stripeAccountsIndex(existing.stripeAccountId).delete().catch(() => {})
}
