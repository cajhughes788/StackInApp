import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/httpErrors"
import { PlaidItemSchema, PlaidItemPublicSchema, type PlaidItemType, type PlaidLinkedAccountType } from "@shared/schemas/plaidItem"
import { PlaidPendingTransactionSchema, type PlaidPendingTransactionType } from "@shared/schemas/plaidPendingTransaction"
import { PlaidMerchantMemorySchema, type PlaidMerchantMemoryType } from "@shared/schemas/plaidMerchantMemory"
import {
  classifyPlaidTransaction,
  normalizePlaidMerchantKey,
  detectRecurringCadence,
  isSimilarRecurringAmount,
  type PlaidClassificationResult,
} from "@shared/plaidClassification"
import { isLikelyFuelPurchase } from "@shared/expenseKeywordMatching"
import { computeNextOccurrence } from "@shared/recurringSchedule"
import type { RecurringCadence } from "@shared/schemas/recurringRule"
import * as expensesSvc from "./expensesService"
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
    client_name: "Stackin",
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
    client_name: "Stackin",
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
// StackIn workspace only ever removed our own copy of the (now-encrypted)
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
// all — so this is how a user gets their recent spending into StackIn
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
  const merchantKey = normalizePlaidMerchantKey(merchantName, rawName)

  // A learned decision from a past confirm/dismiss on this same merchant
  // takes priority over the generic rule-based guess — see
  // confirmPendingTransaction below, which writes this memory.
  const memory = merchantKey ? await getMerchantMemory(workspaceId, merchantKey) : null
  const classification: PlaidClassificationResult = memory
    ? { suggestedExpenseAccount: memory.expenseCategory, isBusinessGuess: memory.isBusiness, confidence: 0.95 }
    : applyAccountDefault(
        classifyPlaidTransaction({
          merchantName,
          rawName,
          personalFinanceCategoryPrimary: transaction.personal_finance_category?.primary ?? null,
          amount: transaction.amount,
        }),
        linkedAccounts.find((account) => account.accountId === transaction.account_id)?.defaultBusiness ?? null
      )
  // Explicit opt-in only (see PlaidMerchantMemorySchema) — the transaction
  // still gets recorded, just pre-dismissed and silent, so a rare business
  // purchase at an otherwise-personal merchant isn't lost, only unnoticed
  // unless the user goes looking for it. "covered_by_recurring_rule" gets the
  // same silent treatment: the recurring rule's cron already generates this
  // merchant's expense on schedule, so confirming the bank transaction too
  // would book the same real-world charge twice.
  const autoDismiss = memory?.mode === "always_personal" || memory?.mode === "covered_by_recurring_rule"

  const nowIso = new Date().toISOString()
  const pending: PlaidPendingTransactionType = {
    id: transaction.transaction_id,
    workspaceId,
    plaidItemId,
    plaidTransactionId: transaction.transaction_id,
    accountId: transaction.account_id,
    date: transaction.date,
    amount: transaction.amount,
    merchantName,
    rawName,
    merchantKey,
    personalFinanceCategoryPrimary: transaction.personal_finance_category?.primary ?? null,
    suggestedExpenseAccount: classification.suggestedExpenseAccount,
    isBusinessGuess: classification.isBusinessGuess,
    confidence: classification.confidence,
    isLikelyFuelPurchase: isLikelyFuelPurchase(merchantName ?? rawName),
    status: autoDismiss ? "dismissed" : "pending",
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }
  const parsed = PlaidPendingTransactionSchema.parse(pending)
  await pendingTransactionsCol(workspaceId).doc(parsed.id).set(stripUndefinedDeep(parsed), { merge: true })

  return autoDismiss ? null : parsed
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
      title: parsed.merchantName ?? parsed.rawName,
      body: `New transaction: $${parsed.amount.toFixed(2)}${parsed.suggestedExpenseAccount ? ` • ${parsed.suggestedExpenseAccount}` : ""}`,
      data: { deepLink: `stackin://plaid/pending/${parsed.id}` },
    })
    return
  }

  await sendTransactionNotification(uid, {
    title: "New bank transactions to review",
    body: `${notifiable.length} new transactions are ready to review in StackIn.`,
    // No specific id — same startsWith("stackin://plaid/pending/") prefix
    // registerPush.ts already matches, so tapping still lands on the
    // Expenses tab where the whole batch is waiting.
    data: { deepLink: "stackin://plaid/pending/" },
  })
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
    amount: transaction.amount,
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
        await expensesSvc.updateExpense(workspaceId, uid, prior.committedExpenseId, {
          date: transaction.date,
          amount: transaction.amount,
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

async function getMerchantMemory(workspaceId: string, merchantKey: string): Promise<PlaidMerchantMemoryType | null> {
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
    .filter((t) => isSimilarRecurringAmount(t.amount, currentAmount))
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
  decision: { isBusiness: boolean; account?: string; alwaysPersonal?: boolean; receiptAssetId?: string }
): Promise<{ committedExpenseId?: string; recurringSuggestion?: PlaidRecurringSuggestion }> {
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
      return { committedExpenseId: current.committedExpenseId }
    }
    if (current.status === "processing") {
      throw new ConflictError("This transaction is already being processed — try again in a moment.")
    }
    throw new BadRequestError("This transaction has already been reviewed.")
  }

  const pending = claim.current
  const merchantKey = normalizePlaidMerchantKey(pending.merchantName, pending.rawName)
  const displayName = pending.merchantName ?? pending.rawName

  if (!decision.isBusiness) {
    await ref.set({ status: "dismissed", updatedAt: new Date().toISOString() }, { merge: true }).catch(async (error) => {
      // Release the claim so a write failure doesn't strand this
      // transaction in "processing" forever.
      await ref.set({ status: "pending", updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
      throw error
    })
    // "always_personal" is an explicit opt-in from the dismiss UI, not
    // inferred from this one dismissal — see createPendingTransactionFromPlaid
    // for what it actually suppresses (the notification, not the record).
    const mode = decision.alwaysPersonal ? "always_personal" : "ask_every_time"
    await rememberMerchantDecision(workspaceId, merchantKey, displayName, false, null, mode)
    return {}
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
      vendor: pending.merchantName ?? pending.rawName,
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
  await rememberMerchantDecision(workspaceId, merchantKey, displayName, true, account, "ask_every_time")

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
