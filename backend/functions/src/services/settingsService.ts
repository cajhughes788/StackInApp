// /backend/settingsService.ts
import { db } from "../admin";
import { SettingsDocSchema, SettingsPatch, SettingsType, } from "@shared/schemas/settings";
import { ForbiddenError } from "../lib/httpErrors";
import type { BackendProfileTrace } from "../lib/profileTrace";
import { withBackendProfileStep } from "../lib/profileTrace";
import { settingsCache } from "./settingsCache";
const noopTrace: BackendProfileTrace = {
    traceId: "settings-save-no-trace",
    flow: "settings_save",
    mark: () => { },
    start: () => { },
    end: () => { },
    error: () => { },
};
/**
 * Ensure the user is a member of the workspace.
 */
async function assertWorkspaceMembership(workspaceId: string, uid: string): Promise<void> {
    const memberRef = db.doc(`users/${uid}/memberships/${workspaceId}`);
    const snap = await memberRef.get();
    if (!snap.exists) {
        throw new ForbiddenError("Forbidden");
    }
}
function mergeSettingsDocs(current: SettingsType | null, patch: Partial<SettingsType>): SettingsType {
    return {
        ...(current ?? {}),
        common: {
            ...(current?.common ?? {}),
            ...(patch.common ?? {}),
        },
        w2: {
            ...(current?.w2 ?? {}),
            ...(patch.w2 ?? {}),
        },
        independent: {
            ...(current?.independent ?? {}),
            ...(patch.independent ?? {}),
        },
    };
}
/**
 * GET SETTINGS
 * Returns the sparse Firestore document exactly as stored.
 */
export async function getSettings(workspaceId: string, uid: string): Promise<SettingsType | null> {
    // 1️⃣ Verify workspace membership
    await assertWorkspaceMembership(workspaceId, uid);
    const cached = settingsCache[workspaceId];
    if (cached) {
        return cached.data;
    }
    // 2️⃣ Read workspace-scoped settings
    const ref = db.doc(`workspaces/${workspaceId}/settings/current`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const parsed = SettingsDocSchema.safeParse(snap.data());
    if (!parsed.success) {
        return null;
    }
    settingsCache[workspaceId] = {
        data: parsed.data,
        ts: Date.now(),
    };
    // Return sparse doc exactly as Firestore has it
    return parsed.data;
}
/**
 * PATCH SETTINGS
 * - Validates incoming patch only.
 * - Applies patch via Firestore { merge: true }.
 * - Reloads and validates the updated sparse doc.
 * - Returns the sparse, minimal Firestore object.
 */
export async function patchSettings(workspaceId: string, uid: string, patch: unknown, trace?: BackendProfileTrace): Promise<SettingsType> {
    const activeTrace = trace ?? noopTrace;
    // 1️⃣ Verify workspace membership
    await withBackendProfileStep(activeTrace, "settings_save.membership_check", () => assertWorkspaceMembership(workspaceId, uid), { workspaceId, uid });
    const ref = db.doc(`workspaces/${workspaceId}/settings/current`);
    // -------------------------------------
    // 2. Validate PATCH shape ONLY
    // -------------------------------------
    const patchValidated = SettingsPatch.parse(patch);
    const currentSnap = await withBackendProfileStep(activeTrace, "settings_save.current_settings_fetch", () => ref.get(), { workspaceId });
    const currentRaw = currentSnap.exists ? currentSnap.data() : null;
    const currentParsed = currentRaw ? SettingsDocSchema.safeParse(currentRaw) : null;
    const merged = mergeSettingsDocs(currentParsed?.success ? currentParsed.data : null, patchValidated);
    const parsed = SettingsDocSchema.safeParse(merged);
    if (!parsed.success) {
        throw new Error("[patchSettings] Updated Firestore settings invalid");
    }
    await withBackendProfileStep(activeTrace, "settings_save.firestore_write", () => ref.set(parsed.data), { workspaceId });
    settingsCache[workspaceId] = {
        data: parsed.data,
        ts: Date.now(),
    };
    return parsed.data;
}
