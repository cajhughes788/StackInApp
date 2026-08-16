import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin";
import { RecurringRuleSchema, type RecurringRuleType } from "@shared/schemas/recurringRule";
import { generateDueOccurrence } from "../services/recurringRulesService";

export const generateRecurringTransactionsDaily = onSchedule({
    schedule: "15 0 * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
}, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dueSnap = await db
        .collectionGroup("recurringRules")
        .where("active", "==", true)
        .where("nextOccurrence", "<=", today)
        .get();

    for (const doc of dueSnap.docs) {
        const workspaceRef = doc.ref.parent.parent;
        if (!workspaceRef)
            continue;
        const workspaceId = workspaceRef.id;
        try {
            const workspaceSnap = await workspaceRef.get();
            const ownerId = typeof workspaceSnap.data()?.ownerId === "string"
                ? workspaceSnap.data()!.ownerId
                : null;
            if (!ownerId)
                continue;
            const parsed = RecurringRuleSchema.safeParse({ id: doc.id, ...doc.data() });
            if (!parsed.success)
                continue;
            await generateDueOccurrence(workspaceId, ownerId, parsed.data as RecurringRuleType);
        }
        catch (error) {
        }
    }
});
