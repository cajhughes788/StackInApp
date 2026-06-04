// /frontend/contexts/auth-context.tsx
"use client";
import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode, } from "react";
import { getAuthSafe } from "@/lib/firebase";
import { logout as firebaseLogout } from "@/lib/auth";
import { clearApiCaches } from "@/lib/api";
import { clearAllSettingsHints } from "@/lib/storage/localSettingsHint";
import { bumpAuthSessionVersion } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
// Zustand stores
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useExpensesStore } from "@/lib/stores/useExpensesStore";
import { useProfitLossStore } from "@/lib/stores/useProfitLossStore";
import { clearAllLocalDomainData } from "@/lib/domain";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { useImportsStore } from "@/lib/stores/useImportsStore";
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore";
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore";

function snapshotLogoutState() {
    const entriesByWorkspace = useEntriesStore.getState().byWorkspaceId;
    const expensesByWorkspace = useExpensesStore.getState().byWorkspaceId;
    const receiptDraftsByWorkspace = useReceiptDraftsStore.getState().byWorkspaceId;
    const importsByWorkspace = useImportsStore.getState().byWorkspaceId;
    const workspaceState = useWorkspaceStore.getState().state;
    const expenseMemory = useExpenseMemoryStore.getState().memory;
    return {
        workspaceStoreStatus: workspaceState.status,
        workspaceIdsWithEntries: Object.keys(entriesByWorkspace),
        workspaceIdsWithExpenses: Object.keys(expensesByWorkspace),
        workspaceIdsWithReceiptDrafts: Object.keys(receiptDraftsByWorkspace),
        workspaceIdsWithImports: Object.keys(importsByWorkspace),
        entryCountsByWorkspace: Object.fromEntries(Object.entries(entriesByWorkspace).map(([workspaceId, entry]) => [workspaceId, entry.entries.length])),
        expenseCountsByWorkspace: Object.fromEntries(Object.entries(expensesByWorkspace).map(([workspaceId, entry]) => [workspaceId, entry.expenses.length])),
        receiptDraftCountsByWorkspace: Object.fromEntries(Object.entries(receiptDraftsByWorkspace).map(([workspaceId, entry]) => [workspaceId, entry.drafts.length])),
        importBatchCountsByWorkspace: Object.fromEntries(Object.entries(importsByWorkspace).map(([workspaceId, entry]) => [workspaceId, entry.batches.length])),
        expenseMemoryCounts: {
            vendors: expenseMemory.vendors.length,
            descriptions: expenseMemory.descriptions.length,
            accounts: expenseMemory.accounts.length,
            patterns: expenseMemory.patterns.length,
        },
    };
}
const AuthContext = createContext<{
    user: any;
    authLoading: boolean;
    logout: () => Promise<void>;
}>({
    user: null,
    authLoading: true,
    logout: async () => { },
});
export function useAuth() {
    return useContext(AuthContext);
}
export function AuthProvider({ children }: {
    children: ReactNode;
}) {
    const [user, setUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const authTransitionChainRef = useRef<Promise<void>>(Promise.resolve());
    // --------------------------------------------------------
    // LOGOUT — Only calls firebase logout
    // Cleanup is handled by onAuthStateChanged(null)
    // --------------------------------------------------------
    const logout = useCallback(async () => {
        await firebaseLogout();
        await authTransitionChainRef.current.catch(() => undefined);
    }, []);
    // --------------------------------------------------------
    // AUTH STATE LISTENER
    // --------------------------------------------------------
    useEffect(() => {
        let isMounted = true;
        let receivedInitialAuthEvent = false;
        const auth = getAuthSafe();
        debugLog("auth", "listener_subscribed", {
            currentUserUid: auth.currentUser?.uid ?? null,
        });
        const authBootstrapWatchdog = window.setTimeout(() => {
            if (!isMounted || receivedInitialAuthEvent) {
                return;
            }
            debugError("auth", "initial_state_timeout", {
                currentUserUid: auth.currentUser?.uid ?? null,
            });
            setUser(auth.currentUser ?? null);
            setAuthLoading(false);
        }, 5000);
        const unsub = auth.onAuthStateChanged((fbUser) => {
            receivedInitialAuthEvent = true;
            window.clearTimeout(authBootstrapWatchdog);
            debugLog("auth", "state_changed", {
                uid: fbUser?.uid ?? null,
                email: fbUser?.email ?? null,
                isMounted,
            });
            if (isMounted) {
                setAuthLoading(true);
            }
            authTransitionChainRef.current = authTransitionChainRef.current
                .catch(() => undefined)
                .then(async () => {
                if (!isMounted)
                    return;
                // ----------------------------------------------------
                // USER LOGGED OUT
                // ----------------------------------------------------
                if (!fbUser) {
                    bumpAuthSessionVersion();
                    clearApiCaches();
                    clearAllSettingsHints();
                    setUser(null);
                    try {
                        debugLog("auth", "logout_cleanup_start", snapshotLogoutState());
                        await Promise.all([
                            useSettingsStore.getState().clear(),
                            useTaxProfileStore.getState().clear(),
                            useEntriesStore.getState().clear(),
                            useExpensesStore.getState().clear(),
                            Promise.resolve(useImportsStore.getState().clear()),
                            Promise.resolve(useReceiptDraftsStore.getState().clear()),
                            Promise.resolve(useExpenseMemoryStore.getState().clear()),
                            usePayStubsStore.getState().clear(),
                            useProfitLossStore.getState().clear(),
                            useWorkspaceStore.getState().clear()
                        ]);
                        debugLog("auth", "logout_cleanup_after_store_clear", snapshotLogoutState());
                        if (isMounted) {
                            setAuthLoading(false);
                        }
                        await clearAllLocalDomainData();
                        if (isMounted) {
                            debugLog("auth", "logout_cleanup_complete", snapshotLogoutState());
                        }
                    }
                    catch (error) {
                        debugError("auth", "logout_cleanup_failed", {
                            message: error instanceof Error ? error.message : "Unknown logout cleanup error",
                            stack: error instanceof Error ? error.stack ?? null : null,
                        });
                    }
                    finally {
                        if (isMounted) {
                            setAuthLoading(false);
                        }
                    }
                    return;
                }
                // ----------------------------------------------------
                // USER LOGGED IN
                // ----------------------------------------------------
                bumpAuthSessionVersion();
                if (!isMounted)
                    return;
                debugLog("auth", "login_state_commit", {
                    uid: fbUser.uid,
                    email: fbUser.email ?? null,
                });
                setUser(fbUser);
                setAuthLoading(false);
            })
                .catch((error) => {
                debugError("auth", "state_transition_failed", {
                    uid: fbUser?.uid ?? null,
                    message: error instanceof Error ? error.message : "Unknown auth transition error",
                    stack: error instanceof Error ? error.stack ?? null : null,
                });
                if (isMounted) {
                    setUser(fbUser ?? null);
                    setAuthLoading(false);
                }
            });
        });
        return () => {
            isMounted = false;
            window.clearTimeout(authBootstrapWatchdog);
            debugLog("auth", "listener_unsubscribed");
            unsub();
        };
    }, []);
    const value = useMemo(() => ({ user, authLoading, logout }), [user, authLoading, logout]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
