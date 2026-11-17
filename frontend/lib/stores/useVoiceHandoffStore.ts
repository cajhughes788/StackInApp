import { create } from "zustand"

import type { VoiceAskForm } from "@shared/voiceAsk"

// Ask 521 hands what was said ("42 on gas at Shell") to the form it's for,
// which fills itself with its own voice fill, as if the person had tapped
// that form's mic. "Add an expense" with nothing else (listen: true) opens
// that form already listening instead. Kept until that form, for that
// workspace, takes it.

export type VoiceHandoff = {
  target: VoiceAskForm
  transcript: string
  workspaceId: string
  // Only the form was named: start its mic instead of filling from the words.
  listen: boolean
  nonce: number
}

type VoiceHandoffState = {
  request: VoiceHandoff | null
  send: (target: VoiceAskForm, transcript: string, workspaceId: string, listen?: boolean) => void
  /** The waiting words when they're for this form and workspace; taken once. */
  take: (targets: VoiceAskForm[], workspaceId: string | null) => VoiceHandoff | null
}

let nonce = 0

export const useVoiceHandoffStore = create<VoiceHandoffState>((set, get) => ({
  request: null,
  send: (target, transcript, workspaceId, listen = false) => {
    nonce += 1
    set({ request: { target, transcript, workspaceId, listen, nonce } })
  },
  take: (targets, workspaceId) => {
    const request = get().request
    if (!request || !workspaceId || request.workspaceId !== workspaceId || !targets.includes(request.target)) return null
    set({ request: null })
    return request
  },
}))
