"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import AppLoader from "@/components/app-loader"
import { NativePermissionGuideDialog } from "@/components/mobile/NativePermissionGuideDialog"
import { Toaster } from "@/components/ui/toaster"
import { useGeofenceReminderEvents } from "@/hooks/useGeofenceReminderEvents"
import { useNotificationDiagnostics } from "@/hooks/useNotificationDiagnostics"
import { useOfflineReplay } from "@/hooks/useOfflineReplay"
import { useWorkspaceSettingsSync } from "@/hooks/useWorkspaceSettingsSync"
import * as settingsService from "@/lib/domain/settingsService"
import { useNotificationWorkspaceOpen } from "@/hooks/useNotificationWorkspaceOpen"
import { useAuxiliaryWorkspaceRefresh } from "@/hooks/useAuxiliaryWorkspaceRefresh"
import { useAppOpenRefresh } from "@/hooks/useAppOpenRefresh"
import { debugError, debugLog } from "@/lib/debugLoop"
import { useAppBootstrap } from "@/hooks/useAppBootstrap"
import { AppBootstrapProvider } from "@/contexts/app-bootstrap-context"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const {
    status,
    user,
    workspaceState,
    canRenderCachedWorkspace,
    contextReady,
    authorityStatus,
    authority,
    refreshAuthority,
    lastBootstrapAtRef,
  } = useAppBootstrap()

  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const allWorkspaceIds =
    workspaceState.status === "ready"
      ? workspaceState.workspaces.map((w) => w.id)
      : []

  useAppOpenRefresh({ lastBootstrapAtRef })
  useAuxiliaryWorkspaceRefresh({ enabled: contextReady })
  useGeofenceReminderEvents()
  useNotificationDiagnostics()
  useNotificationWorkspaceOpen(status)
  useOfflineReplay()
  useWorkspaceSettingsSync(activeWorkspaceId, allWorkspaceIds, settingsService)

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
	
  // ------------------------------------------------------------
  // Blocking states — only block if we have nothing cached to show
  // ------------------------------------------------------------
  const shouldBlock =
    status === "auth-loading" ||
    ((status === "workspace-loading" || status === "no-user" || status === "no-workspace") &&
      !canRenderCachedWorkspace)

  return (
    <AppBootstrapProvider
      value={{
        status,
        canRenderCachedWorkspace,
        contextReady,
        authorityStatus,
        authority,
        refreshAuthority,
      }}
    >
      <NativePermissionGuideDialog />
      <Toaster />
      {shouldBlock ? <AppLoader label="Loading your workspace..." /> : children}
    </AppBootstrapProvider>
  )
}
