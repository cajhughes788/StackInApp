import { onSchedule } from "firebase-functions/v2/scheduler"
import { db } from "../admin"
import { SENDGRID_API_KEY } from "../secrets"
import { sendDueInvoiceReminders } from "../services/invoiceReminderService"

// Emails clients the invoice reminders due today (shared/invoiceReminders.ts)
// for every workspace with Invoice settings → Automatic reminders on.
// Invoicing is independent-only. Mornings Pacific, so reminders land during
// the US business day.
export const sendInvoiceRemindersDaily = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
    // Reminders go out one at a time; the 60 s default would cut a run short
    // once there are many workspaces.
    timeoutSeconds: 540,
  },
  async () => {
    const workspacesSnap = await db
      .collection("workspaces")
      .where("type", "==", "independent")
      .where("status", "==", "active")
      .get()

    for (const workspaceDoc of workspacesSnap.docs) {
      const ownerId = typeof workspaceDoc.data().ownerId === "string" ? workspaceDoc.data().ownerId : null
      if (!ownerId) continue
      try {
        const sent = await sendDueInvoiceReminders(workspaceDoc.id, ownerId)
        if (sent > 0) console.info("sendInvoiceRemindersDaily: sent", { workspaceId: workspaceDoc.id, sent })
      } catch (error) {
        console.error("sendInvoiceRemindersDaily: workspace failed", { workspaceId: workspaceDoc.id, error })
      }
    }
  }
)
