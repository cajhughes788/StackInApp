import { onSchedule } from "firebase-functions/v2/scheduler"
import { db, storage } from "../admin"

// Assets older than 48 hours with no linked draft or expense are orphans.
// The job runs daily so the effective deletion window is 48–72 hours.
const ORPHAN_THRESHOLD_MS = 48 * 60 * 60 * 1000

export const cleanupOrphanReceiptAssets = onSchedule(
  {
    schedule: "0 3 * * *", // Daily at 03:00 UTC
    timeZone: "UTC",
    region: "us-central1",
  },
  async () => {
    const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS).toISOString()

    const workspacesSnap = await db
      .collection("workspaces")
      .where("type", "==", "independent")
      .where("status", "==", "active")
      .get()

    for (const workspaceDoc of workspacesSnap.docs) {
      const workspaceId = workspaceDoc.id
      try {
        await cleanupOrphansForWorkspace(workspaceId, cutoff)
      } catch (err) {
        console.warn("orphan cleanup failed for workspace", {
          workspaceId,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
)

async function cleanupOrphansForWorkspace(
  workspaceId: string,
  cutoff: string
): Promise<void> {
  const assetsSnap = await db
    .collection(`workspaces/${workspaceId}/receiptAssets`)
    .where("createdAt", "<", cutoff)
    .get()

  if (assetsSnap.empty) return

  for (const assetDoc of assetsSnap.docs) {
    const assetId = assetDoc.id
    try {
      const [draftsSnap, expensesSnap] = await Promise.all([
        db
          .collection(`workspaces/${workspaceId}/receiptDrafts`)
          .where("receiptAssetId", "==", assetId)
          .limit(1)
          .get(),
        db
          .collection(`workspaces/${workspaceId}/expenses`)
          .where("receiptAssetId", "==", assetId)
          .limit(1)
          .get(),
      ])

      if (!draftsSnap.empty || !expensesSnap.empty) continue

      // Confirmed orphan: delete Firestore record + GCS files.
      const batch = db.batch()
      batch.delete(assetDoc.ref)
      await batch.commit()

      const prefix = `workspaces/${workspaceId}/receipts/${assetId}/`
      try {
        await storage.bucket().deleteFiles({ prefix })
      } catch (storageErr) {
        const msg = storageErr instanceof Error ? storageErr.message.toLowerCase() : ""
        if (!msg.includes("no such object") && !msg.includes("not found")) {
          console.warn("orphan GCS cleanup failed", { workspaceId, assetId, msg })
        }
      }
    } catch (err) {
      console.warn("orphan asset cleanup failed", {
        workspaceId,
        assetId,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
