import { create } from "zustand"
import type { InvoiceSettings, InvoiceType } from "@shared/schemas/invoice"
import type { PaymentAccount } from "@shared/schemas/paymentAccount"
import { getInvoices } from "@/lib/api/invoicesApi"

// Invoices and the workspace's invoice settings, per workspace. Shared by the
// invoice screens (list, detail, form, settings) so moving between them
// doesn't refetch; every write goes to the server first (invoicesApi uses
// apiFetch, never the offline queue) and the result is put back here.

type WorkspaceInvoices = {
  status: "loading" | "ready" | "error"
  invoices: InvoiceType[]
  settings: InvoiceSettings | null
  paymentAccount: PaymentAccount | null
}

type InvoicesState = {
  byWorkspaceId: Record<string, WorkspaceInvoices>
  load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
  upsertInvoice: (workspaceId: string, invoice: InvoiceType) => void
  removeInvoice: (workspaceId: string, invoiceId: string) => void
  setSettings: (workspaceId: string, settings: InvoiceSettings) => void
  setPaymentAccount: (workspaceId: string, paymentAccount: PaymentAccount | null) => void
}

function sortNewestFirst(invoices: InvoiceType[]): InvoiceType[] {
  return [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
}

const inFlight = new Map<string, Promise<void>>()

export const useInvoicesStore = create<InvoicesState>((set, get) => ({
  byWorkspaceId: {},

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
        set((state) => ({
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: { status: "ready", invoices: sortNewestFirst(invoices), settings, paymentAccount },
          },
        }))
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
}))
