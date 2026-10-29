"use client"

import { create } from "zustand"

import { getClients } from "@/lib/api/clientsApi"
import { isSaving } from "@/lib/domain/backgroundSave"
import { readClientsCache, saveClientsCache } from "@/lib/storage/clientsCache"
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

/** The background-save key for a client (lib/domain/clientService.ts). */
export function clientSaveKey(clientId: string): string {
  return `client:${clientId}`
}

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
      const year = currentYear()
      const fresh = getClients(workspaceId, year)
      fresh.catch(() => {}) // awaited below
      // First time this launch: show the last list saved on this phone while
      // the fresh one loads.
      let fromCache = false
      if (!existing) {
        const cached = await readClientsCache(workspaceId, year).catch(() => null)
        if (cached) {
          set((state) => {
            const current = state.byWorkspaceId[workspaceId]
            if (current?.status !== "loading" || current.clients.length > 0) return state
            fromCache = true
            return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...cached, status: "loading" } } }
          })
        }
      }
      try {
        const { clients: loaded, payments } = await fresh
        void saveClientsCache(workspaceId, year, loaded, payments).catch(() => {})
        set((state) => {
          // Ones with changes still on their way keep what's on screen.
          const pending = (state.byWorkspaceId[workspaceId]?.clients ?? []).filter((client) => isSaving(clientSaveKey(client.id)))
          const pendingIds = new Set(pending.map((client) => client.id))
          const clients = [...loaded.filter((client) => !pendingIds.has(client.id)), ...pending]
          return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { clients, payments, status: "ready" } } }
        })
      } catch (error) {
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              clients: state.byWorkspaceId[workspaceId]?.clients ?? [],
              payments: state.byWorkspaceId[workspaceId]?.payments ?? {},
              // A saved list stays up when the fresh one can't load.
              status: fromCache ? "ready" : "error",
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
