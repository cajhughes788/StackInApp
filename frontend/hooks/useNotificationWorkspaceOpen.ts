"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Capacitor } from "@capacitor/core"
import { LocalNotifications } from "@capacitor/local-notifications"

import { debugError, debugLog } from "@/lib/debugLoop"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

type PendingWorkspaceOpen = {
  workspaceId: string
  kind: string | null
}

function logNotificationOpenInfo(stage: string, payload: Record<string, unknown> = {}) {
  console.info(`[NotificationOpen] ${stage}`, payload)
}

function logNotificationOpenError(stage: string, payload: Record<string, unknown> = {}) {
  console.error(`[NotificationOpen] ${stage}`, payload)
}

function extractWorkspaceOpenTarget(event: unknown): PendingWorkspaceOpen | null {
  const payload = event as {
    notification?: {
      extra?: {
        workspaceId?: unknown
        kind?: unknown
      }
    }
  }

  const extra = payload?.notification?.extra
  if (!extra || typeof extra.workspaceId !== "string" || extra.workspaceId.length === 0) {
    return null
  }

  return {
    workspaceId: extra.workspaceId,
    kind: typeof extra.kind === "string" ? extra.kind : null,
  }
}

export function useNotificationWorkspaceOpen(status: string) {
  const router = useRouter()
  const workspaceState = useWorkspaceStore((state) => state.state)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const [pendingTarget, setPendingTarget] = useState<PendingWorkspaceOpen | null>(null)
  const lastHandledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return
    }

    let cancelled = false
    let cleanup: { remove: () => Promise<void> | void } | null = null

    async function setup() {
      try {
        cleanup = await LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (event) => {
            if (cancelled) {
              return
            }

            const target = extractWorkspaceOpenTarget(event)
            if (!target) {
              return
            }

            debugLog("notification-workspace-open", "action_performed", {
              workspaceId: target.workspaceId,
              kind: target.kind,
              status,
              workspaceStatus: workspaceState.status,
            })
            logNotificationOpenInfo("action_performed", {
              workspaceId: target.workspaceId,
              kind: target.kind,
              status,
              workspaceStatus: workspaceState.status,
            })

            setActiveWorkspace(target.workspaceId)
            setPendingTarget(target)
          }
        )
      } catch (error) {
        logNotificationOpenError("listener_setup_failed", {
          message: error instanceof Error ? error.message : String(error),
        })
        debugError("notification-workspace-open", "listener_setup_failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    void setup()

    return () => {
      cancelled = true
      void cleanup?.remove()
    }
  }, [setActiveWorkspace, status, workspaceState.status])

  useEffect(() => {
    if (!pendingTarget) {
      return
    }

    setActiveWorkspace(pendingTarget.workspaceId)

    if (status !== "ready" || workspaceState.status !== "ready") {
      return
    }

    const workspaceExists = workspaceState.workspaces.some(
      (workspace) => workspace.id === pendingTarget.workspaceId
    )
    if (!workspaceExists) {
      debugLog("notification-workspace-open", "workspace_missing", {
        workspaceId: pendingTarget.workspaceId,
        kind: pendingTarget.kind,
      })
      logNotificationOpenInfo("workspace_missing", {
        workspaceId: pendingTarget.workspaceId,
        kind: pendingTarget.kind,
      })
      setPendingTarget(null)
      return
    }

    if (lastHandledRef.current === pendingTarget.workspaceId) {
      setPendingTarget(null)
      return
    }

    lastHandledRef.current = pendingTarget.workspaceId
    debugLog("notification-workspace-open", "navigate_home", {
      workspaceId: pendingTarget.workspaceId,
      kind: pendingTarget.kind,
    })
    logNotificationOpenInfo("navigate_home", {
      workspaceId: pendingTarget.workspaceId,
      kind: pendingTarget.kind,
    })
    router.replace("/app/home")
    setPendingTarget(null)
  }, [pendingTarget, router, setActiveWorkspace, status, workspaceState])
}
