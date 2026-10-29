"use client"

import { create } from "zustand"

import { getAppointments } from "@/lib/api/appointmentsApi"
import { isSaving } from "@/lib/domain/backgroundSave"
import { readAppointmentsCache, saveAppointmentsCache } from "@/lib/storage/appointmentsCache"
import type { AppointmentType } from "@shared/schemas/appointment"

// Appointments per workspace (30 days back and everything ahead), shared by
// the Booking list, New appointment and an appointment's page.

type AppointmentsEntry = {
  appointments: AppointmentType[]
  status: "loading" | "ready" | "error"
}

type AppointmentsStore = {
  byWorkspaceId: Record<string, AppointmentsEntry>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsert: (workspaceId: string, appointment: AppointmentType) => void
  remove: (workspaceId: string, appointmentId: string) => void
}

const inFlight = new Map<string, Promise<void>>()

/** The background-save key for an appointment (lib/domain/appointmentService.ts). */
export function appointmentSaveKey(appointmentId: string): string {
  return `appt:${appointmentId}`
}

function sortByStart(appointments: AppointmentType[]): AppointmentType[] {
  return [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt))
}

export const useAppointmentsStore = create<AppointmentsStore>((set, get) => ({
  byWorkspaceId: {},

  async load(workspaceId, options) {
    const existing = get().byWorkspaceId[workspaceId]
    if (existing?.status === "ready" && !options?.force) return
    const running = inFlight.get(workspaceId)
    if (running) return running
    const task = (async () => {
      if (!existing) {
        set((state) => ({
          byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { appointments: [], status: "loading" } },
        }))
      }
      const fresh = getAppointments(workspaceId)
      fresh.catch(() => {}) // awaited below
      // First time this launch: show the last list saved on this phone while
      // the fresh one loads.
      let fromCache = false
      if (!existing) {
        const cached = await readAppointmentsCache(workspaceId).catch(() => null)
        if (cached) {
          set((state) => {
            const current = state.byWorkspaceId[workspaceId]
            if (current?.status !== "loading" || current.appointments.length > 0) return state
            fromCache = true
            return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { appointments: sortByStart(cached), status: "loading" } } }
          })
        }
      }
      try {
        const loaded = await fresh
        void saveAppointmentsCache(workspaceId, loaded).catch(() => {})
        set((state) => {
          // Ones with changes still on their way keep what's on screen.
          const pending = (state.byWorkspaceId[workspaceId]?.appointments ?? []).filter((item) =>
            isSaving(appointmentSaveKey(item.id))
          )
          const pendingIds = new Set(pending.map((item) => item.id))
          const appointments = sortByStart([...loaded.filter((item) => !pendingIds.has(item.id)), ...pending])
          return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { appointments, status: "ready" } } }
        })
      } catch (error) {
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              appointments: state.byWorkspaceId[workspaceId]?.appointments ?? [],
              // A saved list stays up when the fresh one can't load.
              status: fromCache || state.byWorkspaceId[workspaceId]?.status === "ready" ? "ready" : "error",
            },
          },
        }))
        throw error
      } finally {
        inFlight.delete(workspaceId)
      }
    })()
    inFlight.set(workspaceId, task)
    return task
  },

  upsert(workspaceId, appointment) {
    set((state) => {
      const current = state.byWorkspaceId[workspaceId]?.appointments ?? []
      const appointments = sortByStart([...current.filter((item) => item.id !== appointment.id), appointment])
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { appointments, status: "ready" } } }
    })
  },

  remove(workspaceId, appointmentId) {
    set((state) => {
      const entry = state.byWorkspaceId[workspaceId]
      if (!entry) return state
      const appointments = entry.appointments.filter((item) => item.id !== appointmentId)
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...entry, appointments } } }
    })
  },
}))
