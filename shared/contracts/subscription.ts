// shared/contracts/subscription.ts

import type { WorkspaceType } from "./workspace"

/**
 * Subscription tiers represent billing plans.
 * These should map 1:1 with Stripe price metadata.
 */
export type SubscriptionTier =
  | "w2_basic"
  | "independent_basic"
  | "hybrid_plus"

/**
 * Capabilities derived from a subscription tier.
 * These are NOT stored in Firestore — they are computed.
 */
export interface SubscriptionCapabilities {
  allowedWorkspaceTypes: WorkspaceType[]
  maxWorkspaces: number | "unlimited"
}

/**
 * Firestore representation of a user's subscription.
 * Stored at: users/{uid}/subscription/current
 */
export interface SubscriptionDoc {
  tier: SubscriptionTier
  status: "active" | "trialing" | "past_due" | "canceled"
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  cancelAtPeriodEnd?: boolean
  currentPeriodEnd?: number
  pendingAccountDeletion?: boolean
  scheduledDeletionAt?: number
  deletionRequestedAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * Central mapping: tier → capabilities
 * This is the SINGLE source of truth for entitlements.
 */
export const SUBSCRIPTION_CAPABILITIES: Record<
  SubscriptionTier,
  SubscriptionCapabilities
> = {
  w2_basic: {
    allowedWorkspaceTypes: ["w2"],
    maxWorkspaces: 3,
  },

  independent_basic: {
    allowedWorkspaceTypes: ["independent"],
    maxWorkspaces: 3,
  },

  hybrid_plus: {
    allowedWorkspaceTypes: ["w2", "independent"],
    maxWorkspaces: 5,
  },
}

/**
 * Helper to derive capabilities from a subscription doc.
 */
export function getSubscriptionCapabilities(
  subscription: SubscriptionDoc
): SubscriptionCapabilities {
  return SUBSCRIPTION_CAPABILITIES[subscription.tier]
}
