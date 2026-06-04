"use client"

import { startTransition } from "react"
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
import { debugRender } from "@/lib/debugLoop"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useToast } from "@/hooks/use-toast"
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context"

export default function WorkspaceSwitcher() {
  const router = useRouter()
  const { toast } = useToast()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const navigationGuard = useNavigationGuardStore((s) => s.guard)
  const { authority, authorityStatus } = useAppBootstrapState()
  const workspaceCount =
    workspaceState.status === "ready" ? workspaceState.workspaces.length : 0
  const readyActiveWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const canAddWorkspace =
    workspaceState.status === "ready" &&
    authorityStatus === "ready" &&
    authority !== null &&
    authority.isSubscriptionActive &&
    (authority.maxWorkspaces === "unlimited" ||
      (typeof authority.maxWorkspaces === "number" &&
        workspaceCount < authority.maxWorkspaces))
  debugRender("workspace-switcher", {
    workspaceStatus: workspaceState.status,
    activeWorkspaceId: readyActiveWorkspaceId,
    workspaceCount,
    canAddWorkspace,
    authorityStatus,
  })

  if (workspaceState.status !== "ready") {
    return null
  }

  const { activeWorkspace, activeWorkspaceId, workspaces } = workspaceState

  async function handleWorkspaceSelect(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return
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
        return
      }
    }

    if (navigationGuard?.mode === "background") {
      void navigationGuard.flush()
      toast({
        title: "Saving settings in background",
        description:
          navigationGuard.reason ??
          "Your latest settings changes will keep saving after you switch workspaces.",
      })
    }

    setActiveWorkspace(workspaceId)
    startTransition(() => {
      router.push("/app/home")
    })
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
