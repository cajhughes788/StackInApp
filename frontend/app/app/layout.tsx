"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import AppLoader from "@/components/app-loader"
import { NativePermissionGuideDialog } from "@/components/mobile/NativePermissionGuideDialog"
import { Toaster } from "@/components/ui/toaster"
import { useGeofenceReminderEvents } from "@/hooks/useGeofenceReminderEvents"
import { useNotificationDiagnostics } from "@/hooks/useNotificationDiagnostics"
import { useOfflineReplay } from "@/hooks/useOfflineReplay"
import { useNotificationWorkspaceOpen } from "@/hooks/useNotificationWorkspaceOpen"
import {
  syncAllWorkspaceGeofenceEntryStatus,
  syncAllWorkspaceGeofenceReminders,
} from "@/lib/mobile/geofenceReminderSync"
import { measureAsync } from "@/lib/observability/perf"
import { useAppOpenRefresh } from "@/hooks/useAppOpenRefresh"
import { syncAllWorkspaceTimeEntryReminders } from "@/lib/mobile/timeEntryReminderSync"
import { scheduleBackgroundTask } from "@/lib/utils/scheduleBackgroundTask"
import { debugError, debugLog } from "@/lib/debugLoop"
import { useAppBootstrap } from "@/hooks/useAppBootstrap"
import { AppBootstrapProvider } from "@/contexts/app-bootstrap-context"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore"
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore"
import { useProfitLossStore } from "@/lib/stores/useProfitLossStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
import { getCurrentEntryPeriod } from "@shared/payPeriods"
import * as expenseRepository from "@/lib/domain/expenseRepository"

function getCurrentMonthPeriodId() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { status, user, workspaceState, canRenderCachedWorkspace, contextReady } = useAppBootstrap()

  useAppOpenRefresh()
  useGeofenceReminderEvents()
  useNotificationDiagnostics()
  useNotificationWorkspaceOpen(status)
  useOfflineReplay()

  useEffect(() => {
    debugLog("app-layout", "render_state", {
      status,
      uid: user?.uid ?? null,
      workspaceStatus: workspaceState.status,
      activeWorkspaceId:
        workspaceState.status === "ready"
          ? workspaceState.activeWorkspaceId
          : null,
      activeWorkspaceType:
        workspaceState.status === "ready"
          ? workspaceState.activeWorkspace.type
          : null,
    })
  }, [status, user?.uid, workspaceState.status, workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null])

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      debugError("app-layout", "window_error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        errorMessage: event.error?.message ?? null,
        errorStack: event.error?.stack ?? null,
        status,
        uid: user?.uid ?? null,
        workspaceStatus: workspaceState.status,
        activeWorkspaceId:
          workspaceState.status === "ready"
            ? workspaceState.activeWorkspaceId
            : null,
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      debugError("app-layout", "unhandled_rejection", {
        message:
          reason instanceof Error
            ? reason.message
            : typeof reason === "string"
            ? reason
            : null,
        stack: reason instanceof Error ? reason.stack : null,
        reason,
        status,
        uid: user?.uid ?? null,
        workspaceStatus: workspaceState.status,
        activeWorkspaceId:
          workspaceState.status === "ready"
            ? workspaceState.activeWorkspaceId
            : null,
      })
    }

    window.addEventListener("error", handleError)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    return () => {
      window.removeEventListener("error", handleError)
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
    }
  }, [status, user?.uid, workspaceState])

  useEffect(() => {
    if (
      status === "auth-loading" ||
      status === "workspace-loading"
    ) {
      return
    }

    if (status === "no-user") {
      router.replace("/login")
      return
    }

    if (status === "no-workspace") {
      router.replace("/welcome")
    }
  }, [status, router])

  useEffect(() => {
    if (!user || workspaceState.status !== "ready" || status !== "ready") return
    const cancelBackgroundSync = scheduleBackgroundTask(async () => {
      await measureAsync(
        "app_layout.background_workspace_sync",
        async () => {
          await syncAllWorkspaceTimeEntryReminders(workspaceState.workspaces)
          await syncAllWorkspaceGeofenceReminders(workspaceState.workspaces)
          await syncAllWorkspaceGeofenceEntryStatus(workspaceState.workspaces)
        },
        {
          workspaceCount: workspaceState.workspaces.length,
        }
      )
    })

    return cancelBackgroundSync
  }, [user, workspaceState, status])

  useEffect(() => {
    if (!user || workspaceState.status !== "ready" || status !== "ready") return

    const inactiveWorkspaces = workspaceState.workspaces.filter(
      (workspace) => workspace.id !== workspaceState.activeWorkspaceId
    )

    if (inactiveWorkspaces.length === 0) return

    const cancelPrefetch = scheduleBackgroundTask(async () => {
      await measureAsync(
        "app_layout.inactive_workspace_prefetch",
        async () => {
          for (const workspace of inactiveWorkspaces) {
            await useSettingsStore.getState().ensureLoaded(workspace.id)

            const settings =
              useSettingsStore.getState().byWorkspaceId[workspace.id]?.data ?? null

            if (!settings) {
              continue
            }

            const period = getCurrentEntryPeriod(settings, workspace.type)
            await useEntriesStore
              .getState()
              .hydrateFromCacheOnce(workspace.id, period.periodId)

            void useEntriesStore
              .getState()
              .refreshFromBackend(workspace.id, period.periodId, { force: false })

            if (workspace.type === "independent") {
              const now = new Date()
              const expensesPeriodId = `${now.getFullYear()}-${String(
                now.getMonth() + 1
              ).padStart(2, "0")}`

              await useExpensesStore
                .getState()
                .hydrateFromCacheOnce(workspace.id, expensesPeriodId)

              await Promise.all(
                (["month", "quarter", "year"] as const).map((periodType) =>
                  useProfitLossStore
                    .getState()
                    .hydrateFromCacheOnce(workspace.id, periodType)
                )
              )

              continue
            }

            await useTaxProfileStore.getState().hydrateFromCacheOnce(workspace.id)
            await usePayStubsStore.getState().hydrateFromCacheOnce(workspace.id)
          }
        },
        {
          workspaceCount: inactiveWorkspaces.length,
        }
      )
    })

    return cancelPrefetch
  }, [user, workspaceState, status])

  useEffect(() => {
    if (!user || workspaceState.status !== "ready" || status !== "ready") return

    const orderedWorkspaces = [
      workspaceState.activeWorkspace,
      ...workspaceState.workspaces.filter(
        (workspace) => workspace.id !== workspaceState.activeWorkspaceId
      ),
    ]

    const cancelDocumentWarmup = scheduleBackgroundTask(async () => {
      await measureAsync(
        "app_layout.secondary_documents_warmup",
        async () => {
          for (const workspace of orderedWorkspaces) {
            if (workspace.type === "w2") {
              await usePayStubsStore.getState().hydrateFromCacheOnce(workspace.id)
              await usePayStubsStore
                .getState()
                .refreshFromBackend(workspace.id, { force: false })
              continue
            }

            const currentMonthPeriodId = getCurrentMonthPeriodId()

            await Promise.all(
              (["month", "quarter", "year"] as const).map(async (periodType) => {
                await useProfitLossStore
                  .getState()
                  .hydrateFromCacheOnce(workspace.id, periodType)
                await useProfitLossStore
                  .getState()
                  .refreshFromBackend(workspace.id, periodType, { force: false })
              })
            )

            await useReceiptDraftsStore.getState().hydrateFromCacheOnce(workspace.id)
            await useReceiptDraftsStore
              .getState()
              .refreshFromBackend(workspace.id, { force: false })

            await expenseRepository.ensureLoaded(workspace.id, currentMonthPeriodId, {
              forceBackend: false,
            })
          }
        },
        {
          workspaceCount: orderedWorkspaces.length,
        }
      )
    }, { delayMs: 1200, timeoutMs: 4000 })

    return cancelDocumentWarmup
  }, [user, workspaceState, status])
	
  // ------------------------------------------------------------
  // Blocking states
  // ------------------------------------------------------------
  if (
    status === "auth-loading" ||
    ((status === "workspace-loading" || status === "no-user" || status === "no-workspace") &&
      !canRenderCachedWorkspace)
  ) {
    return <AppLoader label="Loading your workspace..." />
  }
	
  // ------------------------------------------------------------
  // Workspace ready → unlock app
  // ------------------------------------------------------------
  return (
    <AppBootstrapProvider value={{ status, canRenderCachedWorkspace, contextReady }}>
      <NativePermissionGuideDialog />
      <Toaster />
      {children}
    </AppBootstrapProvider>
  )
}
