// CapabilitiesStore.ts
import { create } from "zustand"

export interface Capabilities {
  w2: {
    enabled: boolean
    canGeneratePaystubs: boolean
  }

  independent: {
    enabled: boolean
    canGeneratePnL: boolean
  }
}

export const defaultCapabilities: Capabilities = {
  w2: {
    enabled: false,
    canGeneratePaystubs: false,
  },
  independent: {
    enabled: false,
    canGeneratePnL: false,
  },
}

// Zustand store
export const useCapabilitiesStore = create<Capabilities>(() => defaultCapabilities)
