"use client"

import { create } from "zustand"

import { getAppointments } from "@/lib/api/appointmentsApi"
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
}

const inFlight = new Map<string, Promise<void>>()

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
      try {
        const appointments = await getAppointments(workspaceId)
        set((state) => ({
          byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { appointments: sortByStart(appointments), status: "ready" } },
        }))
      } catch (error) {
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              appointments: state.byWorkspaceId[workspaceId]?.appointments ?? [],
              status: state.byWorkspaceId[workspaceId]?.status === "ready" ? "ready" : "error",
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
}))
