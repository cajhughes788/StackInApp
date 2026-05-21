import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin";
import { generateMostRecentlyClosedPayStub } from "../services/payStubsService";
export const generatePayStubsDaily = onSchedule({
    schedule: "10 0 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
}, async () => {
    const workspacesSnap = await db
        .collection("workspaces")
        .where("type", "==", "w2")
        .where("status", "==", "active")
        .get();
    for (const workspaceDoc of workspacesSnap.docs) {
        const data = workspaceDoc.data();
        const ownerId = typeof data.ownerId === "string" ? data.ownerId : null;
        if (!ownerId)
            continue;
        try {
            await generateMostRecentlyClosedPayStub(workspaceDoc.id, ownerId, false);
        }
        catch (error) {
        }
    }
});
