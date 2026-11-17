import { create } from "zustand"

import type { VoiceLaunchTarget } from "@/plugins/VoiceLaunch"

// A Siri phrase or the Action Button asking a screen to start listening
// (components/voice-launch-handler.tsx). Kept until that screen's mic takes
// it, so a cold start that mounts the screen later still sees it.

export type VoiceLaunchRequest = { target: VoiceLaunchTarget; nonce: number }

type VoiceLaunchState = {
  request: VoiceLaunchRequest | null
  ask: (target: VoiceLaunchTarget) => void
  /** The waiting request when it's for this mic; taken once. */
  take: (target: VoiceLaunchTarget) => VoiceLaunchRequest | null
}

let nonce = 0

export const useVoiceLaunchStore = create<VoiceLaunchState>((set, get) => ({
  request: null,
  ask: (target) => {
    nonce += 1
    set({ request: { target, nonce } })
  },
  take: (target) => {
    const request = get().request
    if (request?.target !== target) return null
    set({ request: null })
    return request
  },
}))
