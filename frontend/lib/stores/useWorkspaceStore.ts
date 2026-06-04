import { create } from "zustand"
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore"

import { getDbSafe } from "@/lib/firebase"
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession"
import { debugLog } from "@/lib/debugLoop"
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace"

const WORKSPACE_HYDRATE_TIMEOUT_MS = 15_000

function withHydrateTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${WORKSPACE_HYDRATE_TIMEOUT_MS}ms`)),
      WORKSPACE_HYDRATE_TIMEOUT_MS
    )
    promise.then(
      (v) => { window.clearTimeout(id); resolve(v) },
      (e) => { window.clearTimeout(id); reject(e) }
    )
  })
}

import type {
  WorkspaceId,
  WorkspaceMembership,
  WorkspaceSummary,
} from "@shared/contracts/workspace"

// ------------------------------------------------------------
// Workspace Hydration State (authoritative)
// ------------------------------------------------------------
type WorkspaceState =
  | { status: "loading" }
  | { status: "no-workspace" }
  | {
      status: "ready"
      workspaces: WorkspaceSummary[]
      activeWorkspaceId: WorkspaceId
      activeWorkspace: WorkspaceSummary
    }

const ACTIVE_WORKSPACE_STORAGE_KEY = "stackin-active-workspace-id"
const WORKSPACE_SNAPSHOT_STORAGE_KEY = "stackin-workspace-snapshot"
const WORKSPACE_SNAPSHOT_TTL_MS = 5 * 60 * 1000

function isWorkspaceType(value: unknown): value is WorkspaceSummary["type"] {
  return value === "w2" || value === "independent"
}

function isWorkspaceStatus(value: unknown): value is WorkspaceSummary["status"] {
  return value === "active" || value === "archived"
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  if (!value || typeof value !== "object") return false
  const workspace = value as Record<string, unknown>
  return (
    typeof workspace.id === "string" &&
    workspace.id.length > 0 &&
    typeof workspace.name === "string" &&
    workspace.name.length > 0 &&
    isWorkspaceType(workspace.type) &&
    isWorkspaceStatus(workspace.status)
  )
}

function loadPersistedActiveWorkspaceId(): WorkspaceId | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
}

function persistActiveWorkspaceId(workspaceId: WorkspaceId) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId)
}

function clearPersistedActiveWorkspaceId() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
}

function loadPersistedWorkspaceSnapshot(uid: string): {
  state: Extract<WorkspaceState, { status: "ready" }> | null
  reason: string | null
  isFresh: boolean
} {
  if (typeof window === "undefined") return { state: null, reason: null, isFresh: false }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY)
    if (!raw) return { state: null, reason: null, isFresh: false }
    const parsed = JSON.parse(raw) as {
      uid?: string
      workspaces?: unknown
      activeWorkspaceId?: unknown
      writtenAt?: unknown
    }
    if (parsed.uid !== uid) {
      return { state: null, reason: "uid-mismatch", isFresh: false }
    }
    if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
      return { state: null, reason: "missing-workspaces", isFresh: false }
    }
    const workspaces = parsed.workspaces.filter(isWorkspaceSummary)
    if (workspaces.length !== parsed.workspaces.length) {
      return { state: null, reason: "invalid-workspace-shape", isFresh: false }
    }
    if (typeof parsed.activeWorkspaceId !== "string" || parsed.activeWorkspaceId.length === 0) {
      return { state: null, reason: "invalid-active-workspace-id", isFresh: false }
    }
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === parsed.activeWorkspaceId) ??
      workspaces[0]
    if (!activeWorkspace) return { state: null, reason: "missing-active-workspace", isFresh: false }
    const writtenAt = typeof parsed.writtenAt === "number" ? parsed.writtenAt : 0
    const isFresh = Date.now() - writtenAt < WORKSPACE_SNAPSHOT_TTL_MS
    return {
      state: {
        status: "ready",
        workspaces,
        activeWorkspaceId: activeWorkspace.id,
        activeWorkspace,
      },
      reason: null,
      isFresh,
    }
  } catch {
    return { state: null, reason: "snapshot-parse-failed", isFresh: false }
  }
}

function persistWorkspaceSnapshot(
  uid: string,
  workspaces: WorkspaceSummary[],
  activeWorkspaceId: WorkspaceId
) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      WORKSPACE_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        uid,
        workspaces,
        activeWorkspaceId,
        writtenAt: Date.now(),
      })
    )
  } catch {
    // ignore storage failures
  }
}

function clearPersistedWorkspaceSnapshot() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(WORKSPACE_SNAPSHOT_STORAGE_KEY)
}

function updatePersistedWorkspaceSnapshotAfterRemoval(
  workspaces: WorkspaceSummary[],
  activeWorkspaceId: WorkspaceId
) {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      uid?: string
    }
    window.localStorage.setItem(
      WORKSPACE_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        uid: parsed.uid,
        workspaces,
        activeWorkspaceId,
      })
    )
  } catch {
    // ignore storage failures
  }
}

function updatePersistedWorkspaceSnapshot(
  workspaces: WorkspaceSummary[],
  activeWorkspaceId: WorkspaceId
) {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      uid?: string
    }
    if (!parsed.uid) return
    window.localStorage.setItem(
      WORKSPACE_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        uid: parsed.uid,
        workspaces,
        activeWorkspaceId,
      })
    )
  } catch {
    // ignore storage failures
  }
}

// ------------------------------------------------------------
// Store Interface
// ------------------------------------------------------------
interface WorkspaceStore {
  state: WorkspaceState

  /**
   * Explicitly hydrate workspace context after auth resolves.
   * Called from (app)/layout.tsx
   */
  hydrate: (
    uid: string,
    options?: {
      traceId?: string
      flow?: string
    }
  ) => Promise<void>
  setActiveWorkspace: (workspaceId: WorkspaceId) => void
  addWorkspace: (workspace: WorkspaceSummary, makeActive?: boolean) => void
  updateWorkspace: (
    workspaceId: WorkspaceId,
    patch: Partial<Pick<WorkspaceSummary, "name" | "type" | "status">>
  ) => void
  removeWorkspace: (workspaceId: WorkspaceId) => void

  /**
   * Clear all workspace state (logout)
   */
  clear: () => void
}

// ------------------------------------------------------------
// Store Implementation
// ------------------------------------------------------------
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  state: { status: "loading" },

  hydrate: async (uid: string, options) => {
    const sessionVersion = getAuthSessionVersion()
    const cachedSnapshot = loadPersistedWorkspaceSnapshot(uid)
    const cachedState = cachedSnapshot.state
    debugLog("workspace-store", "hydrate_start", {
      uid,
      sessionVersion,
      hasCachedState: cachedState !== null,
      cachedWorkspaceCount: cachedState?.workspaces.length ?? 0,
      cachedSnapshotReason: cachedSnapshot.reason,
      cachedSnapshotFresh: cachedSnapshot.isFresh,
    })
    if (cachedSnapshot.state === null && cachedSnapshot.reason) {
      clearPersistedWorkspaceSnapshot()
      clearPersistedActiveWorkspaceId()
      debugLog("workspace-store", "cached_snapshot_rejected", {
        uid,
        reason: cachedSnapshot.reason,
      })
    }
    if (isAuthSessionCurrent(sessionVersion)) {
      set({ state: cachedState ?? { status: "loading" } })
    }

    if (cachedSnapshot.isFresh && cachedState !== null) {
      debugLog("workspace-store", "hydrate_skipped_fresh_cache", {
        uid,
        activeWorkspaceId: cachedState.activeWorkspaceId,
        workspaceCount: cachedState.workspaces.length,
      })
      return
    }

    const db = getDbSafe()
    const trace =
      options?.traceId && options?.flow
        ? createProfileTrace(options.flow, { uid }, options.traceId)
        : null

    let membershipsSnap: Awaited<ReturnType<typeof getDocs>>
    let workspaceSnaps: Awaited<ReturnType<typeof getDoc>>[]

    try {
      //Load workspace memberships for user
      membershipsSnap = await withHydrateTimeout(
        withProfileStep(
          trace,
          "startup.workspace_memberships_fetch",
          () => getDocs(collection(db, "users", uid, "memberships")),
          { uid }
        ),
        "workspace memberships fetch"
      )

      if (!isAuthSessionCurrent(sessionVersion)) {
        debugLog("workspace-store", "hydrate_abort_after_memberships", {
          uid,
          sessionVersion,
        })
        return
      }

      if (membershipsSnap.empty) {
        debugLog("workspace-store", "no_workspace", { uid })
        set({ state: { status: "no-workspace" } })
        clearPersistedWorkspaceSnapshot()
        return
      }

      const workspaceIds = membershipsSnap.docs.map(
        (membershipDoc) =>
          (membershipDoc.data() as WorkspaceMembership).workspaceId as WorkspaceId
      )

      workspaceSnaps = await withHydrateTimeout(
        withProfileStep(
          trace,
          "startup.workspace_docs_fetch",
          () =>
            Promise.all(
              workspaceIds.map((workspaceId) => getDoc(doc(db, "workspaces", workspaceId)))
            ),
          { workspaceCount: workspaceIds.length }
        ),
        "workspace docs fetch"
      )
    } catch (error) {
      debugLog("workspace-store", "hydrate_firestore_error", {
        uid,
        message: error instanceof Error ? error.message : String(error),
        hasCachedState: cachedState !== null,
      })
      if (cachedState !== null && isAuthSessionCurrent(sessionVersion)) {
        // Firestore timed out or failed — cached state is already set above, leave it
        return
      }
      if (isAuthSessionCurrent(sessionVersion)) {
        set({ state: { status: "no-workspace" } })
      }
      return
    }

    debugLog("workspace-store", "memberships_loaded", {
      uid,
      membershipCount: membershipsSnap.docs.length,
    })

    if (!isAuthSessionCurrent(sessionVersion)) {
      debugLog("workspace-store", "hydrate_abort_after_workspace_docs", {
        uid,
        sessionVersion,
      })
      return
    }

    const workspaces: WorkspaceSummary[] = workspaceSnaps
      .filter((workspaceSnap) => workspaceSnap.exists())
      .map((workspaceSnap) => {
        const ws = workspaceSnap.data() as Record<string, unknown>
        return {
          id: workspaceSnap.id as WorkspaceId,
          name: ws.name as string,
          type: ws.type as WorkspaceSummary["type"],
          status: ws.status as WorkspaceSummary["status"],
        }
      })
      .filter((workspace) => workspace.status === "active")

    debugLog("workspace-store", "workspace_docs_loaded", {
      uid,
      workspaceCount: workspaceSnaps.length,
      activeWorkspaceCount: workspaces.length,
      workspaceTypes: workspaces.map((workspace) => workspace.type),
    })

    if (workspaces.length === 0) {
      debugLog("workspace-store", "no_active_workspaces", { uid })
      set({ state: { status: "no-workspace" } })
      clearPersistedWorkspaceSnapshot()
      return
    }

    const persistedWorkspaceId = loadPersistedActiveWorkspaceId()
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === persistedWorkspaceId) ??
      workspaces[0]

    if (!isAuthSessionCurrent(sessionVersion)) {
      debugLog("workspace-store", "hydrate_abort_before_commit", {
        uid,
        sessionVersion,
      })
      return
    }
    persistActiveWorkspaceId(activeWorkspace.id)
    persistWorkspaceSnapshot(uid, workspaces, activeWorkspace.id)

    debugLog("workspace-store", "hydrate_commit", {
      uid,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspaceType: activeWorkspace.type,
      workspaceCount: workspaces.length,
    })
    set({
      state: {
        status: "ready",
        workspaces,
        activeWorkspaceId: activeWorkspace.id,
        activeWorkspace,
      },
    })
    trace?.mark("startup.workspace_ready", {
      workspaceCount: workspaces.length,
      activeWorkspaceId: activeWorkspace.id,
    })
  },

  setActiveWorkspace: (workspaceId: WorkspaceId) => {
    persistActiveWorkspaceId(workspaceId)

    set((current) => {
      if (current.state.status !== "ready") return current

      const nextActiveWorkspace = current.state.workspaces.find(
        (workspace) => workspace.id === workspaceId
      )

      if (!nextActiveWorkspace) return current

      debugLog("workspace-store", "set_active_workspace", {
        previousWorkspaceId: current.state.activeWorkspaceId,
        nextWorkspaceId: workspaceId,
      })

      updatePersistedWorkspaceSnapshot(
        current.state.workspaces,
        workspaceId
      )

      return {
        state: {
          ...current.state,
          activeWorkspaceId: workspaceId,
          activeWorkspace: nextActiveWorkspace,
        },
      }
    })
  },

  addWorkspace: (workspace: WorkspaceSummary, makeActive = true) => {
    set((current) => {
      if (current.state.status === "loading" || current.state.status === "no-workspace") {
        if (makeActive) persistActiveWorkspaceId(workspace.id)
        return {
          state: {
            status: "ready",
            workspaces: [workspace],
            activeWorkspaceId: workspace.id,
            activeWorkspace: workspace,
          },
        }
      }

      const existing = current.state.workspaces.filter(
        (existingWorkspace) => existingWorkspace.id !== workspace.id
      )
      const workspaces = [...existing, workspace]
      const activeWorkspace = makeActive ? workspace : current.state.activeWorkspace
      const activeWorkspaceId = makeActive
        ? workspace.id
        : current.state.activeWorkspaceId

      if (makeActive) persistActiveWorkspaceId(workspace.id)
      updatePersistedWorkspaceSnapshot(workspaces, activeWorkspaceId)

      return {
        state: {
          ...current.state,
          workspaces,
          activeWorkspaceId,
          activeWorkspace,
        },
      }
    })
  },

  updateWorkspace: (workspaceId, patch) => {
    set((current) => {
      if (current.state.status !== "ready") return current

      const workspaces = current.state.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, ...patch } : workspace
      )
      const activeWorkspace =
        current.state.activeWorkspaceId === workspaceId
          ? {
              ...current.state.activeWorkspace,
              ...patch,
            }
          : current.state.activeWorkspace

      updatePersistedWorkspaceSnapshot(
        workspaces,
        current.state.activeWorkspaceId
      )

      return {
        state: {
          ...current.state,
          workspaces,
          activeWorkspace,
        },
      }
    })
  },

  removeWorkspace: (workspaceId) => {
    set((current) => {
      if (current.state.status !== "ready") return current
      const readyState = current.state

      const workspaces = readyState.workspaces.filter(
        (workspace) => workspace.id !== workspaceId
      )

      if (workspaces.length === 0) {
        clearPersistedActiveWorkspaceId()
        clearPersistedWorkspaceSnapshot()
        return {
          state: { status: "no-workspace" },
        }
      }

      const nextActiveWorkspace =
        readyState.activeWorkspaceId === workspaceId
          ? workspaces[0]
          : workspaces.find(
              (workspace) => workspace.id === readyState.activeWorkspaceId
            ) ?? workspaces[0]

      persistActiveWorkspaceId(nextActiveWorkspace.id)
      updatePersistedWorkspaceSnapshotAfterRemoval(
        workspaces,
        nextActiveWorkspace.id
      )

      return {
        state: {
          status: "ready",
          workspaces,
          activeWorkspaceId: nextActiveWorkspace.id,
          activeWorkspace: nextActiveWorkspace,
        },
      }
    })
  },

  clear: () => {
    debugLog("workspace-store", "clear")
    clearPersistedActiveWorkspaceId()
    clearPersistedWorkspaceSnapshot()
    set({ state: { status: "loading" } })
  },
}))
