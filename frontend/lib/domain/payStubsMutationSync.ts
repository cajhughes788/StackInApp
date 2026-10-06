"use client";
// /lib/domain/payStubsMutationSync.ts
// ------------------------------------------------------------
// Applies the pay stubs an entry create/edit/delete response carries.
// The backend regenerates the affected period stubs before responding and
// returns them as `payStubs`, so the earnings view updates from the write
// itself — no follow-up getPayStubs round trip, no race with it.
// ------------------------------------------------------------
import { PayStub } from "@shared/schemas";
import type { WorkspaceId } from "@shared/contracts/workspace";
import * as payStubsService from "@/lib/domain/payStubsService";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";

/**
 * @param payStubs the response's `payStubs` field (unvalidated)
 * @param isW2 whether the mutated entry was W2 — when the response has no
 *   usable stubs (backend sync failed, or a backend predating this field),
 *   W2 writes fall back to invalidate + refetch.
 */
export function syncPayStubsFromMutation(workspaceId: WorkspaceId, payStubs: unknown, isW2: boolean): void {
    if (Array.isArray(payStubs)) {
        const parsed = safeSchemaParse(PayStub.Schema.array(), payStubs);
        if (parsed.success) {
            void usePayStubsStore.getState().applyServerPayStubs(workspaceId, parsed.data).catch(() => {});
            return;
        }
    }
    if (!isW2)
        return;
    void payStubsService.invalidate(workspaceId)
        .catch(() => {})
        .then(() => {
            const store = usePayStubsStore.getState();
            if (!store.byWorkspaceId[workspaceId]?.hasHydrated)
                return;
            return store.refreshFromBackend(workspaceId, { force: true });
        })
        .catch(() => {});
}
