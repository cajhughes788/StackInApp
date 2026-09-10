import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin";
import { generateDueProfitLossStatementsForWorkspace } from "../services/profitLossService";
export const generateProfitLossStatementsMonthly = onSchedule({
    schedule: "5 0 1 * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
}, async () => {
    const workspacesSnap = await db
        .collection("workspaces")
        .where("type", "==", "independent")
        .where("status", "==", "active")
        .get();
    for (const workspaceDoc of workspacesSnap.docs) {
        const ownerId = workspaceDoc.data()?.ownerId;
        if (typeof ownerId !== "string") continue;
        try {
            await generateDueProfitLossStatementsForWorkspace(workspaceDoc.id, ownerId);
        }
        catch (error) {
            console.error("[generateProfitLossStatementsMonthly] failed for workspace", {
                workspaceId: workspaceDoc.id,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
});
