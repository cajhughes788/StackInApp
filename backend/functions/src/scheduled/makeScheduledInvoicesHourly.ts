import { onSchedule } from "firebase-functions/v2/scheduler"
import { db } from "../admin"
import { SENDGRID_API_KEY } from "../secrets"
import { SCHEDULED_INVOICE_HOUR, businessNow, runInvoiceSchedule } from "../services/invoiceSchedulesService"

// Makes repeating invoices (invoiceSchedulesService.ts) on their dates.
// Hourly, so each business gets its invoices early in its own morning,
// whatever its time zone; a schedule whose date has come runs once that
// business's clock passes SCHEDULED_INVOICE_HOUR. Re-running is safe — a
// date's invoice can only be made once.
export const makeScheduledInvoicesHourly = onSchedule(
  {
    schedule: "20 * * * *",
    timeZone: "UTC",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
    timeoutSeconds: 540,
  },
  async () => {
    // Tomorrow in UTC covers every time zone that's already reached it.
    const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const dueSnap = await db.collectionGroup("invoiceSchedules").where("status", "==", "active").where("nextDate", "<=", latest).get()
    const nowByWorkspace = new Map<string, { today: string; hour: number } | null>()
    let made = 0
    for (const doc of dueSnap.docs) {
      const workspaceRef = doc.ref.parent.parent
      if (!workspaceRef) continue
      const workspaceId = workspaceRef.id
      try {
        const workspace = (await workspaceRef.get()).data()
        const ownerId = typeof workspace?.ownerId === "string" ? workspace.ownerId : null
        if (!ownerId || workspace?.type !== "independent" || workspace?.status !== "active") continue
        if (!nowByWorkspace.has(workspaceId)) nowByWorkspace.set(workspaceId, await businessNow(workspaceId))
        const now = nowByWorkspace.get(workspaceId)!
        if (!now || now.hour < SCHEDULED_INVOICE_HOUR) continue
        if (await runInvoiceSchedule(workspaceId, ownerId, doc.ref, now.today)) made += 1
      } catch (error) {
        console.error("makeScheduledInvoicesHourly: schedule failed", { workspaceId, scheduleId: doc.id }, error)
      }
    }
    console.log("makeScheduledInvoicesHourly: done", { due: dueSnap.size, made })
  }
)
