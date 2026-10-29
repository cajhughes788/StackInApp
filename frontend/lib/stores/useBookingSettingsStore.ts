"use client"

import { create } from "zustand"

import { getBookingSettings } from "@/lib/api/bookingApi"
import { BookingSettingsSchema, type BookingSettings } from "@shared/schemas/booking"

// Booking setup (services, hours, time zone) per workspace, shared by the
// Booking page, New appointment and Booking setup. The last copy is kept on
// the phone so those screens open at once; a fresh copy loads behind it.

type BookingSettingsEntry = {
  settings: BookingSettings | null
  status: "loading" | "ready" | "error"
}

type BookingSettingsStore = {
  byWorkspaceId: Record<string, BookingSettingsEntry>
  load: (workspaceId: string) => Promise<void>
  put: (workspaceId: string, settings: BookingSettings) => void
}

const STORAGE_PREFIX = "521.bookingSettings."
const inFlight = new Map<string, Promise<void>>()

function readSaved(workspaceId: string): BookingSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + workspaceId)
    if (!raw) return null
    const parsed = BookingSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function writeSaved(workspaceId: string, settings: BookingSettings): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(settings))
  } catch {
    // Only a head start; the server's copy still loads.
  }
}

export const useBookingSettingsStore = create<BookingSettingsStore>((set, get) => ({
  byWorkspaceId: {},

  // Always asks the server; whatever's already here stays on screen meanwhile.
  async load(workspaceId) {
    const running = inFlight.get(workspaceId)
    if (running) return running
    if (!get().byWorkspaceId[workspaceId]) {
      const saved = readSaved(workspaceId)
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { settings: saved, status: saved ? "ready" : "loading" },
        },
      }))
    }
    const task = (async () => {
      try {
        get().put(workspaceId, await getBookingSettings(workspaceId))
      } catch (error) {
        set((state) => {
          const current = state.byWorkspaceId[workspaceId]
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: { settings: current?.settings ?? null, status: current?.settings ? "ready" : "error" },
            },
          }
        })
        throw error
      } finally {
        inFlight.delete(workspaceId)
      }
    })()
    inFlight.set(workspaceId, task)
    return task
  },

  put(workspaceId, settings) {
    writeSaved(workspaceId, settings)
    set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { settings, status: "ready" } } }))
  },
}))
