"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useDeepLinkStore } from "@/lib/push/deepLinkStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { debugLog } from "@/lib/debugLoop"

// Performs a notification tap's navigation (see deepLinkStore.ts) once the
// workspace list is ready: switches to the notification's workspace if the
// user belongs to it, then navigates client-side — no page reload, so the
// app never reboots through the landing page's redirects.
export default function DeepLinkHandler() {
  const router = useRouter()
  const pending = useDeepLinkStore((state) => state.pending)
  const clearPending = useDeepLinkStore((state) => state.clearPending)
  const workspaceState = useWorkspaceStore((state) => state.state)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)

  useEffect(() => {
    if (!pending || workspaceState.status !== "ready") return

    const target = pending.workspaceId
      ? workspaceState.workspaces.find((workspace) => workspace.id === pending.workspaceId)
      : undefined
    if (target && target.id !== workspaceState.activeWorkspaceId) {
      setActiveWorkspace(target.id)
    }
    if (pending.workspaceId && !target) {
      // Let the review apply to the workspace that's open rather than never.
      useDeepLinkStore.setState((state) => (state.review ? { review: { ...state.review, workspaceId: null } } : {}))
    }
    debugLog("deep-link", "navigate", {
      route: pending.route,
      review: pending.review,
      requestedWorkspaceId: pending.workspaceId,
      switchedWorkspace: Boolean(target && target.id !== workspaceState.activeWorkspaceId),
      // A workspace the user isn't (or is no longer) a member of — stay put.
      unknownWorkspace: Boolean(pending.workspaceId && !target),
    })
    clearPending()
    router.push(pending.route)
  }, [pending, workspaceState, setActiveWorkspace, clearPending, router])

  return null
}
