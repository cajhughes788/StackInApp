import { useEffect } from "react"
import { create } from "zustand"
import type { QuoteType } from "@shared/schemas/quote"
import { getQuotes } from "@/lib/api/quotesApi"

// Quotes per workspace, shared by the invoice screens (list, quote page,
// form) and Needs you. Unlike invoices, quote changes wait for the server
// (quotesApi.ts) and land here with its answer.

type WorkspaceQuotes = {
  status: "loading" | "ready" | "error"
  quotes: QuoteType[]
}

type QuotesState = {
  byWorkspaceId: Record<string, WorkspaceQuotes>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsertQuote: (workspaceId: string, quote: QuoteType) => void
  removeQuote: (workspaceId: string, quoteId: string) => void
}

function sortNewestFirst(quotes: QuoteType[]): QuoteType[] {
  return [...quotes].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
}

const inFlight = new Map<string, Promise<void>>()

export const useQuotesStore = create<QuotesState>((set, get) => ({
  byWorkspaceId: {},

  load: async (workspaceId, options) => {
    const current = get().byWorkspaceId[workspaceId]
    if (!options?.force && current?.status === "ready") return
    const pending = inFlight.get(workspaceId)
    if (pending) return pending
    if (!current) {
      set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "loading", quotes: [] } } }))
    }
    const request = getQuotes(workspaceId)
      .then((quotes) => {
        set((state) => ({ byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "ready", quotes: sortNewestFirst(quotes) } } }))
      })
      .catch((error) => {
        // Keep what was already shown; only an empty first load becomes an error.
        set((state) => {
          if (state.byWorkspaceId[workspaceId]?.status === "ready") return state
          return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { status: "error", quotes: [] } } }
        })
        throw error
      })
      .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, request)
    return request
  },

  upsertQuote: (workspaceId, quote) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId] ?? { status: "ready" as const, quotes: [] }
      const quotes = sortNewestFirst([...existing.quotes.filter((q) => q.id !== quote.id), quote])
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, quotes } } }
    }),

  removeQuote: (workspaceId, quoteId) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId]
      if (!existing) return state
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, quotes: existing.quotes.filter((q) => q.id !== quoteId) } } }
    }),
}))

/** Loads the workspace's quotes once and returns them with the load status. */
export function useWorkspaceQuotes(workspaceId: string | null): { quotes: QuoteType[]; status: WorkspaceQuotes["status"] } {
  const entry = useQuotesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useQuotesStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void load(workspaceId).catch(() => {})
  }, [load, workspaceId])
  return { quotes: entry?.quotes ?? [], status: entry?.status ?? "loading" }
}
