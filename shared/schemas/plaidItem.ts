import { z } from "zod"

// -------------------------------------------------------------
// PlaidItem
// One per linked bank connection. Firestore path:
// workspaces/{workspaceId}/plaidItems/{itemId} (itemId == Plaid's item_id).
// -------------------------------------------------------------
export const PlaidLinkedAccountSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  mask: z.string().nullable(),
  type: z.string(),
  subtype: z.string().nullable(),
  // User-set override: "everything from this account defaults to
  // business/personal". Checked in plaidService's classification step
  // after merchant memory (an explicit past correction always wins) but
  // before the generic PFC/keyword classifier. Null = no override, let the
  // generic classifier decide.
  defaultBusiness: z.boolean().nullable().default(null),
})

export const PlaidItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  // uid of whoever ran the Link flow — push notifications for this item's
  // transactions go to their registered devices.
  linkOwnerUid: z.string(),
  institutionId: z.string().nullable(),
  institutionName: z.string().nullable(),
  // Server-only. Never returned to the client — see PlaidItemPublicSchema.
  accessTokenEncrypted: z.string(),
  cursor: z.string().nullable(),
  status: z.enum(["active", "error", "revoked"]),
  linkedAccounts: z.array(PlaidLinkedAccountSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  // Set by flagStalePlaidItemsDaily (backend/functions/src/scheduled) so a
  // user who ignores the first "reconnect your bank" notification isn't
  // paged again every single day — throttled to once a week.
  lastStaleNotifiedAt: z.string().nullable().default(null),
  // Set for the duration of a syncTransactionsForItem run so a second
  // webhook delivery for the same underlying update (Plaid fires both
  // SYNC_UPDATES_AVAILABLE and a legacy DEFAULT_UPDATE/etc for the same
  // change) can't race the first, read the same unadvanced cursor, and send
  // a duplicate push. Cleared when the run finishes; treated as expired
  // after SYNC_LOCK_STALE_MS so a crashed run can't wedge future syncs.
  syncLockedAt: z.string().nullable().default(null),
})

export const PlaidItemPublicSchema = PlaidItemSchema.omit({
  accessTokenEncrypted: true,
})

export type PlaidLinkedAccountType = z.infer<typeof PlaidLinkedAccountSchema>
export type PlaidItemType = z.infer<typeof PlaidItemSchema>
export type PlaidItemPublicType = z.infer<typeof PlaidItemPublicSchema>
