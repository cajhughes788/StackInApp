"use client"

import { useRouter } from "next/navigation"
import { Check, ChevronDown, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useEffect, useState } from "react"
import { API_ENDPOINTS, apiFetch } from "@/lib/api"
import { debugError, debugRender, debugLog } from "@/lib/debugLoop"
import type { SubscriptionDoc } from "@shared/contracts/subscription"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useToast } from "@/hooks/use-toast"

type WorkspaceSubscriptionResponse = {
  isActive?: boolean
  subscription?: SubscriptionDoc | null
  maxWorkspaces?: number | "unlimited"
}

export default function WorkspaceSwitcher() {
  const router = useRouter()
  const { toast } = useToast()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const navigationGuard = useNavigationGuardStore((s) => s.guard)
  const [canAddWorkspace, setCanAddWorkspace] = useState(false)
  const workspaceCount =
    workspaceState.status === "ready" ? workspaceState.workspaces.length : 0
  const readyActiveWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  debugRender("workspace-switcher", {
    workspaceStatus: workspaceState.status,
    activeWorkspaceId: readyActiveWorkspaceId,
    workspaceCount,
    canAddWorkspace,
  })

  useEffect(() => {
    let cancelled = false

    if (workspaceState.status !== "ready") {
      debugLog("workspace-switcher", "not_ready", {
        workspaceStatus: workspaceState.status,
      })
      setCanAddWorkspace((current) => (current ? false : current))
      return
    }

    async function loadSubscription() {
      try {
        debugLog("workspace-switcher", "subscription_check_start", {
          activeWorkspaceId: readyActiveWorkspaceId,
          workspaceCount,
        })
        const res = await apiFetch<WorkspaceSubscriptionResponse>(
          API_ENDPOINTS.subscription.get
        )
        const maxWorkspaces = res?.maxWorkspaces ?? 0
        const hasCapacity =
          maxWorkspaces === "unlimited" ||
          (typeof maxWorkspaces === "number" &&
            workspaceCount < maxWorkspaces)

        if (!cancelled) {
          const nextValue = Boolean(res?.isActive) && hasCapacity
          debugLog("workspace-switcher", "subscription_check_complete", {
            activeWorkspaceId: readyActiveWorkspaceId,
            nextValue,
            isActive: Boolean(res?.isActive),
            maxWorkspaces,
            workspaceCount,
          })
          setCanAddWorkspace((current) =>
            current === nextValue ? current : nextValue
          )
        }
      } catch {
        if (!cancelled) {
          debugError("workspace-switcher", "subscription_check_failed", {
            activeWorkspaceId: readyActiveWorkspaceId,
          })
          setCanAddWorkspace((current) => (current ? false : current))
        }
      }
    }

    loadSubscription()

    return () => {
      cancelled = true
    }
  }, [workspaceState.status, readyActiveWorkspaceId, workspaceCount])

  if (workspaceState.status !== "ready") {
    return null
  }

  const { activeWorkspace, activeWorkspaceId, workspaces } = workspaceState

  async function handleWorkspaceSelect(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return
    if (navigationGuard?.shouldBlock) {
      const flushed = await navigationGuard.flush()
      if (!flushed) {
        toast({
          title: "Unable to switch workspace",
          description: "Finish resolving your settings changes before switching workspaces.",
          variant: "destructive",
        })
        return
      }
    }
    setActiveWorkspace(workspaceId)
    router.push("/app/home")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-sm font-medium text-primary shadow-sm transition hover:bg-accent"
          aria-label="Open workspace switcher"
        >
          <span>{activeWorkspace.name}</span>
          <span className="text-xs text-primary/80">
            ({activeWorkspace.type === "w2" ? "W-2" : "Independent"})
          </span>
          <ChevronDown className="h-4 w-4 text-primary" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId
          return (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => void handleWorkspaceSelect(workspace.id)}
              className="flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{workspace.name}</div>
                <div className="text-xs text-muted-foreground">
                  {workspace.type === "w2" ? "W-2 workspace" : "Independent workspace"}
                </div>
              </div>
              {isActive ? <Check className="h-4 w-4 text-primary" /> : null}
            </DropdownMenuItem>
          )
        })}

        {canAddWorkspace ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/welcome?mode=add-workspace")}>
              <Plus className="h-4 w-4 text-primary" />
              Add Workspace
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
