"use client"

import { useEffect, useRef } from "react"

import type { WorkspaceId } from "@shared/contracts/workspace"
import { debugLog } from "@/lib/debugLoop"

// Imported lazily in Phase 2 when settingsService gains these methods.
// Declared here as a forward reference so the hook compiles in Phase 1
// without wiring anything up.
type SettingsServiceStub = {
  syncPendingIfNeeded: (workspaceId: WorkspaceId) => Promise<void>
  syncAllPendingIfNeeded: (workspaceIds: WorkspaceId[]) => Promise<void>
  registerReconnectSync: (workspaceIds: WorkspaceId[]) => () => void
}

/**
 * Mounts at layout level. Fires pending-patch syncs when workspaces become
 * available and registers a reconnect listener for the active workspace.
 *
 * Not wired to settingsService yet — that happens in Phase 2.
 */
export function useWorkspaceSettingsSync(
  activeWorkspaceId: WorkspaceId | null,
  allWorkspaceIds: WorkspaceId[],
  // Phase 2 will pass the real settingsService here; Phase 1 passes nothing.
  service?: SettingsServiceStub
): void {
  const syncedWorkspaceIds = useRef<Set<WorkspaceId>>(new Set())
  const cleanupReconnectRef = useRef<(() => void) | null>(null)

  // Startup: sync pending patches for any workspace not yet synced this session
  useEffect(() => {
    if (!service) return
    if (allWorkspaceIds.length === 0) return

    const toSync = allWorkspaceIds.filter((id) => !syncedWorkspaceIds.current.has(id))
    if (toSync.length === 0) return

    for (const id of toSync) syncedWorkspaceIds.current.add(id)
    debugLog("settings-save", "startup_sync_triggered", {
      workspaceIds: toSync,
      totalWorkspaces: allWorkspaceIds.length,
    })
    void service.syncAllPendingIfNeeded(toSync)
  }, [service, allWorkspaceIds])

  // Active workspace: sync its pending patch and register reconnect listener
  useEffect(() => {
    if (!service) return
    if (!activeWorkspaceId) return

    debugLog("settings-save", "active_workspace_sync_triggered", {
      activeWorkspaceId,
    })
    void service.syncPendingIfNeeded(activeWorkspaceId)

    const cleanup = service.registerReconnectSync(allWorkspaceIds)
    cleanupReconnectRef.current = cleanup

    return () => {
      cleanup()
      cleanupReconnectRef.current = null
    }
  }, [service, activeWorkspaceId, allWorkspaceIds])
}
