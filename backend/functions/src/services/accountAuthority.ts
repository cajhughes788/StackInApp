import { db } from "../admin"

import {
  getSubscriptionCapabilities,
  type SubscriptionCapabilities,
  type SubscriptionDoc,
} from "@shared/contracts/subscription"
import type { WorkspaceType } from "@shared/contracts/workspace"

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionDoc["status"]>([
  "active",
  "trialing",
])

const SUBSCRIPTION_TIERS = new Set<SubscriptionDoc["tier"]>([
  "w2_basic",
  "independent_basic",
  "hybrid_plus",
])

const SUBSCRIPTION_STATUSES = new Set<SubscriptionDoc["status"]>([
  "active",
  "trialing",
  "past_due",
  "canceled",
])

export type AccountAuthoritySnapshot = {
  subscription: SubscriptionDoc | null
  isSubscriptionActive: boolean
  subscriptionCapabilities: SubscriptionCapabilities | null
  allowedWorkspaceTypes: WorkspaceType[]
  maxWorkspaces: number | "unlimited"
}

function isStoredSubscriptionDoc(
  value: Record<string, unknown>
): value is Record<string, unknown> {
  return (
    SUBSCRIPTION_TIERS.has(value.tier as SubscriptionDoc["tier"]) &&
    SUBSCRIPTION_STATUSES.has(value.status as SubscriptionDoc["status"]) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  )
}

function toPublicSubscriptionDoc(value: Record<string, unknown>): SubscriptionDoc {
  return {
    tier: value.tier as SubscriptionDoc["tier"],
    status: value.status as SubscriptionDoc["status"],
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
    ...(typeof value.stripeCustomerId === "string"
      ? { stripeCustomerId: value.stripeCustomerId }
      : {}),
    ...(typeof value.stripeSubscriptionId === "string"
      ? { stripeSubscriptionId: value.stripeSubscriptionId }
      : {}),
    ...(typeof value.cancelAtPeriodEnd === "boolean"
      ? { cancelAtPeriodEnd: value.cancelAtPeriodEnd }
      : {}),
    ...(typeof value.currentPeriodEnd === "number"
      ? { currentPeriodEnd: value.currentPeriodEnd }
      : {}),
    ...(typeof value.pendingAccountDeletion === "boolean"
      ? { pendingAccountDeletion: value.pendingAccountDeletion }
      : {}),
    ...(typeof value.scheduledDeletionAt === "number"
      ? { scheduledDeletionAt: value.scheduledDeletionAt }
      : {}),
    ...(typeof value.deletionRequestedAt === "number"
      ? { deletionRequestedAt: value.deletionRequestedAt }
      : {}),
  }
}

function isPlausibleSubscriptionTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= Date.UTC(2000, 0, 1) &&
    value <= Date.UTC(2100, 0, 1)
  )
}

async function normalizeSubscriptionSnapshot(
  subRef: FirebaseFirestore.DocumentReference,
  subSnap: FirebaseFirestore.DocumentSnapshot
): Promise<SubscriptionDoc | null> {
  if (!subSnap.exists) {
    return null
  }

  const rawSubscription = subSnap.data() as Record<string, unknown>
  if (!isStoredSubscriptionDoc(rawSubscription)) {
    return null
  }

  const subscription = toPublicSubscriptionDoc(rawSubscription)
  const shouldRepairScheduledDeletionAt =
    subscription.pendingAccountDeletion === true &&
    !isPlausibleSubscriptionTimestamp(subscription.scheduledDeletionAt) &&
    isPlausibleSubscriptionTimestamp(subscription.currentPeriodEnd)

  if (shouldRepairScheduledDeletionAt) {
    subscription.scheduledDeletionAt = subscription.currentPeriodEnd
    subscription.updatedAt = Date.now()
    await subRef.set(
      {
        scheduledDeletionAt: subscription.scheduledDeletionAt,
        updatedAt: subscription.updatedAt,
      },
      { merge: true }
    )
  }

  return subscription
}

export async function buildAccountAuthorityFromSubscriptionSnapshot(
  subRef: FirebaseFirestore.DocumentReference,
  subSnap: FirebaseFirestore.DocumentSnapshot
): Promise<AccountAuthoritySnapshot> {
  const subscription = await normalizeSubscriptionSnapshot(subRef, subSnap)
  const isSubscriptionActive = subscription
    ? ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    : false
  const subscriptionCapabilities =
    subscription && isSubscriptionActive
      ? getSubscriptionCapabilities(subscription)
      : null

  return {
    subscription,
    isSubscriptionActive,
    subscriptionCapabilities,
    allowedWorkspaceTypes: isSubscriptionActive
      ? subscriptionCapabilities?.allowedWorkspaceTypes ?? []
      : [],
    maxWorkspaces: isSubscriptionActive
      ? subscriptionCapabilities?.maxWorkspaces ?? 0
      : 0,
  }
}

export async function loadAccountAuthorityForUser(
  uid: string
): Promise<AccountAuthoritySnapshot> {
  const subRef = db.doc(`users/${uid}/subscription/current`)
  const subSnap = await subRef.get()
  return buildAccountAuthorityFromSubscriptionSnapshot(subRef, subSnap)
}
