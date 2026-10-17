import { z } from "zod"

// -------------------------------------------------------------
// PaymentAccount
// The workspace's Stripe Connect account (full Stripe dashboard), for clients paying
// invoices online. Firestore path:
// workspaces/{workspaceId}/settings/payments
// plus the top-level index stripeAccounts/{stripeAccountId} → { workspaceId },
// because Connect webhooks name the Stripe account, not the workspace.
//
// Direct charges on a connected account whose controller has Stripe billing
// fees to the account and carrying payment losses: the user is the merchant
// of record and 521 never holds the money.
// -------------------------------------------------------------

// onboarding: sign-up not finished. verifying: submitted, Stripe is still
// checking. active: can take payments and receive payouts. restricted:
// Stripe needs more information (or has paused the account).
export const PaymentAccountStatusSchema = z.enum(["onboarding", "verifying", "active", "restricted"])

export const PaymentAccountSchema = z.object({
  stripeAccountId: z.string(),
  status: PaymentAccountStatusSchema,
  chargesEnabled: z.boolean().default(false),
  payoutsEnabled: z.boolean().default(false),
  detailsSubmitted: z.boolean().default(false),
  // How many requirements Stripe says are due now (shown as "Stripe needs N
  // things"); the details stay in Stripe's own onboarding.
  requirementsDueCount: z.number().int().nonnegative().default(0),
  disabledReason: z.string().nullable().default(null),
  // Stripe's us_bank_account_ach_payments capability: whether Checkout can
  // offer bank transfers. "unrequested" on accounts created before phase 3.
  achStatus: z.enum(["active", "pending", "inactive", "unrequested"]).default("unrequested"),
  // The user's switch: show a Pay button on shared invoices. Only takes
  // effect while status is "active".
  acceptOnline: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const PaymentAccountActionSchema = z.discriminatedUnion("action", [
  // Creates the account the first time, then returns a Stripe-hosted
  // sign-up (or "update details") link. client picks where Stripe sends the
  // person back: into the iOS app, or to the web app.
  z.object({ action: z.literal("onboard"), client: z.enum(["native", "browser"]) }),
  // Re-reads the account from Stripe — after returning from sign-up.
  z.object({ action: z.literal("refresh") }),
  // Where to manage payouts and bank details: the user's Stripe dashboard.
  z.object({ action: z.literal("dashboard") }),
  z.object({ action: z.literal("set_accept_online"), acceptOnline: z.boolean() }),
])

export type PaymentAccount = z.infer<typeof PaymentAccountSchema>
export type PaymentAccountStatus = z.infer<typeof PaymentAccountStatusSchema>
export type PaymentAccountAction = z.infer<typeof PaymentAccountActionSchema>

// The fields of a Stripe Account this needs, so the mapping is testable
// without the Stripe SDK.
export type StripeAccountSnapshot = {
  capabilities?: { us_bank_account_ach_payments?: string | null } | null
  charges_enabled?: boolean | null
  payouts_enabled?: boolean | null
  details_submitted?: boolean | null
  requirements?: {
    currently_due?: string[] | null
    past_due?: string[] | null
    pending_verification?: string[] | null
    disabled_reason?: string | null
  } | null
}

export function paymentAccountStatusFrom(account: StripeAccountSnapshot): {
  status: PaymentAccountStatus
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  requirementsDueCount: number
  disabledReason: string | null
  achStatus: "active" | "pending" | "inactive" | "unrequested"
} {
  const chargesEnabled = account.charges_enabled === true
  const payoutsEnabled = account.payouts_enabled === true
  const detailsSubmitted = account.details_submitted === true
  const due = new Set([...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])])
  const disabledReason = account.requirements?.disabled_reason ?? null
  const status: PaymentAccountStatus = !detailsSubmitted
    ? "onboarding"
    : chargesEnabled && payoutsEnabled
      ? due.size > 0
        ? "restricted" // still working, but something's due before a deadline
        : "active"
      : due.size > 0 || (disabledReason && !disabledReason.includes("pending_verification"))
        ? "restricted"
        : "verifying"
  const ach = account.capabilities?.us_bank_account_ach_payments
  const achStatus = ach === "active" || ach === "pending" || ach === "inactive" ? ach : "unrequested"
  return { status, chargesEnabled, payoutsEnabled, detailsSubmitted, requirementsDueCount: due.size, disabledReason, achStatus }
}
