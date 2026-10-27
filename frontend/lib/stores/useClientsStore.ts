"use client"

import { create } from "zustand"

import { getClients } from "@/lib/api/clientsApi"
import type { ClientPaymentSummary, ClientType } from "@shared/schemas/client"

// Saved clients per workspace, with what each paid outside invoices (this
// year = the user's calendar year). Invoices come from useInvoicesStore;
// shared/clients.ts buildClientRows puts the two together.

type ClientsEntry = {
  clients: ClientType[]
  payments: Record<string, ClientPaymentSummary>
  status: "loading" | "ready" | "error"
}

type ClientsStore = {
  byWorkspaceId: Record<string, ClientsEntry>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsert: (workspaceId: string, client: ClientType) => void
  remove: (workspaceId: string, clientId: string) => void
}

export function currentYear(): string {
  return String(new Date().getFullYear())
}

const inFlight = new Map<string, Promise<void>>()

export const useClientsStore = create<ClientsStore>((set, get) => ({
  byWorkspaceId: {},

  async load(workspaceId, options) {
    const existing = get().byWorkspaceId[workspaceId]
    if (existing?.status === "ready" && !options?.force) return
    const running = inFlight.get(workspaceId)
    if (running) return running
    const task = (async () => {
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            clients: existing?.clients ?? [],
            payments: existing?.payments ?? {},
            status: existing ? existing.status : "loading",
          },
        },
      }))
      try {
        const { clients, payments } = await getClients(workspaceId, currentYear())
        set((state) => ({
          byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { clients, payments, status: "ready" } },
        }))
      } catch (error) {
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              clients: state.byWorkspaceId[workspaceId]?.clients ?? [],
              payments: state.byWorkspaceId[workspaceId]?.payments ?? {},
              status: "error",
            },
          },
        }))
        throw error
      }
    })()
    inFlight.set(workspaceId, task)
    try {
      await task
    } finally {
      inFlight.delete(workspaceId)
    }
  },

  upsert(workspaceId, client) {
    set((state) => {
      const entry = state.byWorkspaceId[workspaceId]
      if (!entry) return state
      const others = entry.clients.filter((c) => c.id !== client.id)
      return {
        byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...entry, clients: [...others, client] } },
      }
    })
  },

  remove(workspaceId, clientId) {
    set((state) => {
      const entry = state.byWorkspaceId[workspaceId]
      if (!entry) return state
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...entry, clients: entry.clients.filter((c) => c.id !== clientId) },
        },
      }
    })
  },
}))
