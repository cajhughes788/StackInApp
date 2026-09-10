import { onSchedule } from "firebase-functions/v2/scheduler"
import { db } from "../admin"
import { PlaidItemSchema, type PlaidItemType } from "@shared/schemas/plaidItem"
import { sendTransactionNotification } from "../services/pushNotificationService"

// Safety net for plaidWebhook.ts's ITEM/ERROR handling — that path notifies
// immediately when Plaid tells us a connection broke, but webhooks can be
// delayed or dropped, and some failure modes (an institution that just stops
// delivering data) never send an ITEM error at all. This runs once a day and
// catches anything the real-time path missed.
const STALE_SYNC_THRESHOLD_MS = 10 * 24 * 60 * 60 * 1000 // 10 days
const RENOTIFY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // don't re-nag more than weekly

export const flagStalePlaidItemsDaily = onSchedule(
  {
    schedule: "0 13 * * *", // Daily at 13:00 UTC (mid-morning US time)
    timeZone: "UTC",
    region: "us-central1",
  },
  async () => {
    const staleCutoffIso = new Date(Date.now() - STALE_SYNC_THRESHOLD_MS).toISOString()

    const [erroredSnap, silentlyStaleSnap] = await Promise.all([
      db.collectionGroup("plaidItems").where("status", "==", "error").get(),
      // Firestore excludes docs where lastSyncAt is null from an inequality
      // filter automatically, so a freshly-linked item that hasn't synced
      // yet is never flagged as stale by this branch.
      db.collectionGroup("plaidItems").where("status", "==", "active").where("lastSyncAt", "<=", staleCutoffIso).get(),
    ])

    for (const doc of [...erroredSnap.docs, ...silentlyStaleSnap.docs]) {
      const workspaceRef = doc.ref.parent.parent
      if (!workspaceRef) continue
      const workspaceId = workspaceRef.id

      try {
        const parsed = PlaidItemSchema.safeParse(doc.data())
        if (!parsed.success) continue
        const item: PlaidItemType = parsed.data

        if (item.lastStaleNotifiedAt) {
          const sinceLastNotify = Date.now() - Date.parse(item.lastStaleNotifiedAt)
          if (sinceLastNotify < RENOTIFY_THRESHOLD_MS) continue
        }

        const nowIso = new Date().toISOString()
        await sendTransactionNotification(item.linkOwnerUid, {
          title: "Reconnect your bank",
          body: `${item.institutionName ?? "A linked bank account"} hasn't synced in a while — reconnect it so new transactions keep getting tracked.`,
          // registerPush.ts routes this straight to the account page, where
          // the broken connection already shows a Reconnect button — see
          // plaid-connect-button.tsx's update-mode flow.
          data: { deepLink: "stackin://plaid/reconnect" },
        })
        await doc.ref.set({ lastStaleNotifiedAt: nowIso }, { merge: true })
      } catch (err) {
        console.warn("flagStalePlaidItemsDaily: failed to process item", {
          workspaceId,
          itemId: doc.id,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
)
