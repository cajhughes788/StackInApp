import { onSchedule } from "firebase-functions/v2/scheduler"
import { DateTime } from "luxon"
import { db } from "../admin"
import type { EntryType } from "@shared/schemas/entry"
import { computeIncomeGaugeForEntry } from "@shared/computeIncomeGauge"
import { needsReceiptForAuditDefense } from "@shared/receiptRequirements"
import { buildWeeklyDigest } from "@shared/weeklyDigest"
import { sendTransactionNotification } from "../services/pushNotificationService"

// Monday-morning summary of the past 7 days for each independent workspace's
// owner: income, what they kept after expenses, and how many items need
// them (bank transactions to review + receipts missing). Opt out with
// Settings → independent.weeklyDigest = false. Weeks with nothing to say
// send nothing (buildWeeklyDigest returns null).
const RESEND_GUARD_MS = 6 * 24 * 60 * 60 * 1000 // a retry never sends twice

export const sendWeeklyDigest = onSchedule(
  {
    schedule: "0 9 * * 1", // Mondays 9:00 Pacific
    timeZone: "America/Los_Angeles",
    region: "us-central1",
  },
  async () => {
    const workspacesSnap = await db
      .collection("workspaces")
      .where("type", "==", "independent")
      .where("status", "==", "active")
      .get()

    for (const workspaceDoc of workspacesSnap.docs) {
      const workspaceId = workspaceDoc.id
      const ownerId = typeof workspaceDoc.data().ownerId === "string" ? workspaceDoc.data().ownerId : null
      if (!ownerId) continue

      try {
        // Cheapest check first: no registered device, nothing to send to.
        const tokensSnap = await db.collection("users").doc(ownerId).collection("deviceTokens").limit(1).get()
        if (tokensSnap.empty) continue

        const settings = (await db.doc(`workspaces/${workspaceId}/settings/current`).get()).data() ?? {}
        if (settings.independent?.weeklyDigest === false) continue

        const stateRef = db.doc(`workspaces/${workspaceId}/notificationState/weeklyDigest`)
        const lastSentAt = (await stateRef.get()).data()?.lastSentAt
        if (typeof lastSentAt === "string" && Date.now() - Date.parse(lastSentAt) < RESEND_GUARD_MS) continue

        // The 7 days before today, in the workspace's time zone.
        const today = DateTime.now().setZone(settings.common?.timeZone || "America/Los_Angeles").startOf("day")
        const start = today.minus({ days: 7 }).toISODate()!
        const end = today.minus({ days: 1 }).toISODate()!

        const [entriesSnap, expensesSnap, pendingCount] = await Promise.all([
          db.collection(`workspaces/${workspaceId}/entries`).where("date", ">=", start).where("date", "<=", end).get(),
          db.collection(`workspaces/${workspaceId}/expenses`).where("date", ">=", start).where("date", "<=", end).get(),
          db
            .collection(`workspaces/${workspaceId}/plaidPendingTransactions`)
            .where("status", "==", "pending")
            .count()
            .get(),
        ])

        const includeUnreportedInUI = settings.independent?.includeUnreportedInUI === true
        const income = entriesSnap.docs.reduce(
          (sum, doc) => sum + computeIncomeGaugeForEntry(doc.data() as EntryType, { includeUnreportedInUI }),
          0
        )
        // Counted only if the person hasn't hidden missing receipts from Needs you.
        const countMissingReceipts = settings.independent?.missingReceiptsInNeedsYou !== false
        let expenses = 0
        let missingReceiptCount = 0
        for (const doc of expensesSnap.docs) {
          const expense = doc.data()
          const amount = Number(expense.amount) || 0
          expenses += amount
          if (countMissingReceipts && needsReceiptForAuditDefense(amount, expense.receiptAssetId)) missingReceiptCount += 1
        }

        const digest = buildWeeklyDigest({
          income,
          expenses,
          pendingReviewCount: pendingCount.data().count,
          missingReceiptCount,
        })
        if (!digest) continue

        await sendTransactionNotification(ownerId, {
          ...digest,
          // registerPush.ts → deepLinkStore.ts opens the home page in this workspace.
          data: { deepLink: "stackin://home", workspaceId },
        })
        await stateRef.set({ lastSentAt: new Date().toISOString() }, { merge: true })
      } catch (err) {
        console.warn("sendWeeklyDigest: failed for workspace", {
          workspaceId,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
)
