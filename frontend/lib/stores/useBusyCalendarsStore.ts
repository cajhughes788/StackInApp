"use client"

import { create } from "zustand"

import { getBusyCalendars, type BusyCalendars } from "@/lib/api/bookingApi"

// The owner's busy calendars and the busy times they block, per workspace:
// Booking setup lists the calendars, the Booking calendar draws the times,
// and New appointment warns when a time runs into one. Loaded from the
// server each time a screen asks; not kept on the phone.

type BusyCalendarsEntry = BusyCalendars & { status: "loading" | "ready" | "error" }

type BusyCalendarsStore = {
  byWorkspaceId: Record<string, BusyCalendarsEntry>
  load: (workspaceId: string) => Promise<void>
  put: (workspaceId: string, value: BusyCalendars) => void
}

const EMPTY: BusyCalendars = { calendars: [], busy: [] }
const inFlight = new Map<string, Promise<void>>()

export const useBusyCalendarsStore = create<BusyCalendarsStore>((set, get) => ({
  byWorkspaceId: {},

  async load(workspaceId) {
    const running = inFlight.get(workspaceId)
    if (running) return running
    if (!get().byWorkspaceId[workspaceId]) {
      set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...EMPTY, status: "loading" } } }))
    }
    const task = getBusyCalendars(workspaceId)
      .then((value) => get().put(workspaceId, value))
      .catch((error) => {
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: { ...(state.byWorkspaceId[workspaceId] ?? EMPTY), status: "error" },
          },
        }))
        throw error
      })
      .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, task)
    return task
  },

  put(workspaceId, value) {
    set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...value, status: "ready" } } }))
  },
}))
