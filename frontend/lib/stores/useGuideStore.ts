import { create } from "zustand"

import type { WorkspaceType } from "@shared/contracts/workspace"

// First-run guide. Settings' first-time setup asks for the Home tour when the
// user taps Save and continue; the menu's "Take the tour" asks for it again.
// Held in app state rather than a URL for the same reason as deepLinkStore.ts
// (Capacitor answers extension-less URLs with the root index.html). Nothing is
// saved: first-time setup already happens once per workspace (it ends when the
// workspace's settings are saved), so the request can't come back on its own.
// The guide only runs for the first W-2 and the first self-employed workspace
// (see isFirstWorkspaceOfType); later ones of the same type skip it.
//
// `homeTour` names the workspace the tour is for; the home page runs it only
// while that workspace is active, then clears it.
//
// `tourMenuOpen` lets the tour open the header's menu so it can point at the
// menu's own items (Invoices, Booking, ...); the header keeps it open while set.

type GuideState = {
  homeTour: { workspaceId: string; workspaceType: WorkspaceType } | null
  requestHomeTour: (workspaceId: string, workspaceType: WorkspaceType) => void
  clearHomeTour: () => void
  tourMenuOpen: boolean
  setTourMenuOpen: (open: boolean) => void
}

/** True when no other workspace on the account has this one's type, i.e. the
 * user hasn't been through the guide for this kind of workspace yet. */
export function isFirstWorkspaceOfType(
  workspaces: { id: string; type: WorkspaceType }[],
  workspace: { id: string; type: WorkspaceType }
) {
  return !workspaces.some((other) => other.id !== workspace.id && other.type === workspace.type)
}

export const useGuideStore = create<GuideState>((set) => ({
  homeTour: null,
  requestHomeTour: (workspaceId, workspaceType) => set({ homeTour: { workspaceId, workspaceType } }),
  clearHomeTour: () => set({ homeTour: null }),
  tourMenuOpen: false,
  setTourMenuOpen: (open) => set({ tourMenuOpen: open }),
}))
