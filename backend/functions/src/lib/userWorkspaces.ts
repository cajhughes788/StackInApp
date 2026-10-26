import { db } from "../admin";
import type { WorkspaceType } from "@shared/contracts/workspace";

export type ActiveWorkspace = { id: string; name: string; type: WorkspaceType };

// Every active (not archived) workspace the user is a member of.
export async function listActiveWorkspaces(uid: string): Promise<ActiveWorkspace[]> {
    const memberships = await db.collection(`users/${uid}/memberships`).get();
    if (memberships.empty) return [];
    const snaps = await db.getAll(...memberships.docs.map((doc) => db.doc(`workspaces/${doc.id}`)));
    return snaps.flatMap((snap) => {
        const data = snap.data();
        if (!snap.exists || !data || data.status === "archived") return [];
        if (data.type !== "w2" && data.type !== "independent") return [];
        return [{ id: snap.id, name: String(data.name ?? ""), type: data.type }];
    });
}
