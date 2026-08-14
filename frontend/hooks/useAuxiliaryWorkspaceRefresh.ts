"use client"

import { useEffect } from "react"

import { getCalendarMonthBucketAt, getCalendarMonthBucketFromDate, getCurrentEntryPeriod } from "@shared/payPeriods"

import {
  syncAllWorkspaceGeofenceEntryStatus,
  syncAllWorkspaceGeofenceReminders,
} from "@/lib/mobile/geofenceReminderSync"
import { syncAllWorkspaceTimeEntryReminders } from "@/lib/mobile/timeEntryReminderSync"
import { measureAsync } from "@/lib/observability/perf"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { usePeriodSelectionStore } from "@/lib/stores/usePeriodSelectionStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { scheduleBackgroundTask } from "@/lib/utils/scheduleBackgroundTask"

export function useAuxiliaryWorkspaceRefresh({ enabled }: { enabled: boolean }) {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const readyWorkspaceState = workspaceState.status === "ready" ? workspaceState : null
  const activeWorkspaceId = readyWorkspaceState?.activeWorkspaceId ?? null
  const workspaceIdsKey = readyWorkspaceState
    ? readyWorkspaceState.workspaces.map((workspace) => `${workspace.id}:${workspace.type}`).join("|")
    : ""

  useEffect(() => {
    if (!enabled || !readyWorkspaceState) {
      return
    }

    const cancelBackgroundSync = scheduleBackgroundTask(async () => {
      await measureAsync(
        "app_auxiliary_refresh.background_workspace_sync",
        async () => {
          await syncAllWorkspaceTimeEntryReminders(readyWorkspaceState.workspaces)
          await syncAllWorkspaceGeofenceReminders(readyWorkspaceState.workspaces)
          await syncAllWorkspaceGeofenceEntryStatus(readyWorkspaceState.workspaces)
        },
        {
          workspaceCount: readyWorkspaceState.workspaces.length,
        }
      )
    })

    return cancelBackgroundSync
  }, [enabled, workspaceIdsKey, readyWorkspaceState])

  useEffect(() => {
    if (!enabled || !readyWorkspaceState) {
      return
    }

    const inactiveWorkspaces = readyWorkspaceState.workspaces.filter(
      (workspace) => workspace.id !== readyWorkspaceState.activeWorkspaceId
    )

    if (inactiveWorkspaces.length === 0) {
      return
    }

    const cancelPrefetch = scheduleBackgroundTask(
      async () => {
        await measureAsync(
          "app_auxiliary_refresh.inactive_workspace_prefetch",
          async () => {
            for (const workspace of inactiveWorkspaces) {
              await useSettingsStore.getState().ensureLoaded(workspace.id)

              const settings =
                useSettingsStore.getState().byWorkspaceId[workspace.id]?.data ?? null

              if (!settings) {
                continue
              }

              const selectedPeriod = usePeriodSelectionStore.getState().byWorkspaceId[workspace.id] ?? null
              const period = selectedPeriod ?? getCurrentEntryPeriod(settings, workspace.type)
              await useEntriesStore
                .getState()
                .hydrateFromCacheOnce(workspace.id, period.periodId)

              void useEntriesStore
                .getState()
                .refreshFromBackend(workspace.id, period.periodId, { force: false })

              if (workspace.type === "independent") {
                const expensesPeriodId = selectedPeriod
                  ? getCalendarMonthBucketFromDate(selectedPeriod.start, settings)
                  : getCalendarMonthBucketAt(settings)

                await useExpensesStore
                  .getState()
                  .hydrateFromCacheOnce(workspace.id, expensesPeriodId)

                await useReceiptDraftsStore.getState().hydrateFromCacheOnce(workspace.id)
                void useReceiptDraftsStore
                  .getState()
                  .refreshFromBackend(workspace.id, { force: false })
              } else {
                await useTaxProfileStore.getState().hydrateFromCacheOnce(workspace.id)
              }
            }
          },
          {
            workspaceCount: inactiveWorkspaces.length,
          }
        )
      },
      { delayMs: 1200, timeoutMs: 4000 }
    )

    return cancelPrefetch
  }, [enabled, activeWorkspaceId, workspaceIdsKey, readyWorkspaceState])
}
