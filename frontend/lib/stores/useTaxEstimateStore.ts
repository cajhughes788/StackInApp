import { create } from "zustand"

import { getTaxEstimate } from "@/lib/api/taxEstimateApi"
import type { TaxEstimateResponse } from "@shared/estimatedTax/response"

// The self-employed tax estimate (getTaxEstimate), shared by the Taxes page
// and Home's income card "safe to spend" line so they make one
// request. Per signed-in user; refetched after five minutes or on demand
// (after the person changes their answers, or records change).

const TTL_MS = 5 * 60 * 1000

type TaxEstimateState = {
  uid: string | null
  data: TaxEstimateResponse | null
  status: "idle" | "loading" | "ready" | "error"
  at: number
  inFlight: Promise<void> | null
  load: (uid: string, opts?: { force?: boolean }) => Promise<void>
  clear: () => void
}

export const useTaxEstimateStore = create<TaxEstimateState>((set, get) => ({
  uid: null,
  data: null,
  status: "idle",
  at: 0,
  inFlight: null,

  load: async (uid, opts) => {
    const state = get()
    if (state.uid !== uid) set({ uid, data: null, status: "idle", at: 0, inFlight: null })
    const current = get()
    if (!opts?.force && current.status === "ready" && Date.now() - current.at < TTL_MS) return
    if (current.inFlight && !opts?.force) return current.inFlight

    const request = (async () => {
      set((s) => ({ status: s.data ? s.status : "loading" }))
      try {
        const data = await getTaxEstimate()
        if (get().uid !== uid) return
        set({ data, status: "ready", at: Date.now() })
      } catch {
        if (get().uid !== uid) return
        set((s) => ({ status: s.data ? "ready" : "error" }))
      } finally {
        if (get().uid === uid) set({ inFlight: null })
      }
    })()
    set({ inFlight: request })
    return request
  },

  clear: () => set({ uid: null, data: null, status: "idle", at: 0, inFlight: null }),
}))
