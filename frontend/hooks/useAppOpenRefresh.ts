"use client";

import { useEffect, useRef } from "react";
import type React from "react";

import { getCalendarMonthBucketAt, getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";

import { useAuth } from "@/contexts/auth-context";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useExpensesStore } from "@/lib/stores/useExpensesStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { logPerf, measureAsync, startPerfTimer } from "@/lib/observability/perf";
import {
  shouldForceForegroundRefresh,
  shouldRefreshForForegroundReason,
  type ForegroundRefreshReason,
} from "@/lib/sync/foregroundRefreshPolicy";

const APP_OPEN_REFRESH_DEDUPE_WINDOW_MS = 2000;
const BOOTSTRAP_FRESH_WINDOW_MS = 60_000;

export function useAppOpenRefresh({
  lastBootstrapAtRef,
}: {
  lastBootstrapAtRef?: React.RefObject<number | null>
} = {}) {
  const { user } = useAuth();
  const workspaceState = useWorkspaceStore((s) => s.state);
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null;
  const workspaces = workspaceState.status === "ready" ? workspaceState.workspaces : [];
  const workspaceIdsKey =
    workspaceState.status === "ready"
      ? workspaceState.workspaces.map((workspace) => workspace.id).join("|")
      : "";

  const didInitialLoad = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const previousWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !activeWorkspaceId || workspaceState.status !== "ready") {
      didInitialLoad.current = false;
      lastRefreshAtRef.current = 0;
      refreshInFlightRef.current = false;
      previousWorkspaceIdRef.current = null;
      return;
    }

    const didWorkspaceChange =
      previousWorkspaceIdRef.current !== null &&
      previousWorkspaceIdRef.current !== activeWorkspaceId;
    previousWorkspaceIdRef.current = activeWorkspaceId;

    const shouldRunInitialRefresh = !didInitialLoad.current;
    if (shouldRunInitialRefresh) {
      didInitialLoad.current = true;
    }

    const shouldRefreshForReason = (reason: ForegroundRefreshReason): boolean => {
      const settingsEntry = useSettingsStore.getState().byWorkspaceId[activeWorkspaceId];
      const settings = settingsEntry?.data ?? null;
      if (!settings) {
        return true;
      }

      const workspaceType = workspaceState.activeWorkspace.type;
      const entryPeriodId = getCurrentEntryPeriod(settings, workspaceType).periodId;
      const entriesEntry = useEntriesStore.getState().byWorkspaceId[activeWorkspaceId];
      const taxEntry = useTaxProfileStore.getState().byWorkspaceId[activeWorkspaceId];

      const resources = [
        settingsEntry?.lastSuccessfulSyncAt ?? null,
        entriesEntry?.periodId === entryPeriodId
          ? entriesEntry.lastSuccessfulSyncAt
          : null,
      ];

      if (workspaceType === "independent") {
        const expensesPeriodId = getCalendarMonthBucketAt(settings);
        const expensesEntry = useExpensesStore.getState().byWorkspaceId[activeWorkspaceId];
        resources.push(
          expensesEntry?.periodId === expensesPeriodId
            ? expensesEntry.lastSuccessfulSyncAt
            : null
        );
      } else {
        resources.push(taxEntry?.lastSuccessfulSyncAt ?? null);
      }

      return shouldRefreshForForegroundReason(resources, reason);
    };

    const refreshAll = async (reason: ForegroundRefreshReason) => {
      const now = Date.now();
      if (
        refreshInFlightRef.current ||
        now - lastRefreshAtRef.current < APP_OPEN_REFRESH_DEDUPE_WINDOW_MS
      ) {
        return;
      }

      if (!shouldRefreshForReason(reason)) {
        return;
      }

      refreshInFlightRef.current = true;
      lastRefreshAtRef.current = now;

      const force = shouldForceForegroundRefresh(reason);
      const timer = startPerfTimer("app_open_refresh.total", {
        workspaceId: activeWorkspaceId,
        workspaceCount: workspaces.length,
        reason,
        force,
      });

      try {
        await measureAsync(
          "app_open_refresh.settings",
          () => useSettingsStore.getState().ensureLoaded(activeWorkspaceId, { force }),
          { workspaceId: activeWorkspaceId, reason }
        );

        const settings = useSettingsStore.getState().byWorkspaceId[activeWorkspaceId]?.data ?? null;
        if (!settings) {
          timer.success({ reason, force, skippedDataRefresh: true });
          return;
        }

        const workspaceType = workspaceState.activeWorkspace.type;
        const period = getCurrentEntryPeriod(settings, workspaceType);

        logPerf("app_open_refresh.entries_period_selected", {
          workspaceId: activeWorkspaceId,
          workspaceType,
          entriesPeriodId: period.periodId,
          calendarMonthPeriodId: getCurrentCalendarMonthPeriodAt(settings).periodId,
          expensesMonthBucket: getCalendarMonthBucketAt(settings),
          periodResolver: workspaceType === "independent" ? "calendar-month" : "w2-pay-period",
          w2PayFrequency: settings.w2?.payFrequency ?? null,
          w2PayPeriodStartDate: settings.w2?.payPeriodStartDate ?? null,
          reason,
        });

        await measureAsync(
          "app_open_refresh.entries",
          () =>
            useEntriesStore
              .getState()
              .refreshFromBackend(activeWorkspaceId, period.periodId, { force }),
          { workspaceId: activeWorkspaceId, periodId: period.periodId, reason }
        );

        if (workspaceType === "independent") {
          const expensesPeriodId = getCalendarMonthBucketAt(settings);
          await measureAsync(
            "app_open_refresh.expenses",
            () =>
              useExpensesStore
                .getState()
                .refreshFromBackend(activeWorkspaceId, expensesPeriodId, { force }),
            { workspaceId: activeWorkspaceId, periodId: expensesPeriodId, reason }
          );
        } else {
          // Tax profile changes infrequently — always TTL-gated regardless of
          // reason. The home page also triggers a background refresh on mount,
          // so forcing here would cause a redundant backend call on every open.
          await measureAsync(
            "app_open_refresh.tax_profile",
            () => useTaxProfileStore.getState().refreshFromBackend(activeWorkspaceId, { force: false }),
            { workspaceId: activeWorkspaceId, reason }
          );
        }

        timer.success({ reason, force });
      } catch (err) {
        timer.failure(err);
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    if (shouldRunInitialRefresh) {
      const lastBootstrapAt = lastBootstrapAtRef?.current ?? null;
      const bootstrapIsFresh =
        lastBootstrapAt !== null &&
        Date.now() - lastBootstrapAt < BOOTSTRAP_FRESH_WINDOW_MS;
      if (!bootstrapIsFresh) {
        void refreshAll("initial");
      }
    } else if (didWorkspaceChange) {
      void refreshAll("workspace-change");
    }

    const handleFocus = () => {
      void refreshAll("focus");
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void refreshAll("visibility");
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    let cleanupCapacitor: (() => void) | undefined;
    const setupCapacitor = async () => {
      try {
        const mod = await import("@capacitor/app");
        const App = mod.App;
        // Use appStateChange only — on iOS, `resume` fires immediately after
        // appStateChange(isActive: true), causing a duplicate refresh within
        // the dedupe window. appStateChange covers both iOS and Android resume.
        const appStateChangeHandler = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            void refreshAll("app-active");
          }
        });

        cleanupCapacitor = () => {
          appStateChangeHandler.remove();
        };
      } catch {}
    };

    if (typeof window !== "undefined") {
      setTimeout(() => {
        void setupCapacitor();
      }, 0);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (cleanupCapacitor) cleanupCapacitor();
    };
  }, [user, activeWorkspaceId, workspaceIdsKey, workspaceState]);
}
