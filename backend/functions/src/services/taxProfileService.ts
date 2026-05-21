// /functions/src/services/taxProfileService.ts
import { db } from "../admin";
// Updated to use namespaced schema + type
import { TaxProfile } from "@shared/schemas";
import { ForbiddenError } from "../lib/httpErrors";
/**
 * Get the current workspace tax profile.
 * Returns null if missing, validated via shared schema.
 */
export async function getTaxProfile(workspaceId: string, uid: string): Promise<TaxProfile.Type | null> {
    const membershipRef = db.doc(`users/${uid}/memberships/${workspaceId}`);
    const membershipSnap = await membershipRef.get();
    if (!membershipSnap.exists) {
        throw new ForbiddenError("Forbidden");
    }
    const ref = db.doc(`workspaces/${workspaceId}/taxProfile/current`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    // ✅ Validate using namespaced schema
    const parsed = TaxProfile.Schema.safeParse(snap.data());
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}
/**
 * Create or update a workspace tax profile.
 * Validates and merges using shared schema.
 */
export async function saveTaxProfile(workspaceId: string, uid: string, payload: unknown): Promise<TaxProfile.Type> {
    const parsed = TaxProfile.Schema.parse(payload);
    const membershipRef = db.doc(`users/${uid}/memberships/${workspaceId}`);
    const taxRef = db.doc(`workspaces/${workspaceId}/taxProfile/current`);
    await db.runTransaction(async (tx) => {
        const membershipSnap = await tx.get(membershipRef);
        if (!membershipSnap.exists) {
            throw new ForbiddenError("Forbidden");
        }
        tx.set(taxRef, parsed, { merge: true });
    });
    return parsed;
}
