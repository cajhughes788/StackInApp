"use client"

import { create } from "zustand"

import type { WorkspaceId } from "@shared/contracts/workspace"
import type {
  ReceiptDraft,
  ReceiptDraftInput,
  ReceiptDraftPatch,
} from "@shared/schemas/receiptDraft"
import {
  createReceiptDraft as createReceiptDraftApi,
  updateReceiptDraft as updateReceiptDraftApi,
} from "@/lib/api/receiptDraftsApi"
import * as receiptDraftsService from "@/lib/domain/receiptDraftsService"
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession"

type ReceiptDraftsWorkspaceState = {
  drafts: ReceiptDraft[]
  status: "idle" | "loading" | "ready" | "error"
  lastBackendSync: number | null
  hasHydrated: boolean
}

type ReceiptDraftsStoreState = {
  byWorkspaceId: Record<WorkspaceId, ReceiptDraftsWorkspaceState>
  hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>
  hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>
  refreshDrafts: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>
  createDraft: (
    workspaceId: WorkspaceId,
    body: ReceiptDraftInput
  ) => Promise<ReceiptDraft>
  applyDraft: (workspaceId: WorkspaceId, draft: ReceiptDraft) => void
  patchDraftLocally: (
    workspaceId: WorkspaceId,
    receiptDraftId: string,
    patch: ReceiptDraftPatch
  ) => void
  updateDraft: (
    workspaceId: WorkspaceId,
    receiptDraftId: string,
    patch: ReceiptDraftPatch
  ) => Promise<ReceiptDraft>
  removeDraftsForReceiptAsset: (
    workspaceId: WorkspaceId,
    receiptAssetId: string
  ) => void
  clear: (workspaceId?: WorkspaceId) => void
}

const getWorkspaceState = (
  byWorkspaceId: Record<WorkspaceId, ReceiptDraftsWorkspaceState>,
  workspaceId: WorkspaceId
): ReceiptDraftsWorkspaceState =>
  byWorkspaceId[workspaceId] ?? {
    drafts: [],
    status: "idle",
    lastBackendSync: null,
    hasHydrated: false,
  }

const localEditVersionByDraftKey = new Map<string, number>()

function getDraftKey(workspaceId: WorkspaceId, receiptDraftId: string): string {
  return `${workspaceId}:${receiptDraftId}`
}

function bumpLocalEditVersion(workspaceId: WorkspaceId, receiptDraftId: string): number {
  const draftKey = getDraftKey(workspaceId, receiptDraftId)
  const nextVersion = (localEditVersionByDraftKey.get(draftKey) ?? 0) + 1
  localEditVersionByDraftKey.set(draftKey, nextVersion)
  return nextVersion
}

const mergeReceiptDraft = (
  draft: ReceiptDraft,
  patch: ReceiptDraftPatch
): ReceiptDraft => ({
  ...draft,
  ...patch,
  completion: patch.completion
    ? {
        ...draft.completion,
        ...patch.completion,
        missingFields: patch.completion.missingFields ?? draft.completion.missingFields,
        readyToCommit: patch.completion.readyToCommit ?? draft.completion.readyToCommit,
      }
    : draft.completion,
  updatedAt: new Date().toISOString(),
})

function matchesDraftIdentity(left: ReceiptDraft, right: ReceiptDraft): boolean {
  if (left.id === right.id) {
    return true
  }

  return (
    typeof left.receiptAssetId === "string" &&
    left.receiptAssetId.length > 0 &&
    left.receiptAssetId === right.receiptAssetId
  )
}

export const useReceiptDraftsStore = create<ReceiptDraftsStoreState>((set, get) => ({
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId) {
    if (getWorkspaceState(get().byWorkspaceId, workspaceId).hasHydrated) {
      return
    }
    await get().hydrateFromCache(workspaceId)
    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...getWorkspaceState(state.byWorkspaceId, workspaceId),
          hasHydrated: true,
        },
      },
    }))
  },

  async hydrateFromCache(workspaceId) {
    const sessionVersion = getAuthSessionVersion()
    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...getWorkspaceState(state.byWorkspaceId, workspaceId),
          status: "loading",
        },
      },
    }))

    try {
      const cached = await receiptDraftsService.readCachedSnapshot(workspaceId)
      if (!isAuthSessionCurrent(sessionVersion)) return
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            drafts: cached.data,
            status: "ready",
            lastBackendSync: cached.lastBackendSync,
          },
        },
      }))
    } catch {
      if (!isAuthSessionCurrent(sessionVersion)) return
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            status: "error",
          },
        },
      }))
    }
  },

  async refreshDrafts(workspaceId, opts) {
    await get().refreshFromBackend(workspaceId, opts)
  },

  async refreshFromBackend(workspaceId, opts) {
    const sessionVersion = getAuthSessionVersion()
    const { force = false } = opts ?? {}

    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...getWorkspaceState(state.byWorkspaceId, workspaceId),
          status: "loading",
        },
      },
    }))

    try {
      const fresh = await receiptDraftsService.ensureLoaded(workspaceId, {
        forceBackend: force,
      })
      if (!isAuthSessionCurrent(sessionVersion)) return
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            drafts: fresh.data,
            status: "ready",
            lastBackendSync: fresh.lastBackendSync,
          },
        },
      }))
    } catch {
      if (!isAuthSessionCurrent(sessionVersion)) return
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            status: "error",
          },
        },
      }))
    }
  },

  async createDraft(workspaceId, body) {
    const draft = await createReceiptDraftApi(workspaceId, body)
    get().applyDraft(workspaceId, draft)
    return draft
  },

  applyDraft(workspaceId, draft) {
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const exists = workspaceState.drafts.some((candidate) =>
        matchesDraftIdentity(candidate, draft)
      )
      const drafts = exists
        ? workspaceState.drafts.map((candidate) =>
            matchesDraftIdentity(candidate, draft) ? draft : candidate
          )
        : [draft, ...workspaceState.drafts]

      drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      const current = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const primed = receiptDraftsService.prime(workspaceId, drafts, {
        lastBackendSync: current.lastBackendSync ?? Date.now(),
      })

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            drafts,
            status: "ready",
            lastBackendSync: primed.lastBackendSync,
            hasHydrated: current.hasHydrated,
          },
        },
      }
    })
  },

  patchDraftLocally(workspaceId, receiptDraftId, patch) {
    bumpLocalEditVersion(workspaceId, receiptDraftId)
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const drafts = workspaceState.drafts.map((draft) =>
        draft.id === receiptDraftId
          ? mergeReceiptDraft(draft, patch)
          : draft
      )

      drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      const current = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const primed = receiptDraftsService.prime(workspaceId, drafts, {
        lastBackendSync: current.lastBackendSync ?? Date.now(),
      })

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            drafts,
            status: "ready",
            lastBackendSync: primed.lastBackendSync,
            hasHydrated: current.hasHydrated,
          },
        },
      }
    })
  },

  async updateDraft(workspaceId, receiptDraftId, patch) {
    const requestVersion =
      localEditVersionByDraftKey.get(getDraftKey(workspaceId, receiptDraftId)) ?? 0
    const draft = await updateReceiptDraftApi(workspaceId, receiptDraftId, patch)

    const latestVersion =
      localEditVersionByDraftKey.get(getDraftKey(workspaceId, receiptDraftId)) ?? 0
    if (latestVersion > requestVersion) {
      return draft
    }

    get().applyDraft(workspaceId, draft)
    return draft
  },

  removeDraftsForReceiptAsset(workspaceId, receiptAssetId) {
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const drafts = workspaceState.drafts.filter(
        (draft) => draft.receiptAssetId !== receiptAssetId
      )
      const primed = receiptDraftsService.prime(workspaceId, drafts, {
        lastBackendSync: workspaceState.lastBackendSync ?? Date.now(),
      })

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            drafts,
            status: workspaceState.status === "idle" ? "idle" : "ready",
            lastBackendSync: primed.lastBackendSync,
            hasHydrated: workspaceState.hasHydrated,
          },
        },
      }
    })
  },

  clear(workspaceId) {
    if (!workspaceId) {
      void receiptDraftsService.clear()
      set({ byWorkspaceId: {} })
      return
    }

    void receiptDraftsService.clear(workspaceId)
    set((state) => {
      const copy = { ...state.byWorkspaceId }
      delete copy[workspaceId]
      return { byWorkspaceId: copy }
    })
  },
}))
