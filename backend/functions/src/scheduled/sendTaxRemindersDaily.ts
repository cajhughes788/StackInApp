import { onSchedule } from "firebase-functions/v2/scheduler"
import { DateTime } from "luxon"
import { db } from "../admin"
import { getTaxEstimate, listTaxPayments } from "../services/taxEstimateService"
import { sendTransactionNotification } from "../services/pushNotificationService"
import { listActiveWorkspaces } from "../lib/userWorkspaces"
import { TaxEstimateProfileSchema } from "@shared/schemas/taxEstimateProfile"
import { getEstimatedTaxYear } from "@shared/estimatedTax/years"
import { buildTaxReminderMessage, pickTaxReminder } from "@shared/estimatedTax/reminders"
import { headlineAmount, taxHeadline } from "@shared/estimatedTax/headline"
import { SHOW_TAXES } from "@shared/estimatedTax/featureFlag"
import { taxYearForDate } from "@shared/estimatedTax/response"

// Estimated tax reminders: a push seven days before each due date, and on
// the date itself if no payment has been recorded since the last one.
// Only for people who finished the Taxes setup, kept reminders on, and
// have something to pay. Turn off in the Taxes card → Your answers.
export const sendTaxRemindersDaily = onSchedule(
  {
    schedule: "0 9 * * *", // every day 9:00 Pacific
    timeZone: "America/Los_Angeles",
    region: "us-central1",
  },
  async () => {
    // No tax reminders while the Taxes feature is hidden (featureFlag.ts).
    if (!SHOW_TAXES) return
    const now = DateTime.now().setZone("America/Los_Angeles")
    const today = now.toISODate()!
    const taxYear = taxYearForDate(today)
    const table = getEstimatedTaxYear(taxYear)
    if (!table) return
    // Cheapest check first: is today a reminder day for anyone?
    if (!pickTaxReminder(table, today, []) && !table.quarters.some((q) => q.dueDate === today)) return

    const profiles = await db.collectionGroup("taxEstimate").get()
    for (const doc of profiles.docs) {
      if (doc.id !== "profile") continue
      const uid = doc.ref.parent.parent?.id
      if (!uid) continue
      try {
        const parsed = TaxEstimateProfileSchema.safeParse(doc.data())
        if (!parsed.success) continue
        const profile = parsed.data
        if (!profile.updatedAt || !profile.remindersEnabled) continue

        const reminder = pickTaxReminder(table, today, await listTaxPayments(uid, taxYear))
        if (!reminder || profile.lastReminderKey === reminder.key) continue

        const tokensSnap = await db.collection("users").doc(uid).collection("deviceTokens").limit(1).get()
        if (tokensSnap.empty) continue

        const estimate = await getTaxEstimate(uid, now)
        if (!estimate.eligible || !estimate.quarterly || estimate.quarterly.dueDate !== reminder.dueDate) continue
        // The same amount the Taxes page leads with; none when nothing's needed.
        const amount = headlineAmount(taxHeadline(estimate.health, estimate.quarterly))
        if (!(amount >= 1)) continue

        const workspaceId = (await listActiveWorkspaces(uid)).find((w) => w.type === "independent")?.id
        await sendTransactionNotification(uid, {
          ...buildTaxReminderMessage(reminder, amount),
          // registerPush.ts → deepLinkStore.ts opens the Taxes page in this
          // workspace (older app builds read it as Home).
          data: { deepLink: "stackin://home/taxes", ...(workspaceId ? { workspaceId } : {}) },
        })
        await doc.ref.set({ lastReminderKey: reminder.key }, { merge: true })
      } catch (err) {
        console.warn("sendTaxRemindersDaily: failed for user", {
          uid,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
)
