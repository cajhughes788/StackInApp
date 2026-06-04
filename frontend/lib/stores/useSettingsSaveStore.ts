"use client"

import { create } from "zustand"

import type { WorkspaceId } from "@shared/contracts/workspace"

export type SettingsSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "synced"; at: number }
  | { status: "pending"; message: string | null }
  | { status: "error"; message: string; retryable: boolean; preservedPatch: boolean }

type SettingsSaveStoreState = {
  byWorkspaceId: Record<WorkspaceId, SettingsSaveState>
  getSaveState: (workspaceId: WorkspaceId) => SettingsSaveState
  setSaveState: (workspaceId: WorkspaceId, state: SettingsSaveState) => void
  clear: (workspaceId?: WorkspaceId) => void
}

const IDLE: SettingsSaveState = { status: "idle" }

export const useSettingsSaveStore = create<SettingsSaveStoreState>((set, get) => ({
  byWorkspaceId: {},
  getSaveState(workspaceId) {
    return get().byWorkspaceId[workspaceId] ?? IDLE
  },
  setSaveState(workspaceId, state) {
    set((prev) => ({
      byWorkspaceId: {
        ...prev.byWorkspaceId,
        [workspaceId]: state,
      },
    }))
  },
  clear(workspaceId) {
    if (!workspaceId) {
      set({ byWorkspaceId: {} })
      return
    }
    set((prev) => {
      const copy = { ...prev.byWorkspaceId }
      delete copy[workspaceId]
      return { byWorkspaceId: copy }
    })
  },
}))
