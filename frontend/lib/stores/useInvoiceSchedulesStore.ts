import { useEffect } from "react"
import { create } from "zustand"
import type { InvoiceScheduleType } from "@shared/schemas/invoiceSchedule"
import { getInvoiceSchedules } from "@/lib/api/invoiceSchedulesApi"

// Repeating invoices per workspace, shared by the invoice screens. Changes
// wait for the server (invoiceSchedulesApi.ts) and land here with its answer.

type WorkspaceSchedules = {
  status: "loading" | "ready" | "error"
  schedules: InvoiceScheduleType[]
}

type SchedulesState = {
  byWorkspaceId: Record<string, WorkspaceSchedules>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsertSchedule: (workspaceId: string, schedule: InvoiceScheduleType) => void
}

const inFlight = new Map<string, Promise<void>>()

export const useInvoiceSchedulesStore = create<SchedulesState>((set, get) => ({
  byWorkspaceId: {},

  load: async (workspaceId, options) => {
    const current = get().byWorkspaceId[workspaceId]
    if (!options?.force && current?.status === "ready") return
    const pending = inFlight.get(workspaceId)
    if (pending) return pending
    if (!current) {
      set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "loading", schedules: [] } } }))
    }
    const request = getInvoiceSchedules(workspaceId)
      .then((schedules) => {
        set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "ready", schedules } } }))
      })
      .catch((error) => {
        set((state) => {
          if (state.byWorkspaceId[workspaceId]?.status === "ready") return state
          return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "error", schedules: [] } } }
        })
        throw error
      })
      .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, request)
    return request
  },

  upsertSchedule: (workspaceId, schedule) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId] ?? { status: "ready" as const, schedules: [] }
      const schedules = [...existing.schedules.filter((s) => s.id !== schedule.id), schedule]
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, schedules } } }
    }),
}))

/** Loads the workspace's repeating invoices once and returns them with the load status. */
export function useWorkspaceInvoiceSchedules(workspaceId: string | null): { schedules: InvoiceScheduleType[]; status: WorkspaceSchedules["status"] } {
  const entry = useInvoiceSchedulesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useInvoiceSchedulesStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void load(workspaceId).catch(() => {})
  }, [load, workspaceId])
  return { schedules: entry?.schedules ?? [], status: entry?.status ?? "loading" }
}
