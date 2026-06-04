"use client"

import { create } from "zustand"

export type NavigationGuardMode = "block" | "background" | "none"

type NavigationGuard = {
  mode: NavigationGuardMode
  reason?: string
  flush: () => Promise<boolean>
}

type NavigationGuardStore = {
  guard: NavigationGuard | null
  setGuard: (guard: NavigationGuard) => void
  clearGuard: () => void
}

export const useNavigationGuardStore = create<NavigationGuardStore>((set) => ({
  guard: null,
  setGuard: (guard) => set({ guard }),
  clearGuard: () => set({ guard: null }),
}))
