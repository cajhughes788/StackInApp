import { onSchedule } from "firebase-functions/v2/scheduler"
import { db } from "../admin"

// Clears the booking spam guard's counts (services/publicBookingService.ts)
// once their window has ended; an ended window already counts as zero, so
// this only keeps the collection small.
export const cleanupBookingLimitsDaily = onSchedule(
  {
    schedule: "30 3 * * *", // Daily at 03:30 UTC
    timeZone: "UTC",
    region: "us-central1",
  },
  async () => {
    const nowIso = new Date().toISOString()
    let deleted = 0
    for (;;) {
      const snap = await db.collection("bookingLimits").where("windowEndsAt", "<=", nowIso).limit(400).get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
      deleted += snap.size
    }
    console.log("cleanupBookingLimitsDaily: done", { deleted })
  }
)
