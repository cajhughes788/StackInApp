"use client"

import { useEffect } from "react"
import { useRef } from "react"

import { useAuth } from "@/contexts/auth-context"
import { replayPending } from "@/lib/api"
import { getIsOnline, onNetworkChange } from "@/lib/network/status"
import { logPerf, measureAsync } from "@/lib/observability/perf"

export function useOfflineReplay() {
  const { user, authLoading } = useAuth()
  const lastOnlineRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    lastOnlineRef.current = getIsOnline()

    if (getIsOnline()) {
      logPerf("offline_replay.trigger", {
        source: "mount",
        userId: user.uid,
      })
      void measureAsync("offline_replay.run", () => replayPending(), {
        source: "mount",
      })
    }

    const unsubscribe = onNetworkChange((online) => {
      const previous = lastOnlineRef.current
      lastOnlineRef.current = online

      if (!online || previous === true) return
      logPerf("offline_replay.trigger", {
        source: "network-online",
        userId: user.uid,
      })
      void measureAsync("offline_replay.run", () => replayPending(), {
        source: "network-online",
      })
    })

    return () => {
      unsubscribe()
    }
  }, [authLoading, user])
}
