import { create } from "zustand"
import type { InvoiceSettings, InvoiceType } from "@shared/schemas/invoice"
import type { PaymentAccount } from "@shared/schemas/paymentAccount"
import { getInvoices } from "@/lib/api/invoicesApi"

// Invoices and the workspace's invoice settings, per workspace. Shared by the
// invoice screens (list, detail, form, settings) so moving between them
// doesn't refetch. Creates, edits, mark paid, void and delete land here
// first and reach the server in the background (lib/domain/invoiceService.ts);
// the server's copy replaces the optimistic one when it answers.

type WorkspaceInvoices = {
  status: "loading" | "ready" | "error"
  invoices: InvoiceType[]
  settings: InvoiceSettings | null
  paymentAccount: PaymentAccount | null
}

type InvoicesState = {
  byWorkspaceId: Record<string, WorkspaceInvoices>
  // Background saves still running, per invoice (keyed as invoiceService's
  // invoiceKey: a new invoice keeps its temporary id's key once saved).
  savingByKey: Record<string, number>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsertInvoice: (workspaceId: string, invoice: InvoiceType) => void
  removeInvoice: (workspaceId: string, invoiceId: string) => void
  setSettings: (workspaceId: string, settings: InvoiceSettings) => void
  setPaymentAccount: (workspaceId: string, paymentAccount: PaymentAccount | null) => void
  adjustSaving: (key: string, delta: 1 | -1) => void
}

function sortNewestFirst(invoices: InvoiceType[]): InvoiceType[] {
  return [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
}

const inFlight = new Map<string, Promise<void>>()

// Not on the server yet (invoiceService's optimistic creates).
export function isTempInvoiceId(invoiceId: string): boolean {
  return invoiceId.startsWith("tmp-")
}

export const useInvoicesStore = create<InvoicesState>((set, get) => ({
  byWorkspaceId: {},
  savingByKey: {},

  load: async (workspaceId, options) => {
    const current = get().byWorkspaceId[workspaceId]
    if (!options?.force && current?.status === "ready") return
    const pending = inFlight.get(workspaceId)
    if (pending) return pending

    if (!current) {
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { status: "loading", invoices: [], settings: null, paymentAccount: null },
        },
      }))
    }
    const request = getInvoices(workspaceId)
      .then(({ invoices, settings, paymentAccount }) => {
        set((state) => {
          // New invoices still being created aren't on the server yet.
          const unsaved = (state.byWorkspaceId[workspaceId]?.invoices ?? []).filter((i) => isTempInvoiceId(i.id))
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: { status: "ready", invoices: sortNewestFirst([...unsaved, ...invoices]), settings, paymentAccount },
            },
          }
        })
      })
      .catch((error) => {
        // Keep what was already shown; only an empty first load becomes an error.
        set((state) => {
          const existing = state.byWorkspaceId[workspaceId]
          if (existing?.status === "ready") return state
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: { status: "error", invoices: [], settings: null, paymentAccount: null },
            },
          }
        })
        throw error
      })
      .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, request)
    return request
  },

  upsertInvoice: (workspaceId, invoice) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId]
      if (!existing) return state
      const invoices = sortNewestFirst([...existing.invoices.filter((i) => i.id !== invoice.id), invoice])
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, invoices } } }
    }),

  removeInvoice: (workspaceId, invoiceId) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId]
      if (!existing) return state
      const invoices = existing.invoices.filter((i) => i.id !== invoiceId)
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, invoices } } }
    }),

  setSettings: (workspaceId, settings) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId] ?? {
        status: "ready" as const,
        invoices: [],
        settings: null,
        paymentAccount: null,
      }
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, settings } } }
    }),

  setPaymentAccount: (workspaceId, paymentAccount) =>
    set((state) => {
      const existing = state.byWorkspaceId[workspaceId]
      if (!existing) return state
      return { byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: { ...existing, paymentAccount } } }
    }),

  adjustSaving: (key, delta) =>
    set((state) => {
      const count = (state.savingByKey[key] ?? 0) + delta
      const savingByKey = { ...state.savingByKey }
      if (count > 0) savingByKey[key] = count
      else delete savingByKey[key]
      return { savingByKey }
    }),
}))
