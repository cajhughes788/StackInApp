"use client"

import { useEffect } from "react"

import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"

// A few seconds after Home has loaded, fetch the clients and appointments
// lists in the background, once per app launch per workspace. Clients and
// Booking are then ready when opened, their servers are awake, and the
// lists saved on the phone are fresh.

const WARM_DELAY_MS = 3000
const warmed = new Set<string>()

export function useWarmClientsAndBooking(workspaceId: string | null, homeLoaded: boolean): void {
  useEffect(() => {
    if (!workspaceId || !homeLoaded || warmed.has(workspaceId)) return
    const timer = setTimeout(() => {
      warmed.add(workspaceId)
      // Not forced: skipped if the page already loaded it this launch.
      void useClientsStore.getState().load(workspaceId).catch(() => {})
      void useAppointmentsStore.getState().load(workspaceId).catch(() => {})
    }, WARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [workspaceId, homeLoaded])
}
