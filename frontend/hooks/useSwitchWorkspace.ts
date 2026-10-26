"use client"

import { startTransition } from "react"
import { useRouter } from "next/navigation"

import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useToast } from "@/hooks/use-toast"

// Switches the active workspace and lands on Home — first saving (or
// refusing to drop) unsaved settings changes held by the navigation guard.
// Resolves false when the switch didn't happen.
export function useSwitchWorkspace(): (workspaceId: string) => Promise<boolean> {
  const router = useRouter()
  const { toast } = useToast()
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const navigationGuard = useNavigationGuardStore((s) => s.guard)

  return async (workspaceId: string) => {
    const state = useWorkspaceStore.getState().state
    if (state.status === "ready" && state.activeWorkspaceId === workspaceId) return false
    if (navigationGuard?.mode === "block") {
      const flushed = await navigationGuard.flush()
      if (!flushed) {
        toast({
          title: "Unable to switch workspace",
          description:
            navigationGuard.reason ??
            "Finish resolving your settings changes before switching workspaces.",
          variant: "destructive",
        })
        return false
      }
    }

    if (navigationGuard?.mode === "background") {
      // Finishes quietly; a failure still reports itself.
      void navigationGuard.flush()
    }

    setActiveWorkspace(workspaceId)
    startTransition(() => {
      router.push("/app/home")
    })
    return true
  }
}
