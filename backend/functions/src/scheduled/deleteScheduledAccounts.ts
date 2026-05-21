import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin";
import { purgeUserData } from "../services/userDeletionService";
export const deleteScheduledAccounts = onSchedule({
    schedule: "20 0 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
}, async () => {
    const now = Date.now();
    let dueSubscriptionsSnap;
    try {
        dueSubscriptionsSnap = await db
            .collectionGroup("subscription")
            .where("pendingAccountDeletion", "==", true)
            .where("scheduledDeletionAt", "<=", now)
            .get();
    }
    catch (error) {
        throw error;
    }
    for (const subscriptionDoc of dueSubscriptionsSnap.docs) {
        const uid = subscriptionDoc.ref.parent.parent?.id;
        if (!uid) {
            continue;
        }
        try {
            await purgeUserData(uid);
        }
        catch (error) {
            console.error("Failed to purge scheduled account", {
                uid,
                subscriptionPath: subscriptionDoc.ref.path,
                error,
            });
        }
    }
});
