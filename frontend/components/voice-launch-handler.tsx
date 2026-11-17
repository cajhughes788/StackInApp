"use client"

import { useEffect } from "react"

import { wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { useDeepLinkStore } from "@/lib/push/deepLinkStore"
import { useVoiceEntryStore } from "@/lib/stores/useVoiceEntryStore"
import { useVoiceLaunchStore } from "@/lib/stores/useVoiceLaunchStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { isVoiceLaunchAvailable, isVoiceLaunchTarget, VoiceLaunch, type VoiceLaunchTarget } from "@/plugins/VoiceLaunch"

// Siri and the Action Button ("Ask 521", "Log in 521", "Add an expense in
// 521", "Book in 521"): goes to that screen in the workspace that's open and
// starts its mic. Navigation goes through DeepLinkHandler, which waits for
// the workspace to be ready (so a cold start works too). Expenses and
// booking are self-employed screens; a W-2 workspace gets Ask 521 instead.
export default function VoiceLaunchHandler() {
  useEffect(() => {
    if (!isVoiceLaunchAvailable()) return
    let cancelled = false
    let handle: { remove: () => Promise<void> } | null = null

    let waiting: (() => void) | null = null
    const open = (target: VoiceLaunchTarget) => {
      if (cancelled) return
      wakeVoiceEntry()
      const state = useWorkspaceStore.getState().state
      // A cold start: wait for the workspace, then decide (signed out never gets there).
      if (state.status !== "ready") {
        waiting?.()
        waiting = useWorkspaceStore.subscribe((next) => {
          if (next.state.status !== "ready") return
          waiting?.()
          waiting = null
          open(target)
        })
        return
      }
      const workspace = state.status === "ready" ? state.activeWorkspace : null
      const selfEmployed = workspace?.type === "independent"
      const goTo = (route: "/app/home" | "/app/booking") =>
        useDeepLinkStore.getState().request({ workspaceId: null, route, review: null })

      if (target === "entry" && workspace) {
        goTo("/app/home")
        useVoiceLaunchStore.getState().ask("entry")
        useVoiceEntryStore.getState().ask(workspace.id, true)
        return
      }
      if (target === "expense" && selfEmployed) {
        goTo("/app/home")
        useVoiceLaunchStore.getState().ask("expense")
        return
      }
      if (target === "booking" && selfEmployed) {
        goTo("/app/booking")
        useVoiceLaunchStore.getState().ask("booking")
        return
      }
      goTo("/app/home")
      useVoiceLaunchStore.getState().ask("ask")
    }

    void (async () => {
      try {
        handle = await VoiceLaunch.addListener("launch", ({ target }) => {
          if (isVoiceLaunchTarget(target)) open(target)
        })
        const { target } = await VoiceLaunch.takePending()
        if (isVoiceLaunchTarget(target)) open(target)
      } catch {
        // No Siri launch support on this build.
      }
    })()

    return () => {
      cancelled = true
      waiting?.()
      void handle?.remove()
    }
  }, [])

  return null
}
