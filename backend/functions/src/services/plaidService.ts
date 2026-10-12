import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid"
import { db } from "../admin"
import { FieldValue } from "firebase-admin/firestore"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/httpErrors"
import { PlaidItemSchema, PlaidItemPublicSchema, type PlaidItemType, type PlaidLinkedAccountType } from "@shared/schemas/plaidItem"
import {
  PlaidPendingTransactionSchema,
  plaidDirectionFromAmount,
  type PlaidPendingTransactionType,
} from "@shared/schemas/plaidPendingTransaction"
import { PlaidMerchantMemorySchema, type PlaidMerchantMemoryType } from "@shared/schemas/plaidMerchantMemory"
import { PlaidIncomeMemorySchema, type PlaidIncomeMemoryType } from "@shared/schemas/plaidIncomeMemory"
import {
  classifyPlaidTransaction,
  normalizePlaidMerchantKey,
  legacyPlaidMerchantKey,
  resolvePlaidDisplayName,
  detectRecurringCadence,
  isSimilarRecurringAmount,
  suggestPlaidIncomePaymentMethod,
  classifyPlaidTransferSignal,
  isPlaidTransferPair,
  isPeerToPeerDescriptor,
  isVenmoCashoutDescriptor,
  normalizePlaidPayerKey,
  isLikelyPlaidRefund,
  pickRefundedPurchase,
  suggestPayerName,
  type PlaidClassificationResult,
} from "@shared/plaidClassification"
import { isLikelyFuelPurchase } from "@shared/expenseKeywordMatching"
import { computeNextOccurrence } from "@shared/recurringSchedule"
import type { RecurringCadence } from "@shared/schemas/recurringRule"
import type { IncomeCategory, PaymentMethod } from "@shared/schemas/entry"
import * as expensesSvc from "./expensesService"
import * as entriesSvc from "./entriesService"
import { sendTransactionNotification } from "./pushNotificationService"
import { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, PLAID_TOKEN_ENCRYPTION_KEY } from "../secrets"
import { encryptToken, decryptToken } from "../lib/tokenEncryption"

export function getPlaidClient(): PlaidApi {
  const clientId = PLAID_CLIENT_ID.value()
  const secret = PLAID_SECRET.value()
  const env = PLAID_ENV.value() || "production"
  if (!clientId || !secret) {
    throw new Error("Missing PLAID_CLIENT_ID or PLAID_SECRET")
  }
  const configuration = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.production,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  })
  return new PlaidApi(configuration)
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry)) as T
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)])
    return Object.fromEntries(entries) as T
  }
  return value
}

function plaidItemsCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("plaidItems")
}

function pendingTransactionsCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("plaidPendingTransactions")
}

function merchantMemoryCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("plaidMerchantMemory")
}

function incomeMemoryCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("plaidIncomeMemory")
}

// Top-level id -> workspaceId lookup so the webhook handler (which only
// receives a Plaid item_id) can find the owning workspace in one read,
// instead of a Firestore collection-group query (which would need a
// dedicated composite index just for this one lookup).
function plaidItemIndexDoc(itemId: string) {
  return db.collection("plaidItemIndex").doc(itemId)
}

// Transactions webhooks (SYNC_UPDATES_AVAILABLE) aren't configured via the
// Plaid dashboard — that page only lists Transfer/Wallet/Income products.
// Instead the URL is set programmatically on the Item, via this `webhook`
// field at Link-token creation, following the same hardcoded-Cloud-Run-URL
// convention the frontend uses in lib/api/core/endpoints.ts.
const PLAID_WEBHOOK_URL = "https://plaidwebhook-3lc2fwdgwq-uc.a.run.app"
// Must exactly match an allowed redirect URI configured in the Plaid
// Dashboard (no wildcard here — wildcards are only valid in the dashboard
// allowlist, not in this API call). This is where OAuth-based institutions
// (Chase, and a growing list of others) redirect the browser back to after
// the user authenticates with their bank — see frontend/app/plaid-link/page.tsx,
// which resumes the Link flow from this exact URL via receivedRedirectUri.
const PLAID_OAUTH_REDIRECT_URI = "https://stackin.web.app/plaid-link"

export async function createLinkToken(uid: string): Promise<{ link_token: string }> {
  const plaid = getPlaidClient()
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: uid },
    client_name: "521",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: PLAID_WEBHOOK_URL,
    redirect_uri: PLAID_OAUTH_REDIRECT_URI,
  })
  return { link_token: response.data.link_token }
}

// Update mode — repairs an existing, broken Item (e.g. after the user
// changed their bank password, triggering ITEM_LOGIN_REQUIRED) in place,
// rather than the normal createLinkToken flow above, which always creates a
// brand-new Item. Passing access_token instead of products is what puts
// Link into update mode; no new access token is issued on success (Plaid
// marks the existing one healthy again), so there's nothing to exchange —
// the ITEM/LOGIN_REPAIRED webhook (see handleItemWebhook) is what updates
// this item's status back to active once the user completes it.
export async function createUpdateLinkToken(
  workspaceId: string,
  uid: string,
  itemId: string
): Promise<{ link_token: string }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await plaidItemsCol(workspaceId).doc(itemId).get()
  if (!snap.exists) throw new NotFoundError("Linked bank account not found")
  const item = PlaidItemSchema.parse(snap.data())

  const plaid = getPlaidClient()
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: uid },
    client_name: "521",
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: PLAID_WEBHOOK_URL,
    redirect_uri: PLAID_OAUTH_REDIRECT_URI,
    access_token: decryptToken(item.accessTokenEncrypted, PLAID_TOKEN_ENCRYPTION_KEY.value()),
  })
  return { link_token: response.data.link_token }
}

// Compares against Plaid Link's own onSuccess metadata (institution_id +
// each account's name/mask) rather than anything fetched after exchange —
// the whole point is to catch a duplicate before the exchange call ever
// happens, so a duplicate Item is never created in the first place instead
// of being created and then cleaned up. Per Plaid's own guidance, name+mask
// is the right pair to compare (never mask against a real account number —
// this only ever compares mask to another mask from the same source).
// Scoped to this one workspace: the same real bank account legitimately
// showing up in two of a user's workspaces (e.g. two businesses sharing one
// account) is not a duplicate worth blocking.
async function findDuplicateLinkedAccount(
  workspaceId: string,
  institutionId: string,
  accounts: Array<{ name: string; mask: string | null }>
): Promise<boolean> {
  const existingSnap = await plaidItemsCol(workspaceId).where("institutionId", "==", institutionId).get()
  for (const doc of existingSnap.docs) {
    const parsed = PlaidItemSchema.safeParse(doc.data())
    if (!parsed.success) continue
    const isMatch = parsed.data.linkedAccounts.some((existingAccount) =>
      accounts.some((newAccount) => newAccount.name === existingAccount.name && newAccount.mask === existingAccount.mask)
    )
    if (isMatch) return true
  }
  return false
}

export async function exchangePublicToken(
  workspaceId: string,
  uid: string,
  publicToken: string,
  linkMetadata: { institutionId: string | null; accounts: Array<{ name: string; mask: string | null }> }
): Promise<{ itemId: string }> {
  await assertWorkspaceMembership(workspaceId, uid)

  // Fail open, not closed, if this metadata is ever missing — this check is
  // about cost/UX (avoiding an accidental duplicate connection), not
  // security, so a missing institutionId should never block a legitimate
  // new connection from completing.
  if (linkMetadata.institutionId) {
    const isDuplicate = await findDuplicateLinkedAccount(workspaceId, linkMetadata.institutionId, linkMetadata.accounts)
    if (isDuplicate) {
      throw new ConflictError("This account is already connected to this workspace.")
    }
  }

  const plaid = getPlaidClient()

  const exchangeResponse = await plaid.itemPublicTokenExchange({ public_token: publicToken })
  const accessToken = exchangeResponse.data.access_token
  const itemId = exchangeResponse.data.item_id

  const accountsResponse = await plaid.accountsGet({ access_token: accessToken })
  const institutionId = accountsResponse.data.item.institution_id ?? null
  let institutionName: string | null = null
  if (institutionId) {
    try {
      const institutionResponse = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      })
      institutionName = institutionResponse.data.institution.name ?? null
    } catch {
      institutionName = null
    }
  }

  const nowIso = new Date().toISOString()
  const canonical: PlaidItemType = {
    id: itemId,
    workspaceId,
    linkOwnerUid: uid,
    institutionId,
    institutionName,
    accessTokenEncrypted: encryptToken(accessToken, PLAID_TOKEN_ENCRYPTION_KEY.value()),
    cursor: null,
    status: "active",
    linkedAccounts: accountsResponse.data.accounts.map((account) => ({
      accountId: account.account_id,
      name: account.name,
      mask: account.mask ?? null,
      type: account.type,
      subtype: account.subtype ?? null,
      defaultBusiness: null,
    })),
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSyncAt: null,
    lastError: null,
    lastStaleNotifiedAt: null,
    syncLockedAt: null,
  }
  const parsed = PlaidItemSchema.parse(canonical)
  await plaidItemsCol(workspaceId).doc(itemId).set(stripUndefinedDeep(parsed))
  await plaidItemIndexDoc(itemId).set({ workspaceId })
  return { itemId }
}

export async function getItems(workspaceId: string, uid: string) {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await plaidItemsCol(workspaceId).get()
  return snap.docs.map((doc) => PlaidItemPublicSchema.parse(PlaidItemSchema.parse(doc.data())))
}

// Called from account/workspace deletion (userDeletionService.ts) before the
// workspace's Firestore document tree is wiped. Without this, deleting a
// 521 workspace only ever removed our own copy of the (now-encrypted)
// access token — the underlying Plaid Item was never told to revoke, so the
// bank connection would stay live and authorized on Plaid's side forever,
// with no way to reach it again once our local record was gone. Best-effort
// per item: a Plaid outage or an already-revoked Item shouldn't block the
// rest of account deletion.
export async function revokePlaidItemsForWorkspace(workspaceId: string): Promise<void> {
  const snap = await plaidItemsCol(workspaceId).get()
  if (snap.empty) return
  const plaid = getPlaidClient()
  const key = PLAID_TOKEN_ENCRYPTION_KEY.value()
  await Promise.all(
    snap.docs.map(async (doc) => {
      try {
        const item = PlaidItemSchema.parse(doc.data())
        await plaid.itemRemove({ access_token: decryptToken(item.accessTokenEncrypted, key) })
      } catch (error) {
        console.warn("plaidService.revokePlaidItemsForWorkspace: failed to revoke item, continuing", {
          workspaceId,
          itemId: doc.id,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      // Lives at the top level (workspaces/{id}'s own recursiveDelete won't
      // reach it), so it's cleaned up here explicitly.
      await plaidItemIndexDoc(doc.id).delete().catch(() => {})
    })
  )
}

export async function unlinkItem(workspaceId: string, uid: string, itemId: string): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = plaidItemsCol(workspaceId).doc(itemId)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("Linked bank account not found")
  const item = PlaidItemSchema.parse(snap.data())

  const plaid = getPlaidClient()
  try {
    await plaid.itemRemove({ access_token: decryptToken(item.accessTokenEncrypted, PLAID_TOKEN_ENCRYPTION_KEY.value()) })
  } catch (error) {
    console.warn("plaidService.unlinkItem: Plaid item_remove failed, deleting local record anyway", {
      workspaceId,
      itemId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  await ref.delete()
  await plaidItemIndexDoc(itemId).delete()
}

async function findItemByPlaidItemId(itemId: string): Promise<{ workspaceId: string; item: PlaidItemType } | null> {
  const indexSnap = await plaidItemIndexDoc(itemId).get()
  const workspaceId = indexSnap.data()?.workspaceId
  if (typeof workspaceId !== "string") return null
  const itemSnap = await plaidItemsCol(workspaceId).doc(itemId).get()
  if (!itemSnap.exists) return null
  return { workspaceId, item: PlaidItemSchema.parse(itemSnap.data()) }
}

// Called from the plaidWebhook handler on Plaid's ITEM webhook type — the
// message Plaid sends when a credential needs re-auth (ERROR, most commonly
// error_code ITEM_LOGIN_REQUIRED) or has recovered (LOGIN_REPAIRED). Handling
// this in real time is the primary fix for stale connections; before this,
// status only ever flipped to "error" reactively, inside
// syncTransactionsForItem's catch block, whenever some other sync attempt
// happened to fail — this webhook is the signal Plaid already sends for
// exactly this situation, just previously ignored. flagStalePlaidItemsDaily
// (backend/functions/src/scheduled) is the fallback for when this webhook
// itself is delayed or dropped.
export async function handleItemWebhook(
  plaidItemId: string,
  webhookCode: string,
  error: { error_code?: string; error_message?: string } | null
): Promise<void> {
  const found = await findItemByPlaidItemId(plaidItemId)
  if (!found) return
  const { workspaceId, item } = found
  const ref = plaidItemsCol(workspaceId).doc(plaidItemId)
  const nowIso = new Date().toISOString()

  if (webhookCode === "ERROR") {
    await ref.set(
      {
        status: "error",
        lastError: error?.error_code ? `${error.error_code}: ${error.error_message ?? ""}`.trim() : "Plaid item error",
        updatedAt: nowIso,
      },
      { merge: true }
    )
    await sendTransactionNotification(item.linkOwnerUid, {
      title: "Reconnect your bank",
      body: `${item.institutionName ?? "A linked bank account"} needs your attention — new transactions have stopped syncing.`,
    })
    return
  }

  if (webhookCode === "LOGIN_REPAIRED") {
    await ref.set({ status: "active", lastError: null, lastStaleNotifiedAt: null, updatedAt: nowIso }, { merge: true })
  }
}

// Called from the plaidWebhook handler on a SYNC_UPDATES_AVAILABLE event
// (silent: false, no sinceDate — every new transaction notifies as it
// arrives), and from importPlaidHistory for a bulk backfill (silent: true,
// bounded by sinceDate — historical transactions land quietly in the review
// list instead of firing a notification burst).
// How long a sync lock (see below) is honored before being treated as
// abandoned. Generous relative to a normal sync run so a crashed/timed-out
// invocation can't wedge future webhooks indefinitely.
const SYNC_LOCK_STALE_MS = 5 * 60 * 1000

export async function syncTransactionsForItem(
  itemId: string,
  options: { silent?: boolean; sinceDate?: string } = {}
): Promise<{ added: number }> {
  const found = await findItemByPlaidItemId(itemId)
  if (!found) {
    console.warn("plaidService.syncTransactionsForItem: no local plaidItem for Plaid item_id", { itemId })
    return { added: 0 }
  }
  const { workspaceId, item } = found
  const plaid = getPlaidClient()
  const itemRef = plaidItemsCol(workspaceId).doc(itemId)

  // Plaid can (and does) deliver more than one webhook for the same
  // underlying change — e.g. SYNC_UPDATES_AVAILABLE alongside a legacy
  // DEFAULT_UPDATE — often within milliseconds of each other. Without this
  // lock, two concurrent invocations both read the same not-yet-advanced
  // cursor, both pull the same "added" transactions from Plaid, and each
  // independently fires a push notification — the simultaneous duplicate
  // users see. The lock serializes runs per item so the second delivery
  // simply no-ops once the first has already processed the update.
  const lockAcquired = await db.runTransaction(async (txn) => {
    const snap = await txn.get(itemRef)
    const lockedAtIso = (snap.data() as { syncLockedAt?: string | null } | undefined)?.syncLockedAt
    const lockedAtMs = lockedAtIso ? Date.parse(lockedAtIso) : null
    if (lockedAtMs !== null && Date.now() - lockedAtMs < SYNC_LOCK_STALE_MS) return false
    txn.set(itemRef, { syncLockedAt: new Date().toISOString() }, { merge: true })
    return true
  })
  if (!lockAcquired) {
    console.info("plaidService.syncTransactionsForItem: sync already in progress for item, skipping duplicate trigger", { itemId })
    return { added: 0 }
  }

  // A null cursor means this is the very first sync for the item — the same
  // "everything since the beginning of Plaid's history for this account"
  // pull as a manual importPlaidHistory call, just triggered automatically
  // by the initial post-link webhook instead of a button press. Treat it the
  // same way (silent) unless the caller explicitly overrides — otherwise
  // linking an account with months of history fires a notification for
  // every past transaction the moment it's connected.
  const isInitialSync = item.cursor == null
  const silent = options.silent ?? isInitialSync

  let cursor = item.cursor ?? undefined
  let addedCount = 0
  let hasMore = true
  // Collected across the whole sync run (which can span several Plaid
  // pages) instead of notifying inline per transaction — see the
  // single-vs-batched send below the loop.
  const notifiable: PlaidPendingTransactionType[] = []

  try {
    while (hasMore) {
      const response = await plaid.transactionsSync({
        access_token: decryptToken(item.accessTokenEncrypted, PLAID_TOKEN_ENCRYPTION_KEY.value()),
        cursor,
      })
      for (const transaction of response.data.added) {
        if (options.sinceDate && transaction.date < options.sinceDate) continue
        const created = await upsertPendingTransactionFromPlaid(workspaceId, itemId, transaction, item.linkedAccounts)
        if (created) notifiable.push(created)
        addedCount += 1
      }
      // A pending charge that later posts arrives as a *removed* pending
      // transaction_id plus a *new* added transaction linked via
      // pending_transaction_id — handled inside
      // upsertPendingTransactionFromPlaid above, which carries the prior
      // decision forward instead of notifying twice for the same purchase.
      // What's left here is the rarer case: a removal with no replacement
      // in this same batch at all (e.g. a card authorization hold that got
      // reversed rather than posted) — nothing to carry forward, just clean up.
      for (const removed of response.data.removed) {
        const removedId = removed.transaction_id
        if (!removedId) continue
        const hasReplacement = response.data.added.some((added) => added.pending_transaction_id === removedId)
        if (hasReplacement) continue
        await cleanupRemovedTransaction(workspaceId, itemId, removedId)
      }
      cursor = response.data.next_cursor
      hasMore = response.data.has_more
      // Persist progress after every page, not just once the whole loop
      // finishes — a multi-month backfill can span many pages and take
      // longer than one function invocation allows. Without this, a
      // mid-loop timeout forces the next attempt to redo everything from
      // scratch instead of resuming (this is what made the first resync
      // take three tries).
      await itemRef.set({ cursor: cursor ?? null }, { merge: true })
    }
    await itemRef.set(
      {
        status: "active",
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        // A successful sync means the connection isn't stale anymore —
        // reset the throttle so a future staleness episode notifies fresh
        // instead of inheriting an old cooldown window.
        lastStaleNotifiedAt: null,
      },
      { merge: true }
    )

    console.info("plaidService.syncTransactionsForItem: notify gate", {
      itemId,
      addedCount,
      notifiableCount: notifiable.length,
      silent,
      isInitialSync,
    })
    if (!silent && notifiable.length > 0) {
      await notifyForSyncResults(workspaceId, itemId, notifiable)
    }
  } catch (error) {
    await itemRef.set(
      {
        status: "error",
        lastError: error instanceof Error ? error.message : String(error),
      },
      { merge: true }
    )
    throw error
  } finally {
    await itemRef.set({ syncLockedAt: null }, { merge: true })
  }
  return { added: addedCount }
}

// Bulk historical backfill, bounded to the last N months (default 3).
// Plaid's real-time webhook detection can lag by hours to days, and some
// institutions (Capital One included) never report pending transactions at
// all — so this is how a user gets their recent spending into 521
// immediately instead of waiting on live detection. Runs silently (no push
// notification per transaction, see syncTransactionsForItem) since a
// multi-month import can be dozens of transactions at once; they land in
// the pending review list for the user to work through at their own pace.
// Ongoing new transactions after this still notify individually as normal,
// via the webhook -> syncTransactionsForItem(itemId) path (no options).
export async function importPlaidHistory(
  workspaceId: string,
  uid: string,
  itemId: string,
  months = 3
): Promise<{ added: number }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = plaidItemsCol(workspaceId).doc(itemId)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("Linked bank account not found")
  await ref.set({ cursor: null }, { merge: true })
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const sinceDate = cutoff.toISOString().slice(0, 10)
  return syncTransactionsForItem(itemId, { silent: true, sinceDate })
}


async function getLinkOwnerUid(workspaceId: string, plaidItemId: string): Promise<string | null> {
  const itemSnap = await plaidItemsCol(workspaceId).doc(plaidItemId).get()
  return itemSnap.exists ? PlaidItemSchema.parse(itemSnap.data()).linkOwnerUid : null
}

// Returns the created pending transaction when it's worth notifying about
// (a genuinely new, non-auto-dismissed transaction), or null otherwise.
// Notification sending itself happens in syncTransactionsForItem, once per
// sync run rather than inline here — see notifyForSyncResults below.
async function upsertPendingTransactionFromPlaid(
  workspaceId: string,
  plaidItemId: string,
  transaction: Record<string, any>,
  linkedAccounts: PlaidLinkedAccountType[]
): Promise<PlaidPendingTransactionType | null> {
  const priorId: string | undefined = transaction.pending_transaction_id ?? undefined
  const priorSnap = priorId ? await pendingTransactionsCol(workspaceId).doc(priorId).get() : null
  const prior = priorSnap?.exists ? PlaidPendingTransactionSchema.parse(priorSnap.data()) : null

  if (prior) {
    // Same real-world purchase, just surfacing under a new transaction_id
    // now that it's posted — Plaid tells us this explicitly via
    // pending_transaction_id (and lists the old id in `removed`). Carry the
    // prior outcome forward instead of treating it as a new transaction:
    // never a second notification for the same charge, period.
    await carryForwardTransaction(workspaceId, plaidItemId, transaction, prior)
    await pendingTransactionsCol(workspaceId).doc(prior.id).delete()
    return null
  }

  // A re-sync of a transaction_id we've already written — most commonly a
  // second historical import (importPlaidHistory resets the cursor, so it
  // re-fetches everything in range again) or a rare Plaid re-delivery —
  // must not clobber a decision the user already made. Without this check,
  // the unconditional write below would recompute status fresh from current
  // merchant memory and reset an already-dismissed or already-confirmed
  // transaction back to "pending" under a brand-new createdAt, resurrecting
  // the exact same transaction in the review list.
  const existingSnap = await pendingTransactionsCol(workspaceId).doc(transaction.transaction_id).get()
  const existing = existingSnap.exists
    ? PlaidPendingTransactionSchema.parse(existingSnap.data())
    : null
  if (existing && existing.status !== "pending") {
    return null
  }

  const merchantName = transaction.merchant_name ?? null
  const rawName = transaction.name ?? ""
  const direction = plaidDirectionFromAmount(transaction.amount)
  const amount = Math.abs(transaction.amount)
  const personalFinanceCategoryPrimary: string | null = transaction.personal_finance_category?.primary ?? null
  const expenseMerchantKey = await resolveMerchantKey(workspaceId, merchantName, rawName)
  // Money in from a merchant is a refund, not income — checked before
  // anything else, so a card refund isn't taken for a card payment either.
  const refundOf =
    direction === "income" && !isPeerToPeerDescriptor(merchantName, rawName)
      ? await findRefundedPurchase(workspaceId, expenseMerchantKey, { date: transaction.date, amount })
      : null
  const isRefund = isLikelyPlaidRefund({
    merchantName,
    rawName,
    personalFinanceCategoryPrimary,
    direction,
    hasMatchingPurchase: refundOf !== null,
  })
  // Deposits are keyed by payer for income memory (see
  // normalizePlaidPayerKey); spending and refunds keep the merchant key, so
  // a refund lines up with the merchant's purchases.
  const merchantKey = direction === "income" && !isRefund
    ? normalizePlaidPayerKey(merchantName, rawName)
    : expenseMerchantKey
  const linkedAccount = linkedAccounts.find((account) => account.accountId === transaction.account_id) ?? null
  const personalFinanceCategoryDetailed: string | null = transaction.personal_finance_category?.detailed ?? null
  const transferSignal = classifyPlaidTransferSignal({
    merchantName,
    rawName,
    personalFinanceCategoryPrimary,
    personalFinanceCategoryDetailed,
    direction,
    accountType: linkedAccount?.type ?? null,
    isRefund,
  })

  // A learned decision from a past confirm/dismiss on this same merchant
  // takes priority over the generic rule-based guess — see
  // confirmPendingTransaction below, which writes this memory.
  //
  // Merchant memory and the expense classifier only describe money going
  // out, so a deposit skips both. The same merchant key often covers both
  // directions (payments sent through Venmo vs. a Venmo cash-out), and an
  // "always personal" Venmo decision must not silently swallow incoming
  // client payments.
  // A refund is spending in reverse, so it reads the merchant's expense memory.
  const usesExpenseMemory = direction === "expense" || isRefund
  const memory = usesExpenseMemory && merchantKey ? await getMerchantMemory(workspaceId, merchantKey) : null
  // Deposits have their own memory, keyed by payer — see PlaidIncomeMemorySchema.
  const incomeMemory = direction === "income" && !isRefund && merchantKey ? await getIncomeMemory(workspaceId, merchantKey) : null
  const classification: PlaidClassificationResult = isRefund
    ? await classifyRefund(workspaceId, refundOf, memory, {
        merchantName,
        rawName,
        personalFinanceCategoryPrimary,
        amount,
      })
    : direction === "income"
    ? {
        suggestedExpenseAccount: null,
        isBusinessGuess: incomeMemory ? incomeMemory.lastOutcome === "income" : null,
        confidence: incomeMemory ? 0.95 : 0,
      }
    : memory
    ? { suggestedExpenseAccount: memory.expenseCategory, isBusinessGuess: memory.isBusiness, confidence: 0.95 }
    : applyAccountDefault(
        classifyPlaidTransaction({
          merchantName,
          rawName,
          personalFinanceCategoryPrimary: transaction.personal_finance_category?.primary ?? null,
          amount: transaction.amount,
        }),
        linkedAccount?.defaultBusiness ?? null
      )
  // Explicit opt-in only (see PlaidMerchantMemorySchema) — the transaction
  // still gets recorded, just pre-dismissed and silent, so a rare business
  // purchase at an otherwise-personal merchant isn't lost, only unnoticed
  // unless the user goes looking for it. "covered_by_recurring_rule" gets the
  // same silent treatment: the recurring rule's cron already generates this
  // merchant's expense on schedule, so confirming the bank transaction too
  // would book the same real-world charge twice.
  // A refund from an "always personal" merchant is money back on a personal
  // purchase — unless it matched a purchase that was booked as business.
  // A recurring-rule merchant's refund still needs review: the rule booked
  // the original charge, so the refund should reduce it.
  const memoryDismiss = isRefund
    ? memory?.mode === "always_personal" && !refundOf
    : memory?.mode === "always_personal" ||
      memory?.mode === "covered_by_recurring_rule" ||
      incomeMemory?.mode === "always_not_income"

  // Transfers between the user's own accounts are neither income nor
  // expense — dismissed silently, like memoryDismiss above. A strong signal
  // stands alone; anything weaker needs the other half of the transfer on
  // another linked account (which also gets dismissed, if still pending).
  // A user who restored this one from Hidden Transfers has overruled
  // detection — a re-sync or history re-import must not hide it again.
  const transferPairId = transferSignal && !existing?.transferOverride
    ? await pairWithTransferCounterpart(workspaceId, {
        id: transaction.transaction_id,
        accountId: transaction.account_id,
        direction,
        amount,
        date: transaction.date,
        transferSignal,
      })
    : null
  // A Venmo cash-out is only a transfer when the Venmo statement is the
  // workspace's source for Venmo income — see isVenmoCashoutDescriptor.
  const isVenmoCashout = isVenmoCashoutDescriptor(merchantName, rawName, direction)
  const venmoCashoutIsTransfer =
    isVenmoCashout && !existing?.transferOverride && (await workspaceImportsVenmoStatements(workspaceId))
  const isTransfer =
    !existing?.transferOverride && (transferSignal === "transfer" || transferPairId !== null || venmoCashoutIsTransfer)
  const autoDismiss = memoryDismiss || isTransfer

  const nowIso = new Date().toISOString()
  const pending: PlaidPendingTransactionType = {
    id: transaction.transaction_id,
    workspaceId,
    plaidItemId,
    plaidTransactionId: transaction.transaction_id,
    accountId: transaction.account_id,
    date: transaction.date,
    amount,
    direction,
    merchantName,
    rawName,
    merchantKey,
    personalFinanceCategoryPrimary,
    personalFinanceCategoryDetailed,
    transferSignal,
    isVenmoCashout,
    isRefund,
    refundOf,
    suggestedExpenseAccount: classification.suggestedExpenseAccount,
    suggestedIncomeCategory: incomeMemory?.lastOutcome === "income" ? incomeMemory.incomeCategory : null,
    suggestedPaymentMethod:
      direction === "income" && !isRefund
        ? (incomeMemory?.lastOutcome === "income" ? incomeMemory.paymentMethod : null) ??
          suggestPlaidIncomePaymentMethod(merchantName, rawName)
        : null,
    suggestedIncomeLabel: suggestedIncomeLabelFor(direction, isRefund, incomeMemory, merchantName, rawName),
    isBusinessGuess: classification.isBusinessGuess,
    confidence: classification.confidence,
    isLikelyFuelPurchase: direction === "expense" && isLikelyFuelPurchase(merchantName ?? rawName),
    status: autoDismiss ? "dismissed" : "pending",
    ...(isTransfer ? { dismissReason: "transfer" as const } : {}),
    ...(transferPairId ? { transferPairId } : {}),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }
  const parsed = PlaidPendingTransactionSchema.parse(pending)
  await pendingTransactionsCol(workspaceId).doc(parsed.id).set(stripUndefinedDeep(parsed), { merge: true })

  return autoDismiss ? null : parsed
}

// The purchase a refund most likely reverses, among this merchant's
// confirmed bank purchases — see pickRefundedPurchase. Same
// (merchantKey, status, date) query shape detectRecurringSuggestion uses,
// so it runs on the existing composite index.
async function findRefundedPurchase(
  workspaceId: string,
  merchantKey: string,
  refund: { date: string; amount: number }
): Promise<PlaidPendingTransactionType["refundOf"]> {
  if (!merchantKey) return null
  const snap = await pendingTransactionsCol(workspaceId)
    .where("merchantKey", "==", merchantKey)
    .where("status", "==", "confirmed")
    .orderBy("date", "desc")
    .limit(20)
    .get()
  const purchases = snap.docs
    .map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
    .filter((t) => t.direction === "expense" && !t.isRefund && t.committedExpenseId)
  const picked = pickRefundedPurchase(refund, purchases)
  if (!picked?.committedExpenseId) return null
  return { pendingId: picked.id, expenseId: picked.committedExpenseId, date: picked.date, amount: picked.amount }
}

// A refund is booked in the same category as what it reverses: the matched
// purchase's actual expense category if there is one, then the merchant's
// remembered category, then the generic classifier.
async function classifyRefund(
  workspaceId: string,
  refundOf: PlaidPendingTransactionType["refundOf"],
  memory: PlaidMerchantMemoryType | null,
  input: { merchantName: string | null; rawName: string; personalFinanceCategoryPrimary: string | null; amount: number }
): Promise<PlaidClassificationResult> {
  if (refundOf) {
    const expenseSnap = await db.doc(`workspaces/${workspaceId}/expenses/${refundOf.expenseId}`).get()
    const account = expenseSnap.exists ? (expenseSnap.data()?.account as string | undefined) : undefined
    if (account) return { suggestedExpenseAccount: account, isBusinessGuess: true, confidence: 0.95 }
  }
  if (memory) {
    return { suggestedExpenseAccount: memory.expenseCategory, isBusinessGuess: memory.isBusiness, confidence: 0.8 }
  }
  return classifyPlaidTransaction(input)
}

async function workspaceImportsVenmoStatements(workspaceId: string): Promise<boolean> {
  const snap = await db
    .collection(`workspaces/${workspaceId}/importBatches`)
    .where("source", "==", "venmo_csv")
    .limit(1)
    .get()
  return !snap.empty
}

// Bank cash-outs can land a few days after the Venmo payments they carry.
const VENMO_CASHOUT_TRAILING_DAYS = 7

// Called right after a Venmo statement is imported (importsService
// createImportBatch). From now on the statement is where Venmo income comes
// from, so:
// - cash-outs still waiting in review are hidden as transfers (restorable
//   from Hidden Transfers, like any other transfer), and
// - cash-outs already confirmed as income in the statement's period are
//   returned, so the import can warn that confirming the statement's
//   payments too would count that money twice. Nothing booked is undone
//   automatically: which side to keep is the user's call.
export async function reconcileVenmoCashoutsWithImport(
  workspaceId: string,
  period: { start: string; end: string } | null
): Promise<{ count: number; total: number; deposits: Array<{ date: string; amount: number }> }> {
  const snap = await pendingTransactionsCol(workspaceId).where("isVenmoCashout", "==", true).get()
  const records = snap.docs.map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
  const nowIso = new Date().toISOString()

  const writer = db.batch()
  let hiddenCount = 0
  for (const record of records) {
    if (record.status !== "pending" || record.transferOverride) continue
    writer.set(
      pendingTransactionsCol(workspaceId).doc(record.id),
      { status: "dismissed", dismissReason: "transfer", updatedAt: nowIso },
      { merge: true }
    )
    hiddenCount += 1
  }
  if (hiddenCount > 0) await writer.commit()

  if (!period) return { count: 0, total: 0, deposits: [] }
  const trailingEnd = new Date(`${period.end}T12:00:00Z`)
  trailingEnd.setUTCDate(trailingEnd.getUTCDate() + VENMO_CASHOUT_TRAILING_DAYS)
  const windowEnd = trailingEnd.toISOString().slice(0, 10)
  const overlapping = records
    .filter((r) => r.status === "confirmed" && r.committedEntryId && r.date >= period.start && r.date <= windowEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  return {
    count: overlapping.length,
    total: Math.round(overlapping.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    deposits: overlapping.map((r) => ({ date: r.date, amount: r.amount })),
  }
}

// Looks for the other half of a transfer: an opposite-direction transaction
// of the same amount, on a different linked account, a few days apart — see
// isPlaidTransferPair. When found, that transaction is dismissed too (unless
// the user already confirmed it as real income/expense, in which case their
// decision wins and nothing pairs). Returns the counterpart's id, or null.
//
// Amounts are stored as positive magnitudes, so an equality query on amount
// finds candidates from both directions. Records from before the direction
// split stored signed amounts and no transferSignal, so they never match.
async function pairWithTransferCounterpart(
  workspaceId: string,
  incoming: {
    id: string
    accountId: string
    direction: PlaidPendingTransactionType["direction"]
    amount: number
    date: string
    transferSignal: NonNullable<PlaidPendingTransactionType["transferSignal"]>
  }
): Promise<string | null> {
  const snap = await pendingTransactionsCol(workspaceId).where("amount", "==", incoming.amount).limit(25).get()
  const candidates = snap.docs
    .map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
    .filter(
      (candidate) =>
        candidate.id !== incoming.id &&
        !candidate.transferPairId &&
        !candidate.transferOverride &&
        (candidate.status === "pending" || candidate.status === "dismissed") &&
        isPlaidTransferPair(candidate, incoming)
    )
    // Closest date first — the likeliest other half when several match.
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.date) - Date.parse(incoming.date)) - Math.abs(Date.parse(b.date) - Date.parse(incoming.date))
    )

  for (const candidate of candidates) {
    const ref = pendingTransactionsCol(workspaceId).doc(candidate.id)
    const paired = await db.runTransaction(async (txn) => {
      const current = await txn.get(ref)
      if (!current.exists) return false
      const fresh = PlaidPendingTransactionSchema.parse(current.data())
      // Re-checked inside the transaction: the user may have confirmed it,
      // or another transfer may have claimed it, since the query above.
      if (fresh.transferPairId || fresh.transferOverride || (fresh.status !== "pending" && fresh.status !== "dismissed")) {
        return false
      }
      txn.set(
        ref,
        {
          status: "dismissed",
          // A user's own earlier dismissal keeps its (absent) reason.
          ...(fresh.status === "pending" ? { dismissReason: "transfer" } : {}),
          transferPairId: incoming.id,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
      return true
    })
    if (paired) return candidate.id
  }
  return null
}

// One notification per sync run, not one per transaction — a single sync
// call can pick up several transactions at once (Plaid's own refresh cycle
// lags anywhere from ~6 hours to multiple days, so purchases commonly batch
// up between syncs), and firing a notification per transaction in that case
// reads as a spam burst. A single new transaction still gets the specific,
// informative notification (vendor + amount, deep-linked straight to it).
async function notifyForSyncResults(
  workspaceId: string,
  plaidItemId: string,
  notifiable: PlaidPendingTransactionType[]
): Promise<void> {
  const uid = await getLinkOwnerUid(workspaceId, plaidItemId)
  if (!uid) {
    console.warn("plaidService.notifyForSyncResults: no linkOwnerUid found, nothing sent", { workspaceId, plaidItemId })
    return
  }

  if (notifiable.length === 1) {
    const parsed = notifiable[0]
    await sendTransactionNotification(uid, {
      title: resolvePlaidDisplayName(parsed.merchantName, parsed.rawName),
      body: parsed.isRefund
        ? `Refund: $${parsed.amount.toFixed(2)}${parsed.suggestedExpenseAccount ? ` • ${parsed.suggestedExpenseAccount}` : ""}`
        : parsed.direction === "income"
          ? parsed.suggestedIncomeCategory
            ? `Money in: $${parsed.amount.toFixed(2)} • ${INCOME_CATEGORY_LABELS[parsed.suggestedIncomeCategory]}`
            : `Money in: $${parsed.amount.toFixed(2)} — confirm if it's income`
          : `New transaction: $${parsed.amount.toFixed(2)}${parsed.suggestedExpenseAccount ? ` • ${parsed.suggestedExpenseAccount}` : ""}`,
      // registerPush.ts lands income links on the Income tab, everything
      // else on Expenses — in this workspace, which may not be the one the
      // app was last left on.
      data: {
        workspaceId,
        deepLink:
          parsed.direction === "income" && !parsed.isRefund
            ? `stackin://plaid/pending-income/${parsed.id}`
            : `stackin://plaid/pending/${parsed.id}`,
      },
    })
    return
  }

  // Expenses and refunds are reviewed on Expenses, deposits on Income. A
  // mixed batch opens Expenses (see the deepLink below), so name both —
  // the Income tab's count badge shows where the deposits are.
  const depositCount = notifiable.filter((t) => t.direction === "income" && !t.isRefund).length
  const expenseCount = notifiable.length - depositCount
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
  await sendTransactionNotification(uid, {
    title: "New bank transactions to review",
    body:
      depositCount > 0 && expenseCount > 0
        ? `${plural(expenseCount, "expense")} and ${plural(depositCount, "deposit")} are ready to review in 521.`
        : `${notifiable.length} new transactions are ready to review in 521.`,
    // No specific id — same startsWith("stackin://plaid/pending/") prefix
    // registerPush.ts already matches, so tapping still lands on the
    // Expenses tab where the whole batch is waiting. An all-income batch
    // lands on the Income tab instead.
    data: {
      workspaceId,
      deepLink: notifiable.every((t) => t.direction === "income" && !t.isRefund)
        ? "stackin://plaid/pending-income/"
        : "stackin://plaid/pending/",
    },
  })
}

const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  services: "Services",
  tips: "Tips",
  products: "Products",
  other: "Other income",
}

// Only overrides isBusinessGuess (not the suggested category) — a per-account
// default is a blanket "this account is business/personal" prior, weaker
// than the merchant-specific evidence in plaidMerchantMemory, so it never
// runs when memory already answered (see the caller above), and it still
// only raises confidence, never invents a category the generic classifier
// didn't find.
function applyAccountDefault(
  classification: PlaidClassificationResult,
  accountDefault: boolean | null
): PlaidClassificationResult {
  if (accountDefault === null) return classification
  return {
    ...classification,
    isBusinessGuess: accountDefault,
    confidence: Math.max(classification.confidence, 0.9),
  }
}

export async function updateLinkedAccountDefault(
  workspaceId: string,
  uid: string,
  itemId: string,
  accountId: string,
  defaultBusiness: boolean | null
): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = plaidItemsCol(workspaceId).doc(itemId)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("Linked bank account not found")
  const item = PlaidItemSchema.parse(snap.data())
  const accountIndex = item.linkedAccounts.findIndex((account) => account.accountId === accountId)
  if (accountIndex === -1) throw new NotFoundError("Linked account not found on this item")

  const linkedAccounts = item.linkedAccounts.map((account, index) =>
    index === accountIndex ? { ...account, defaultBusiness } : account
  )
  await ref.set({ linkedAccounts, updatedAt: new Date().toISOString() }, { merge: true })
}

async function carryForwardTransaction(
  workspaceId: string,
  plaidItemId: string,
  transaction: Record<string, any>,
  prior: PlaidPendingTransactionType
): Promise<void> {
  const nowIso = new Date().toISOString()
  const updated: PlaidPendingTransactionType = {
    ...prior,
    id: transaction.transaction_id,
    plaidTransactionId: transaction.transaction_id,
    accountId: transaction.account_id,
    date: transaction.date,
    amount: Math.abs(transaction.amount),
    // Plaid often has cleaner merchant data once a charge posts — worth
    // refreshing for display, but this never re-triggers classification or
    // a notification; the user already saw (or chose to ignore) this charge.
    merchantName: transaction.merchant_name ?? prior.merchantName,
    rawName: transaction.name ?? prior.rawName,
    personalFinanceCategoryPrimary: transaction.personal_finance_category?.primary ?? prior.personalFinanceCategoryPrimary,
    updatedAt: nowIso,
  }
  await pendingTransactionsCol(workspaceId).doc(updated.id).set(stripUndefinedDeep(PlaidPendingTransactionSchema.parse(updated)))

  if (prior.status === "confirmed" && prior.committedExpenseId) {
    // The posted amount/date can differ slightly from the pending hold
    // (tips, fuel pump pre-auths, etc) — keep the already-created expense in
    // sync rather than leaving it stale or creating a second one.
    const uid = await getLinkOwnerUid(workspaceId, plaidItemId)
    if (uid) {
      try {
        // A refund's expense is negative — keep it that way.
        const magnitude = Math.abs(transaction.amount)
        await expensesSvc.updateExpense(workspaceId, uid, prior.committedExpenseId, {
          date: transaction.date,
          amount: prior.isRefund ? -magnitude : magnitude,
        })
      } catch (error) {
        console.warn("plaidService.carryForwardTransaction: failed to refresh committed expense after posting", {
          workspaceId,
          expenseId: prior.committedExpenseId,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  if (prior.status === "confirmed" && prior.committedEntryId && prior.amount !== updated.amount) {
    // Deposits rarely change between pending and posted, and an entry's
    // amount lives inside a user-chosen category breakdown that can't be
    // rescaled safely here — surface it in logs rather than guess.
    console.warn("plaidService.carryForwardTransaction: confirmed income amount changed after posting", {
      workspaceId,
      entryId: prior.committedEntryId,
      priorAmount: prior.amount,
      postedAmount: updated.amount,
    })
  }
}

async function cleanupRemovedTransaction(workspaceId: string, plaidItemId: string, transactionId: string): Promise<void> {
  const ref = pendingTransactionsCol(workspaceId).doc(transactionId)
  const snap = await ref.get()
  if (!snap.exists) return
  const existing = PlaidPendingTransactionSchema.parse(snap.data())
  if (existing.status === "pending") {
    // Nothing was ever committed — safe to just remove (e.g. a card
    // authorization hold that was reversed rather than posted).
    await ref.delete()
    return
  }
  if (existing.status === "confirmed" && existing.committedEntryId) {
    // Confirmed income the bank later reversed. Entries have no flag field
    // to surface this on, and auto-deleting would destroy the audit trail.
    console.warn("plaidService.cleanupRemovedTransaction: confirmed income was reversed by the bank", {
      workspaceId,
      transactionId,
      committedEntryId: existing.committedEntryId,
    })
    return
  }
  if (existing.status !== "confirmed" || !existing.committedExpenseId) {
    // Dismissed — no financial record exists for this transaction, so
    // there's nothing to flag. Leave the pending doc as-is.
    return
  }
  // Already confirmed into a real expense, and the bank has since removed
  // this transaction with no replacement (a reversal, a hold that never
  // settled, a duplicate the bank itself caught). Never auto-delete the
  // expense — that destroys the audit trail — but the user has no way to
  // know their P&L now overstates a deduction that never happened unless
  // this is surfaced somewhere they'll actually see it.
  const uid = await getLinkOwnerUid(workspaceId, plaidItemId)
  if (!uid) {
    console.warn("plaidService.cleanupRemovedTransaction: no linkOwnerUid, can't flag expense", {
      workspaceId,
      transactionId,
      committedExpenseId: existing.committedExpenseId,
    })
    return
  }
  try {
    await expensesSvc.updateExpense(workspaceId, uid, existing.committedExpenseId, {
      flaggedReason: "bank_reversed",
    })
  } catch (error) {
    console.warn("plaidService.cleanupRemovedTransaction: failed to flag expense after bank reversal", {
      workspaceId,
      transactionId,
      committedExpenseId: existing.committedExpenseId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The merchant key to use for a transaction. Raw (un-enriched) descriptors
 * used to have their digits stripped; they now keep them. A merchant whose
 * memory was saved under the old key keeps using it, so earlier decisions
 * ("always personal", recurring-rule links, categories) still apply and
 * no migration is needed. Only costs extra reads when the two keys differ.
 */
async function resolveMerchantKey(workspaceId: string, merchantName: string | null, rawName: string): Promise<string> {
  const key = normalizePlaidMerchantKey(merchantName, rawName)
  const legacyKey = legacyPlaidMerchantKey(merchantName, rawName)
  if (!legacyKey || legacyKey === key) return key
  if (key && (await merchantMemoryCol(workspaceId).doc(key).get()).exists) return key
  if ((await merchantMemoryCol(workspaceId).doc(legacyKey).get()).exists) return legacyKey
  return key
}

async function getMerchantMemory(workspaceId: string, merchantKey: string): Promise<PlaidMerchantMemoryType | null> {
  // Some descriptors normalize to an empty key (e.g. a masked "****1234"
  // raw name); Firestore throws on .doc(""), so there's no memory to find.
  if (!merchantKey) return null
  const snap = await merchantMemoryCol(workspaceId).doc(merchantKey).get()
  if (!snap.exists) return null
  return PlaidMerchantMemorySchema.parse(snap.data())
}

async function rememberMerchantDecision(
  workspaceId: string,
  merchantKey: string,
  displayName: string,
  isBusiness: boolean,
  expenseCategory: string | null,
  mode: "ask_every_time" | "always_personal"
): Promise<void> {
  if (!merchantKey) return
  const ref = merchantMemoryCol(workspaceId).doc(merchantKey)
  // A bulk dismiss/confirm across several transactions from the same
  // merchant (e.g. "All Starbucks (8)") runs up to BULK_CONCURRENCY
  // decisions on this exact doc at once — a plain read-then-write would lose
  // increments to decisionCount under that concurrency. runTransaction
  // makes the read-modify-write atomic so nothing gets dropped.
  await db.runTransaction(async (txn) => {
    const existing = await txn.get(ref)
    const nowIso = new Date().toISOString()
    const canonical: PlaidMerchantMemoryType = {
      id: merchantKey,
      workspaceId,
      merchantKey,
      displayName,
      isBusiness,
      expenseCategory,
      mode,
      decisionCount: (existing.data()?.decisionCount ?? 0) + 1,
      lastDecisionAt: nowIso,
      createdAt: existing.exists ? (existing.data()?.createdAt ?? nowIso) : nowIso,
      updatedAt: nowIso,
    }
    txn.set(ref, PlaidMerchantMemorySchema.parse(canonical), { merge: true })
  })
}

// Lets a user see and correct what's been learned — without this, an
// accidental "Always treat as personal" (or a merchant that's genuinely
// mixed-use) had no fix short of a raw Firestore edit.
export async function listMerchantMemory(workspaceId: string, uid: string): Promise<PlaidMerchantMemoryType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await merchantMemoryCol(workspaceId).orderBy("updatedAt", "desc").get()
  return snap.docs.map((doc) => PlaidMerchantMemorySchema.parse(doc.data()))
}

export async function updateMerchantMemory(
  workspaceId: string,
  uid: string,
  merchantKey: string,
  patch: { mode?: "ask_every_time" | "always_personal"; expenseCategory?: string | null }
): Promise<PlaidMerchantMemoryType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = merchantMemoryCol(workspaceId).doc(merchantKey)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("No learned merchant found for this key")
  // A rule-linked merchant's mode is managed by the recurring-rule lifecycle
  // (markMerchantCoveredByRecurringRule / the rule being deleted), not this
  // manual editor — switching it here would silently desync it from the
  // rule that's actually generating its expenses.
  const existing = PlaidMerchantMemorySchema.parse(snap.data())
  if (existing.mode === "covered_by_recurring_rule") {
    throw new BadRequestError("This merchant is tied to a recurring rule — edit or delete the rule instead")
  }
  const nowIso = new Date().toISOString()
  await ref.set(
    {
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.expenseCategory !== undefined ? { expenseCategory: patch.expenseCategory } : {}),
      updatedAt: nowIso,
    },
    { merge: true }
  )
  const updated = await ref.get()
  return PlaidMerchantMemorySchema.parse(updated.data())
}

export async function resetMerchantMemory(workspaceId: string, uid: string, merchantKey: string): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  await merchantMemoryCol(workspaceId).doc(merchantKey).delete()
}

export async function getPendingTransactions(workspaceId: string, uid: string): Promise<PlaidPendingTransactionType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await pendingTransactionsCol(workspaceId).where("status", "==", "pending").get()
  return snap.docs.map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
}

export type PlaidRecurringSuggestion = {
  merchantKey: string
  cadence: RecurringCadence
  anchorDate: string
  vendor: string
  account: string
  amount: number
}

// Looks for prior *confirmed* transactions from this same merchant at a
// similar amount, spaced on a recognizable cadence — see
// shared/plaidClassification.ts's detectRecurringCadence. Only ever called
// right after this transaction's own confirm write, so it's included in the
// query results as one of the occurrences. Returns null (no suggestion)
// unless there's at least one prior match on top of this one.
async function detectRecurringSuggestion(
  workspaceId: string,
  merchantKey: string,
  currentAmount: number,
  vendor: string,
  account: string
): Promise<PlaidRecurringSuggestion | null> {
  if (!merchantKey) return null
  const snap = await pendingTransactionsCol(workspaceId)
    .where("merchantKey", "==", merchantKey)
    .where("status", "==", "confirmed")
    .orderBy("date", "desc")
    .limit(6)
    .get()
  const matchingDatesAscending = snap.docs
    .map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
    .filter((t) => t.direction === "expense" && isSimilarRecurringAmount(t.amount, currentAmount))
    .map((t) => t.date)
    .sort()
  if (matchingDatesAscending.length < 2) return null

  const cadence = detectRecurringCadence(matchingDatesAscending)
  if (!cadence) return null

  const lastDate = matchingDatesAscending[matchingDatesAscending.length - 1]
  return {
    merchantKey,
    cadence,
    anchorDate: projectNextFutureOccurrence(lastDate, cadence),
    vendor,
    account,
    amount: currentAmount,
  }
}

export type PlaidPersonalSuggestion = {
  merchantKey: string
  displayName: string
  dismissCount: number
}

// Below this, a plain dismiss stays completely silent — no "always vs just
// once" interruption. Once a merchant has been dismissed this many times,
// that's a real pattern worth a single, one-time offer to stop asking,
// instead of guessing "always?" on the very first dismissal the way the old
// per-dismiss prompt did.
const PERSONAL_SUGGESTION_DISMISS_THRESHOLD = 3

// Mirrors detectRecurringSuggestion above, but for the opposite signal.
// Only ever called right after this transaction's own dismiss write, so
// it's included in the dismissed-count query as one of the occurrences.
// Skips merchants that have ever been confirmed as business — a mixed-use
// merchant (sometimes personal, sometimes not) should keep asking every
// time, not get silenced just because it happens to also have a few
// personal charges mixed in.
async function detectPersonalSuggestion(
  workspaceId: string,
  merchantKey: string,
  displayName: string
): Promise<PlaidPersonalSuggestion | null> {
  if (!merchantKey) return null
  // Deposits share merchant keys with spending (a Venmo cash-out vs. a
  // Venmo payment) but say nothing about whether spending there is
  // personal, so only expense-direction records count. Filtered in memory
  // since legacy records have no direction field to query on; the wider
  // limit leaves room for deposits mixed into the results.
  // Auto-dismissed transfers aren't the user saying "personal" either.
  const isExpense = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const record = PlaidPendingTransactionSchema.parse(doc.data())
    return record.direction === "expense" && record.dismissReason !== "transfer"
  }
  const [dismissedSnap, confirmedSnap] = await Promise.all([
    pendingTransactionsCol(workspaceId)
      .where("merchantKey", "==", merchantKey)
      .where("status", "==", "dismissed")
      .limit(PERSONAL_SUGGESTION_DISMISS_THRESHOLD * 4)
      .get(),
    pendingTransactionsCol(workspaceId)
      .where("merchantKey", "==", merchantKey)
      .where("status", "==", "confirmed")
      .limit(10)
      .get(),
  ])
  const dismissCount = dismissedSnap.docs.filter(isExpense).length
  if (dismissCount < PERSONAL_SUGGESTION_DISMISS_THRESHOLD) return null
  if (confirmedSnap.docs.some(isExpense)) return null
  return { merchantKey, displayName, dismissCount }
}

// Written the moment the suggestion above is surfaced, regardless of how (or
// whether) the user answers it — this is what makes it fire once per
// merchant, ever, instead of on every dismiss once the threshold is met.
async function markPersonalSuggestionShown(workspaceId: string, merchantKey: string): Promise<void> {
  await merchantMemoryCol(workspaceId)
    .doc(merchantKey)
    .set({ suggestedAlwaysPersonalAt: new Date().toISOString() }, { merge: true })
}

// A bulk historical import can surface old transactions for confirmation
// well after the fact — if this merchant's occurrences being detected here
// are backdated, one cadence step past the last one might still land in the
// past. createRecurringRule treats a past-or-today anchorDate as "due now"
// and immediately generates its first expense, which would double-book the
// same charge this suggestion is trying to avoid duplicating. Step forward
// (using the original date as the day-of-month anchor throughout, so the
// eventual rule's cadence isn't shifted) until the projected date is
// strictly in the future.
function projectNextFutureOccurrence(lastDate: string, cadence: RecurringCadence): string {
  const todayStr = new Date().toISOString().slice(0, 10)
  let next = computeNextOccurrence(lastDate, cadence, lastDate)
  while (next <= todayStr) {
    next = computeNextOccurrence(next, cadence, lastDate)
  }
  return next
}

// Called once the user opts into turning a detectRecurringSuggestion into an
// actual recurringRule — see plaidPendingTransactionsPanel's "set up
// automatically?" dialog. Suppresses future Plaid transactions from this
// merchant the same way "always_personal" does (see upsertPendingTransactionFromPlaid),
// since the rule's own cron now generates this merchant's expense on
// schedule and confirming the bank transaction too would double-book it.
export async function markMerchantCoveredByRecurringRule(
  workspaceId: string,
  uid: string,
  merchantKey: string
): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = merchantMemoryCol(workspaceId).doc(merchantKey)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("No merchant memory found for this merchant")
  await ref.set({ mode: "covered_by_recurring_rule", updatedAt: new Date().toISOString() }, { merge: true })
}

export async function confirmPendingTransaction(
  workspaceId: string,
  uid: string,
  pendingId: string,
  decision: {
    isBusiness: boolean
    account?: string
    alwaysPersonal?: boolean
    receiptAssetId?: string
    // Income-direction transactions only — see confirmIncomeTransaction.
    incomeCategory?: IncomeCategory
    paymentMethod?: PaymentMethod
    incomeLabel?: string
  }
): Promise<{
  committedExpenseId?: string
  committedEntryId?: string
  recurringSuggestion?: PlaidRecurringSuggestion
  personalSuggestion?: PlaidPersonalSuggestion
  notIncomeSuggestion?: PlaidPersonalSuggestion
}> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = pendingTransactionsCol(workspaceId).doc(pendingId)

  // Atomically claim the transaction before doing any further work. A plain
  // read-then-write here would let two overlapping calls — a client retry
  // racing the still-in-flight original request, or a confirm racing a
  // dismiss — both read status "pending" before either writes back, and
  // both proceed: either creating two separate real Expense documents for
  // the same bank transaction, or leaving a just-created Expense's own
  // pending record pointing at nothing. Same pattern as
  // syncTransactionsForItem's sync lock below, just scoped to one doc.
  const claim = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return { outcome: "not_found" as const }
    const current = PlaidPendingTransactionSchema.parse(snap.data())
    if (current.status !== "pending") {
      return { outcome: "not_claimable" as const, current }
    }
    txn.set(ref, { status: "processing", updatedAt: new Date().toISOString() }, { merge: true })
    return { outcome: "claimed" as const, current }
  })

  if (claim.outcome === "not_found") {
    throw new NotFoundError("Pending transaction not found")
  }
  if (claim.outcome === "not_claimable") {
    // The client retries on transient network failures and always resends
    // the same Idempotency-Key, so a request that actually succeeded here
    // can still see its own retry land after the status flip. Treat a
    // repeat of the same decision as a success instead of a false failure —
    // otherwise a slow-but-successful confirm/dismiss gets reported back to
    // the review UI as failed and the row bounces back into the list.
    const current = claim.current
    if (!decision.isBusiness && current.status === "dismissed") {
      return {}
    }
    if (decision.isBusiness && current.status === "confirmed") {
      return { committedExpenseId: current.committedExpenseId, committedEntryId: current.committedEntryId }
    }
    if (current.status === "processing") {
      throw new ConflictError("This transaction is already being processed — try again in a moment.")
    }
    throw new BadRequestError("This transaction has already been reviewed.")
  }

  const pending = claim.current
  // Reuse the key chosen at ingestion (it may be a legacy key with existing
  // memory); only very old records without one are resolved again here.
  const merchantKey = pending.merchantKey || await resolveMerchantKey(workspaceId, pending.merchantName, pending.rawName)
  const displayName = resolvePlaidDisplayName(pending.merchantName, pending.rawName)

  if (!decision.isBusiness) {
    await ref.set({ status: "dismissed", updatedAt: new Date().toISOString() }, { merge: true }).catch(async (error) => {
      // Release the claim so a write failure doesn't strand this
      // transaction in "processing" forever.
      await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
      throw error
    })
    // A dismissed refund (money back on a personal purchase) says nothing
    // new about the merchant — the purchase decision already did.
    if (pending.isRefund) return {}

    // A dismissed deposit (a friend paying the user back, money they moved
    // themselves) teaches income memory, never the expense merchant memory.
    if (pending.direction === "income") {
      const notIncomeSuggestion = await recordIncomeDismissal(workspaceId, pending, displayName).catch((error) => {
        console.error("plaidService.confirmPendingTransaction: income dismissal bookkeeping failed", error)
        return null
      })
      return notIncomeSuggestion ? { notIncomeSuggestion } : {}
    }

    // "always_personal" is an explicit opt-in from the dismiss UI, not
    // inferred from this one dismissal — see createPendingTransactionFromPlaid
    // for what it actually suppresses (the notification, not the record).
    const mode = decision.alwaysPersonal ? "always_personal" : "ask_every_time"

    // Best-effort from here on — the dismissal itself is already saved, so a
    // failure in merchant bookkeeping must not be reported back as a failed
    // dismiss (the row would bounce back into the review list even though
    // it's gone on the next refresh).
    let personalSuggestion: PlaidPersonalSuggestion | undefined
    try {
      await rememberMerchantDecision(workspaceId, merchantKey, displayName, false, null, mode)

      // Already explicitly silenced this merchant just now — nothing further
      // to suggest. Otherwise, check whether a repeated-dismissal pattern has
      // emerged worth a one-time "stop asking?" offer instead of ever
      // interrupting on every single dismiss.
      if (!decision.alwaysPersonal) {
        const memory = await getMerchantMemory(workspaceId, merchantKey)
        if (memory && !memory.suggestedAlwaysPersonalAt && memory.mode === "ask_every_time") {
          const suggestion = await detectPersonalSuggestion(workspaceId, merchantKey, displayName)
          if (suggestion) {
            await markPersonalSuggestionShown(workspaceId, merchantKey)
            personalSuggestion = suggestion
          }
        }
      }
    } catch (error) {
      console.error("plaidService.confirmPendingTransaction: post-dismiss merchant bookkeeping failed", error)
    }
    return { personalSuggestion }
  }

  if (pending.isRefund) {
    return confirmRefundTransaction(workspaceId, uid, ref, pending, displayName, decision.account)
  }
  if (pending.direction === "income") {
    return confirmIncomeTransaction(workspaceId, uid, ref, pending, displayName, decision)
  }

  const account = decision.account ?? pending.suggestedExpenseAccount
  if (!account) {
    // Nothing was committed — release the claim, or this transaction is
    // stuck in "processing" until the next re-import happens to touch it.
    await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
    throw new BadRequestError("An expense category is required to confirm this transaction.")
  }

  let expenseId: string
  try {
    const created = await expensesSvc.createExpense(workspaceId, uid, {
      date: pending.date,
      amount: pending.amount,
      vendor: displayName,
      description: pending.rawName,
      account,
      clientMutationId: `plaid:${pending.plaidTransactionId}`,
      receiptAssetId: decision.receiptAssetId,
    })
    expenseId = created.id
    await ref.set(
      { status: "confirmed", committedExpenseId: expenseId, updatedAt: new Date().toISOString() },
      { merge: true }
    )
  } catch (error) {
    // Release the claim so a failure here doesn't strand the transaction in
    // "processing" forever. createExpense's own clientMutationId dedup means
    // a subsequent retry either creates the expense once or safely reuses
    // the one that already exists — it never doubles up, since claiming
    // guarantees retries are sequential rather than overlapping.
    await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
    throw error
  }
  // Confirming as business always resets mode to ask_every_time — if this
  // merchant was previously "always_personal", surfacing this one (which
  // only happened because the user found it some other way, since
  // always_personal transactions don't notify) means it's a mixed-use
  // merchant after all, so go back to asking each time.
  await rememberMerchantDecision(workspaceId, merchantKey, displayName, true, account, "ask_every_time").catch((error) => {
    console.error("plaidService.confirmPendingTransaction: rememberMerchantDecision failed", error)
  })

  // Best-effort — the expense is already committed and the pending record
  // already marked confirmed above, so a failure here (e.g. a transient
  // index/query issue) must not turn an otherwise-successful confirm into a
  // user-facing failure that bounces the row back into the review list.
  const recurringSuggestion = await detectRecurringSuggestion(workspaceId, merchantKey, pending.amount, displayName, account).catch(
    (error) => {
      console.error("plaidService.confirmPendingTransaction: detectRecurringSuggestion failed", error)
      return null
    }
  )
  return { committedExpenseId: expenseId, recurringSuggestion: recurringSuggestion ?? undefined }
}

// The income counterpart of the expense commit in confirmPendingTransaction:
// books the deposit as an independent-workspace Entry with a single income
// breakdown line, the same shape recurring income rules generate (see
// recurringRulesService.ts). Called with the transaction already claimed
// ("processing"), so this must release the claim on any failure.
async function confirmIncomeTransaction(
  workspaceId: string,
  uid: string,
  ref: FirebaseFirestore.DocumentReference,
  pending: PlaidPendingTransactionType,
  displayName: string,
  decision: { incomeCategory?: IncomeCategory; paymentMethod?: PaymentMethod; incomeLabel?: string }
): Promise<{ committedEntryId: string }> {
  const incomeCategory = decision.incomeCategory ?? "services"
  const paymentMethod = decision.paymentMethod ?? suggestPlaidIncomePaymentMethod(pending.merchantName, pending.rawName)
  // A named "Other" deposit is booked as custom income — the same shape the
  // entry form writes (a customIncome item plus its mirrored "other"
  // breakdown line), so it lands in the grid's Other income column and in
  // Payment streams under that name.
  const incomeLabel = paymentMethod === "other" ? decision.incomeLabel?.trim() || null : null
  let entryId: string
  try {
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()
    if (workspaceSnap.data()?.type !== "independent") {
      throw new BadRequestError("Bank deposits can only be added as income in an independent workspace.")
    }
    const created = await entriesSvc.createEntry(workspaceId, uid, {
      workspace: "independent",
      date: pending.date,
      notes: [incomeLabel, displayName, pending.rawName !== displayName ? pending.rawName : null, "Imported from bank"]
        .filter(Boolean)
        .join(" | "),
      // Same idempotency key scheme as the expense path — createEntry turns
      // it into a deterministic doc id, so a retry can never double-book.
      clientMutationId: `plaid:${pending.plaidTransactionId}`,
      independent: {
        hours: 0,
        incomeBreakdowns: [{ paymentMethod, [incomeCategory]: pending.amount }],
        unreportedCash: 0,
        unreportedCashTips: 0,
        customIncome: incomeLabel ? [{ label: incomeLabel, amount: pending.amount, category: incomeCategory }] : [],
      },
    })
    entryId = created.id
    await ref.set(
      { status: "confirmed", committedEntryId: entryId, updatedAt: new Date().toISOString() },
      { merge: true }
    )
  } catch (error) {
    await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
    throw error
  }
  // Best-effort — the entry is already booked. Confirming always resets the
  // payer to "ask every time": a deposit from an "always not income" payer
  // that the user went looking for and confirmed means the payer is mixed.
  await rememberIncomeDecision(workspaceId, payerKeyFor(pending), displayName, {
    outcome: "income",
    incomeCategory,
    paymentMethod,
    incomeLabel,
  }).catch((error) => {
    console.error("plaidService.confirmIncomeTransaction: rememberIncomeDecision failed", error)
  })
  return { committedEntryId: entryId }
}

// Books a refund as a negative expense in the category it reverses, so the
// P&L nets it against that category in the month it actually happened. The
// original purchase is left untouched for the record. No merchant memory or
// recurring detection: a refund confirms an earlier decision rather than
// making a new one. Called with the transaction already claimed.
async function confirmRefundTransaction(
  workspaceId: string,
  uid: string,
  ref: FirebaseFirestore.DocumentReference,
  pending: PlaidPendingTransactionType,
  displayName: string,
  accountOverride: string | undefined
): Promise<{ committedExpenseId: string }> {
  const account = accountOverride ?? pending.suggestedExpenseAccount
  if (!account) {
    await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
    throw new BadRequestError("An expense category is required to apply this refund.")
  }
  try {
    const created = await expensesSvc.createExpense(workspaceId, uid, {
      date: pending.date,
      amount: -pending.amount,
      vendor: displayName,
      description: pending.refundOf
        ? `Refund of ${pending.refundOf.date} purchase ($${pending.refundOf.amount.toFixed(2)})`
        : `Refund — ${pending.rawName}`,
      account,
      clientMutationId: `plaid:${pending.plaidTransactionId}`,
    })
    await ref.set(
      { status: "confirmed", committedExpenseId: created.id, updatedAt: new Date().toISOString() },
      { merge: true }
    )
    return { committedExpenseId: created.id }
  } catch (error) {
    await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
    throw error
  }
}

// Records written before income memory stored the expense-style merchant
// key on deposits, so always derive the payer key from the names.
function payerKeyFor(pending: PlaidPendingTransactionType): string {
  return normalizePlaidPayerKey(pending.merchantName, pending.rawName)
}

// Only for deposits that will default to "Paid via: Other" — the payer's
// remembered name if it was named last time, else one read off the
// descriptor. Null for spending, refunds and named payment apps.
function suggestedIncomeLabelFor(
  direction: PlaidPendingTransactionType["direction"],
  isRefund: boolean,
  incomeMemory: PlaidIncomeMemoryType | null,
  merchantName: string | null,
  rawName: string
): string | null {
  if (direction !== "income" || isRefund) return null
  const remembered = incomeMemory?.lastOutcome === "income" ? incomeMemory : null
  const method = remembered?.paymentMethod ?? suggestPlaidIncomePaymentMethod(merchantName, rawName)
  if (method !== "other") return null
  return remembered?.incomeLabel ?? suggestPayerName(merchantName, rawName)
}

async function getIncomeMemory(workspaceId: string, payerKey: string): Promise<PlaidIncomeMemoryType | null> {
  if (!payerKey) return null
  const snap = await incomeMemoryCol(workspaceId).doc(payerKey).get()
  return snap.exists ? PlaidIncomeMemorySchema.parse(snap.data()) : null
}

// Same atomic read-modify-write as rememberMerchantDecision, since bulk
// review can decide several deposits from one payer at once.
async function rememberIncomeDecision(
  workspaceId: string,
  payerKey: string,
  displayName: string,
  decision:
    | { outcome: "income"; incomeCategory: IncomeCategory; paymentMethod: PaymentMethod; incomeLabel: string | null }
    | { outcome: "not_income" }
): Promise<PlaidIncomeMemoryType | null> {
  if (!payerKey) return null
  const ref = incomeMemoryCol(workspaceId).doc(payerKey)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const existing = snap.exists ? PlaidIncomeMemorySchema.parse(snap.data()) : null
    const nowIso = new Date().toISOString()
    const isIncome = decision.outcome === "income"
    const canonical: PlaidIncomeMemoryType = {
      id: payerKey,
      workspaceId,
      payerKey,
      displayName,
      lastOutcome: decision.outcome,
      // A "not income" decision keeps the last known category/method, so a
      // payer that's usually income but occasionally isn't still pre-fills.
      incomeCategory: isIncome ? decision.incomeCategory : existing?.incomeCategory ?? null,
      paymentMethod: isIncome ? decision.paymentMethod : existing?.paymentMethod ?? null,
      incomeLabel: isIncome ? decision.incomeLabel : existing?.incomeLabel ?? null,
      mode: isIncome ? "ask_every_time" : existing?.mode ?? "ask_every_time",
      incomeCount: (existing?.incomeCount ?? 0) + (isIncome ? 1 : 0),
      notIncomeCount: (existing?.notIncomeCount ?? 0) + (isIncome ? 0 : 1),
      lastDecisionAt: nowIso,
      suggestedAlwaysNotIncomeAt: existing?.suggestedAlwaysNotIncomeAt ?? null,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }
    txn.set(ref, PlaidIncomeMemorySchema.parse(canonical))
    return canonical
  })
}

// After this many "not income" dismissals from a payer that has never been
// confirmed as income, offer (once) to stop asking — the income twin of
// PERSONAL_SUGGESTION_DISMISS_THRESHOLD.
const NOT_INCOME_SUGGESTION_THRESHOLD = 3

async function recordIncomeDismissal(
  workspaceId: string,
  pending: PlaidPendingTransactionType,
  displayName: string
): Promise<PlaidPersonalSuggestion | null> {
  const payerKey = payerKeyFor(pending)
  const memory = await rememberIncomeDecision(workspaceId, payerKey, displayName, { outcome: "not_income" })
  if (!memory) return null
  if (
    memory.mode !== "ask_every_time" ||
    memory.suggestedAlwaysNotIncomeAt ||
    memory.incomeCount > 0 ||
    memory.notIncomeCount < NOT_INCOME_SUGGESTION_THRESHOLD ||
    // One payer key covers every Venmo cash-out (or every Zelle a bank
    // doesn't name the sender on) — silencing it would hide client money
    // along with the personal transfers.
    isPeerToPeerDescriptor(pending.merchantName, pending.rawName)
  ) {
    return null
  }
  await incomeMemoryCol(workspaceId).doc(payerKey).set({ suggestedAlwaysNotIncomeAt: new Date().toISOString() }, { merge: true })
  return { merchantKey: payerKey, displayName, dismissCount: memory.notIncomeCount }
}

// Learned Merchants management, income side (the ?kind=income variants of
// the merchant memory routes).
export async function listIncomeMemory(workspaceId: string, uid: string): Promise<PlaidIncomeMemoryType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await incomeMemoryCol(workspaceId).orderBy("updatedAt", "desc").get()
  return snap.docs.map((doc) => PlaidIncomeMemorySchema.parse(doc.data()))
}

export async function updateIncomeMemory(
  workspaceId: string,
  uid: string,
  payerKey: string,
  patch: { mode?: PlaidIncomeMemoryType["mode"]; incomeCategory?: IncomeCategory | null }
): Promise<PlaidIncomeMemoryType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = incomeMemoryCol(workspaceId).doc(payerKey)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("No learned payer found for this key")
  await ref.set(
    {
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.incomeCategory !== undefined ? { incomeCategory: patch.incomeCategory } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  )
  return PlaidIncomeMemorySchema.parse((await ref.get()).data())
}

export async function resetIncomeMemory(workspaceId: string, uid: string, payerKey: string): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  await incomeMemoryCol(workspaceId).doc(payerKey).delete()
}

// Everything transfer detection hid (see pairWithTransferCounterpart and
// classifyPlaidTransferSignal), newest first — the safety net for a real
// payment wrongly treated as money moving between the user's own accounts.
const HIDDEN_TRANSFERS_LIMIT = 300

export async function listHiddenTransfers(workspaceId: string, uid: string): Promise<PlaidPendingTransactionType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  // Equality-only query (no orderBy) so no composite index is needed;
  // sorted in memory instead.
  const snap = await pendingTransactionsCol(workspaceId)
    .where("dismissReason", "==", "transfer")
    .limit(HIDDEN_TRANSFERS_LIMIT)
    .get()
  return snap.docs
    .map((doc) => PlaidPendingTransactionSchema.parse(doc.data()))
    .filter((t) => t.status === "dismissed")
    .sort((a, b) => b.date.localeCompare(a.date))
}

// "Not a transfer" from Hidden Transfers: puts the transaction back into
// review (the Income or Expenses list, by its direction) and marks it so
// detection leaves it alone from now on. If it was only hidden because it
// was paired with another transaction, that pairing was wrong too, so the
// other half comes back the same way. A counterpart with its own strong
// signal (e.g. a credit card payment) stays hidden; it only loses the pairing.
export async function restoreHiddenTransfer(
  workspaceId: string,
  uid: string,
  pendingId: string
): Promise<{ restoredIds: string[] }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = pendingTransactionsCol(workspaceId).doc(pendingId)

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Transaction not found")
    const target = PlaidPendingTransactionSchema.parse(snap.data())
    if (target.status === "pending" && target.transferOverride) {
      // A retry of a restore that already went through.
      return { restoredIds: [target.id] }
    }
    if (target.status !== "dismissed" || target.dismissReason !== "transfer") {
      throw new BadRequestError("This transaction isn't a hidden transfer.")
    }

    // All reads before any writes, per Firestore transaction rules.
    const counterpartRef = target.transferPairId ? pendingTransactionsCol(workspaceId).doc(target.transferPairId) : null
    const counterpartSnap = counterpartRef ? await txn.get(counterpartRef) : null
    const counterpart = counterpartSnap?.exists ? PlaidPendingTransactionSchema.parse(counterpartSnap.data()) : null

    const nowIso = new Date().toISOString()
    const restorePatch = {
      status: "pending",
      dismissReason: FieldValue.delete(),
      transferPairId: FieldValue.delete(),
      transferOverride: true,
      updatedAt: nowIso,
    }
    txn.set(ref, restorePatch, { merge: true })
    const restoredIds = [target.id]

    if (counterpartRef && counterpart && counterpart.transferPairId === target.id) {
      const hiddenOnlyByPairing =
        counterpart.status === "dismissed" && counterpart.dismissReason === "transfer" && counterpart.transferSignal !== "transfer"
      if (hiddenOnlyByPairing) {
        txn.set(counterpartRef, restorePatch, { merge: true })
        restoredIds.push(counterpart.id)
      } else {
        txn.set(counterpartRef, { transferPairId: FieldValue.delete(), transferOverride: true, updatedAt: nowIso }, { merge: true })
      }
    }
    return { restoredIds }
  })
}
