"use client"

import { startTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Plus } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { debugRender } from "@/lib/debugLoop"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useToast } from "@/hooks/use-toast"
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context"

// A workspace's colored initial: green for self-employed, blue for W-2.
function WorkspaceAvatar({ name, type, size = "sm" }: { name: string; type: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold uppercase ${
        size === "lg" ? "size-10 text-base" : "size-7 text-xs"
      } ${type === "w2" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-primary/15 text-primary"}`}
      aria-hidden="true"
    >
      {name.trim().charAt(0) || "?"}
    </span>
  )
}

function workspaceTypeLabel(type: string) {
  return type === "w2" ? "W-2" : "Self-employed"
}

export default function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false)
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

    setOpen(false)
    setActiveWorkspace(workspaceId)
    startTransition(() => {
      router.push("/app/home")
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-full border border-card-border bg-card py-1 pl-1 pr-3 text-sm font-medium text-foreground transition hover:bg-muted"
          aria-label="Open workspace switcher"
        >
          <WorkspaceAvatar name={activeWorkspace.name} type={activeWorkspace.type} />
          <span className="truncate">{activeWorkspace.name}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-3 pt-1">
          <SheetTitle className="text-lg">Switch workspace</SheetTitle>
          <SheetDescription className="sr-only">Choose which workspace to view.</SheetDescription>
        </SheetHeader>

        <div className="space-y-2">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId
            return (
              <button
                key={workspace.id}
                type="button"
                onClick={() => void handleWorkspaceSelect(workspace.id)}
                aria-current={isActive ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                  isActive ? "border-primary bg-muted" : "border-transparent bg-muted hover:border-card-border"
                }`}
              >
                <WorkspaceAvatar name={workspace.name} type={workspace.type} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{workspace.name}</span>
                  <span className="block text-xs text-muted-foreground">{workspaceTypeLabel(workspace.type)}</span>
                </span>
                {isActive ? <Check className="h-5 w-5 shrink-0 text-primary" /> : null}
              </button>
            )
          })}

          {canAddWorkspace ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                router.push("/welcome?mode=add-workspace")
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-4 w-4 text-primary" />
              Add workspace
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
