import { create } from "zustand"

// A leave-work reminder asking the Add entry form to open for a workspace.
// "Say it" (listen: true) also starts the mic; a plain tap on the reminder
// just opens the form with the mic ready. Kept until the form for that
// workspace takes it, so a cold start that mounts Home later still sees it.

export type VoiceEntryRequest = {
  workspaceId: string
  listen: boolean
  nonce: number
}

type VoiceEntryState = {
  request: VoiceEntryRequest | null
  ask: (workspaceId: string, listen: boolean) => void
  clear: (nonce: number) => void
}

let nonce = 0

export const useVoiceEntryStore = create<VoiceEntryState>((set, get) => ({
  request: null,
  ask: (workspaceId, listen) => {
    nonce += 1
    set({ request: { workspaceId, listen, nonce } })
  },
  clear: (handled) => {
    if (get().request?.nonce === handled) set({ request: null })
  },
}))
