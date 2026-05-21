"use client"

import { create } from "zustand"

import type { WorkspaceId } from "@shared/contracts/workspace"
import type { ImportBatch, ImportItem } from "@shared/schemas/import"
import {
  createImportBatch as createImportBatchAPI,
  getImportBatches as getImportBatchesAPI,
  getImportItems as getImportItemsAPI,
  updateImportItem as updateImportItemAPI,
} from "@/lib/api/importsApi"
import type { ApiProfileContext } from "@/lib/api/core/client"
import { debugError, debugLog } from "@/lib/debugLoop"

type ItemsByBatch = Record<string, ImportItem[]>

type ImportsWorkspaceState = {
  batches: ImportBatch[]
  itemsByBatchId: ItemsByBatch
  status: "idle" | "loading" | "ready" | "error"
}

type ImportsStoreState = {
  byWorkspaceId: Record<WorkspaceId, ImportsWorkspaceState>
  createBatch: (
    workspaceId: WorkspaceId,
    body: any,
    profile?: ApiProfileContext
  ) => Promise<ImportBatch>
  refreshBatches: (workspaceId: WorkspaceId, profile?: ApiProfileContext) => Promise<void>
  refreshItems: (
    workspaceId: WorkspaceId,
    batchId: string,
    profile?: ApiProfileContext
  ) => Promise<void>
  applyItemUpdate: (
    workspaceId: WorkspaceId,
    batch: ImportBatch,
    item: ImportItem
  ) => void
  patchItemLocally: (
    workspaceId: WorkspaceId,
    batchId: string,
    itemId: string,
    patch: Partial<ImportItem>
  ) => void
  updateItem: (
    workspaceId: WorkspaceId,
    batchId: string,
    itemId: string,
    patch: any
  ) => Promise<void>
  clear: (workspaceId?: WorkspaceId) => void
}

const getWorkspaceState = (
  byWorkspaceId: Record<WorkspaceId, ImportsWorkspaceState>,
  workspaceId: WorkspaceId
): ImportsWorkspaceState =>
  byWorkspaceId[workspaceId] ?? {
    batches: [],
    itemsByBatchId: {},
    status: "idle",
  }

const deriveBatchStatus = (items: ImportItem[]): ImportBatch["status"] => {
  if (items.length === 0) return "completed"
  if (items.some((item) => item.status === "pending" || item.status === "needs_review")) {
    return "in_review"
  }
  return "completed"
}

const applyBatchCounts = (batch: ImportBatch, items: ImportItem[]): ImportBatch => ({
  ...batch,
  itemCount: items.length,
  pendingCount: items.filter((item) => item.status === "pending").length,
  acceptedCount: items.filter((item) => item.status === "accepted").length,
  rejectedCount: items.filter((item) => item.status === "rejected").length,
  committedCount: items.filter((item) => item.status === "committed").length,
  status: deriveBatchStatus(items),
  updatedAt: new Date().toISOString(),
})

export const useImportsStore = create<ImportsStoreState>((set, get) => ({
  byWorkspaceId: {},

  async createBatch(workspaceId, body, profile) {
    const response = await createImportBatchAPI(workspaceId, body, profile)
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...workspaceState,
            batches: [response.batch, ...workspaceState.batches],
            itemsByBatchId: {
              ...workspaceState.itemsByBatchId,
              [response.batch.id]: response.items,
            },
            status: "ready",
          },
        },
      }
    })
    return response.batch
  },

  async refreshBatches(workspaceId, profile) {
    debugLog("imports-store", "refresh_batches_start", {
      workspaceId,
    })
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
      const batches = await getImportBatchesAPI(workspaceId, profile)
      debugLog("imports-store", "refresh_batches_success", {
        workspaceId,
        batchCount: batches.length,
        pendingBatchCount: batches.filter((batch) => batch.pendingCount > 0).length,
      })
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            batches,
            status: "ready",
          },
        },
      }))
    } catch {
      debugError("imports-store", "refresh_batches_failed", {
        workspaceId,
      })
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

  async refreshItems(workspaceId, batchId, profile) {
    debugLog("imports-store", "refresh_items_start", {
      workspaceId,
      batchId,
    })
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
      const items = await getImportItemsAPI(workspaceId, batchId, profile)
      debugLog("imports-store", "refresh_items_success", {
        workspaceId,
        batchId,
        itemCount: items.length,
      })
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceState(state.byWorkspaceId, workspaceId),
            itemsByBatchId: {
              ...getWorkspaceState(state.byWorkspaceId, workspaceId).itemsByBatchId,
              [batchId]: items,
            },
            status: "ready",
          },
        },
      }))
    } catch {
      debugError("imports-store", "refresh_items_failed", {
        workspaceId,
        batchId,
      })
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

  applyItemUpdate(workspaceId, batch, item) {
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const existingItems = workspaceState.itemsByBatchId[batch.id] ?? []
      const itemExists = existingItems.some((candidate) => candidate.id === item.id)
      const batchExists = workspaceState.batches.some(
        (candidate) => candidate.id === batch.id
      )
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...workspaceState,
            batches: batchExists
              ? workspaceState.batches.map((candidate) =>
                  candidate.id === batch.id ? batch : candidate
                )
              : [batch, ...workspaceState.batches],
            itemsByBatchId: {
              ...workspaceState.itemsByBatchId,
              [batch.id]: itemExists
                ? existingItems.map((candidate) =>
                    candidate.id === item.id ? item : candidate
                  )
                : [...existingItems, item],
            },
            status: "ready",
          },
        },
      }
    })
  },

  patchItemLocally(workspaceId, batchId, itemId, patch) {
    set((state) => {
      const workspaceState = getWorkspaceState(state.byWorkspaceId, workspaceId)
      const existingItems = workspaceState.itemsByBatchId[batchId] ?? []
      if (!existingItems.length) {
        return state
      }

      let didPatch = false
      const nextItems = existingItems.map((candidate) => {
        if (candidate.id !== itemId) return candidate
        didPatch = true
        return {
          ...candidate,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      })

      if (!didPatch) {
        return state
      }

      const nextBatches = workspaceState.batches.map((candidate) =>
        candidate.id === batchId ? applyBatchCounts(candidate, nextItems) : candidate
      )

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...workspaceState,
            batches: nextBatches,
            itemsByBatchId: {
              ...workspaceState.itemsByBatchId,
              [batchId]: nextItems,
            },
            status: "ready",
          },
        },
      }
    })
  },

  async updateItem(workspaceId, batchId, itemId, patch) {
    const response = await updateImportItemAPI(workspaceId, batchId, itemId, patch)
    get().applyItemUpdate(workspaceId, response.batch, response.item)
  },

  clear(workspaceId) {
    if (!workspaceId) {
      set({ byWorkspaceId: {} })
      return
    }

    set((state) => {
      const copy = { ...state.byWorkspaceId }
      delete copy[workspaceId]
      return { byWorkspaceId: copy }
    })
  },
}))
