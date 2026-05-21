// /frontend/hooks/useAppOpenRefresh.ts
"use client";
/**
 * useAppOpenRefresh
 * ------------------------------------------------------------
 * Safe on:
 *   - Next.js prerender
 *   - Server builds
 *   - Capacitor apps
 *
 * Behavior:
 *   • Runs ONLY after hydration + user auth available
 *   • ONLY runs in the browser
 *   • NEVER triggers dynamic imports during SSR
 *   • Uses TTL-based refresh logic inside stores
 *   • Delays Capacitor import until after mount
 * ------------------------------------------------------------
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { useExpensesStore } from "@/lib/stores/useExpensesStore";
import { logPerf, measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { syncAllWorkspaceGeofenceEntryStatus, syncAllWorkspaceGeofenceReminders, } from "@/lib/mobile/geofenceReminderSync";
import { getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";
import { syncAllWorkspaceTimeEntryReminders } from "@/lib/mobile/timeEntryReminderSync";
import { scheduleBackgroundTask } from "@/lib/utils/scheduleBackgroundTask";

const APP_OPEN_REFRESH_DEDUPE_WINDOW_MS = 2000;

export function useAppOpenRefresh() {
    const { user } = useAuth();
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const workspaces = workspaceState.status === "ready" ? workspaceState.workspaces : [];
    const workspaceIdsKey = workspaceState.status === "ready"
        ? workspaceState.workspaces.map((workspace) => workspace.id).join("|")
        : "";
    // Track whether we've already performed the initial app-open refresh.
    const didInitialLoad = useRef(false);
    const lastRefreshAtRef = useRef(0);
    const refreshInFlightRef = useRef(false);
    useEffect(() => {
        if (!user || !activeWorkspaceId) {
            didInitialLoad.current = false;
            lastRefreshAtRef.current = 0;
            refreshInFlightRef.current = false;
            return;
        }
        const shouldRunInitialRefresh = !didInitialLoad.current;
        if (shouldRunInitialRefresh) {
            didInitialLoad.current = true;
        }
        // ---------------------------------------------
        // INTERNAL: Refresh function
        // ---------------------------------------------
        const refreshAll = async () => {
            const now = Date.now();
            if (refreshInFlightRef.current || now - lastRefreshAtRef.current < APP_OPEN_REFRESH_DEDUPE_WINDOW_MS) {
                return;
            }
            refreshInFlightRef.current = true;
            lastRefreshAtRef.current = now;
            const timer = startPerfTimer("app_open_refresh.total", {
                workspaceId: activeWorkspaceId,
                workspaceCount: workspaces.length,
            });
            try {
                // 1) Settings for the active workspace only
                await measureAsync("app_open_refresh.settings", () => useSettingsStore.getState().ensureLoaded(activeWorkspaceId, { force: true }), { workspaceId: activeWorkspaceId });
                // 2) Tax Profile
                await measureAsync("app_open_refresh.tax_profile", () => useTaxProfileStore.getState().refreshFromBackend(activeWorkspaceId, { force: true }), { workspaceId: activeWorkspaceId });
                // 3) Pay Stubs
                await measureAsync("app_open_refresh.pay_stubs", () => usePayStubsStore.getState().refreshFromBackend(activeWorkspaceId, { force: true }), { workspaceId: activeWorkspaceId });
                // 4) Entries and active-period expenses (need current settings)
                const settings = useSettingsStore.getState().byWorkspaceId[activeWorkspaceId]?.data ?? null;
                if (settings) {
                    const workspaceType = workspaceState.status === "ready"
                        ? workspaceState.activeWorkspace.type
                        : "w2";
                    const period = getCurrentEntryPeriod(settings, workspaceType);
                    logPerf("app_open_refresh.entries_period_selected", {
                        workspaceId: activeWorkspaceId,
                        workspaceType,
                        entriesPeriodId: period.periodId,
                        calendarMonthPeriodId: getCurrentCalendarMonthPeriodAt(settings).periodId,
                        periodResolver: workspaceType === "independent" ? "calendar-month" : "w2-pay-period",
                        w2PayFrequency: settings.w2?.payFrequency ?? null,
                        w2PayPeriodStartDate: settings.w2?.payPeriodStartDate ?? null,
                    });
                    await measureAsync("app_open_refresh.entries", () => useEntriesStore
                        .getState()
                        .refreshFromBackend(activeWorkspaceId, period.periodId, { force: true }), { workspaceId: activeWorkspaceId, periodId: period.periodId });
                    if (workspaceType === "independent") {
                        const expensesPeriodId = getCurrentCalendarMonthPeriodAt(settings).periodId;
                        await measureAsync("app_open_refresh.expenses", () => useExpensesStore
                            .getState()
                            .refreshFromBackend(activeWorkspaceId, expensesPeriodId, { force: true }), { workspaceId: activeWorkspaceId, periodId: expensesPeriodId });
                    }
                }
                // 5) Re-sync native reminders/status in the background after the
                // active workspace has finished its critical refresh work.
                scheduleBackgroundTask(async () => {
                    await measureAsync("app_open_refresh.background_sync", async () => {
                        await Promise.all(workspaces.map((workspace) => useSettingsStore.getState().ensureLoaded(workspace.id)));
                        await syncAllWorkspaceTimeEntryReminders(workspaces);
                        await syncAllWorkspaceGeofenceReminders(workspaces);
                        await syncAllWorkspaceGeofenceEntryStatus(workspaces);
                    }, { workspaceCount: workspaces.length });
                });
                timer.success();
            }
            catch (err) {
                timer.failure(err);
            }
            finally {
                refreshInFlightRef.current = false;
            }
        };
        if (shouldRunInitialRefresh) {
            // Match native resume behavior on the first authenticated app open so
            // cross-device updates are pulled in without waiting for focus/resume.
            void refreshAll();
        }
        // ---------------------------------------------
        // WEB: window focus refresh
        // ---------------------------------------------
        const handleFocus = () => refreshAll();
        const handleVisibilityChange = () => {
            if (typeof document !== "undefined" && !document.hidden) {
                void refreshAll();
            }
        };
        if (typeof window !== "undefined") {
            window.addEventListener("focus", handleFocus);
        }
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", handleVisibilityChange);
        }
        // -----------------------------------------------------
        // CAPACITOR: Safe dynamic import AFTER mount
        // -----------------------------------------------------
        let cleanupCapacitor: (() => void) | undefined;
        const setupCapacitor = async () => {
            try {
                // Import AFTER hydration; not bundled into SSR.
                const mod = await import("@capacitor/app");
                const App = mod.App;
                const [appStateChangeHandler, resumeHandler] = await Promise.all([
                    App.addListener("appStateChange", ({ isActive }) => {
                        if (isActive) {
                            void refreshAll();
                        }
                    }),
                    App.addListener("resume", () => {
                        void refreshAll();
                    }),
                ]);
                cleanupCapacitor = () => {
                    appStateChangeHandler.remove();
                    resumeHandler.remove();
                };
            }
            catch (err) {
            }
        };
        // Delay to guarantee we're fully mounted
        if (typeof window !== "undefined") {
            setTimeout(() => {
                setupCapacitor();
            }, 0);
        }
        // ---------------------------------------------
        // CLEANUP
        // ---------------------------------------------
        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("focus", handleFocus);
            }
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", handleVisibilityChange);
            }
            if (cleanupCapacitor)
                cleanupCapacitor();
        };
    }, [user, activeWorkspaceId, workspaceIdsKey]);
}
