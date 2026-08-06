"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Capacitor } from "@capacitor/core"

import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAccountAuthorityState } from "@/contexts/account-authority-context"
import { useToast } from "@/hooks/use-toast"
import { createWorkspaceAPI } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import type { WorkspaceType } from "@shared/contracts/workspace"

function isWelcomeDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.host === "welcome" ||
      parsed.pathname === "/welcome" ||
      parsed.pathname.endsWith("/welcome")
    )
  } catch {
    return false
  }
}

export default function WelcomePage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user, authLoading } = useAuth()
  const { authority, status: authorityStatus, refreshAccountAuthority } = useAccountAuthorityState()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace)
  const isNativeApp = Capacitor.isNativePlatform()

  const [name, setName] = useState("")
  const [type, setType] = useState<WorkspaceType | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requestedAddWorkspaceMode, setRequestedAddWorkspaceMode] = useState(false)
  const lastBillingRefreshAtRef = useRef(0)

  const loadAccountAuthority = useCallback(
    async (options: { silent?: boolean; showActivatedToast?: boolean } = {}) => {
      if (!user) {
        return null
      }

      try {
        const refreshedAuthority = await refreshAccountAuthority({
          silent: options.silent,
        })

        if (!isNativeApp && options.showActivatedToast && refreshedAuthority?.isSubscriptionActive) {
          toast({
            title: "Subscription active",
            description: "Your billing is active. You can set up your workspace now.",
          })
        }

        return refreshedAuthority
      } catch (err: any) {
        toast({
          title: isNativeApp ? "Access error" : "Subscription error",
          description:
            err?.message ||
            (isNativeApp
              ? "Unable to load account access information."
              : "Unable to load subscription information."),
          variant: "destructive",
        })
        return null
      }
    },
    [isNativeApp, refreshAccountAuthority, toast, user]
  )

  useEffect(() => {
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    setRequestedAddWorkspaceMode(params.get("mode") === "add-workspace")

    if (isNativeApp) {
      return
    }

    const checkoutStatus = params.get("checkout")
    const billingReturn = params.get("billing_return")
    if (checkoutStatus === "success" || billingReturn === "1") {
      void loadAccountAuthority({ showActivatedToast: checkoutStatus === "success" })
    }
  }, [isNativeApp, loadAccountAuthority])

  useEffect(() => {
    if (typeof window === "undefined") return

    const refreshIfNeeded = () => {
      const now = Date.now()
      if (now - lastBillingRefreshAtRef.current < 5000) return
      lastBillingRefreshAtRef.current = now
      void loadAccountAuthority({ silent: true })
    }

    const onFocus = () => {
      refreshIfNeeded()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfNeeded()
      }
    }

    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibilityChange)

    let removeResume: (() => void) | undefined

    const setupNativeListeners = async () => {
      try {
        const { App } = await import("@capacitor/app")

        const resumeListener = await App.addListener("resume", () => {
          refreshIfNeeded()
        })
        removeResume = () => resumeListener.remove()
      } catch {
        // Native listeners are optional in the browser.
      }
    }

    if (Capacitor.isNativePlatform()) {
      void setupNativeListeners()
    }

    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      removeResume?.()
    }
  }, [loadAccountAuthority, router])

  const allowedWorkspaceTypes = authority?.allowedWorkspaceTypes ?? []

  const hasExistingWorkspace = workspaceState.status === "ready"
  const isAddWorkspaceMode = requestedAddWorkspaceMode || hasExistingWorkspace
  const currentWorkspaceCount =
    workspaceState.status === "ready" ? workspaceState.workspaces.length : 0
  const maxWorkspaces = authority?.maxWorkspaces ?? 0
  const hasReachedWorkspaceLimit =
    typeof maxWorkspaces === "number" && currentWorkspaceCount >= maxWorkspaces
  const canCreateWorkspace = allowedWorkspaceTypes.length > 0
  const canCreateAnotherWorkspace = canCreateWorkspace && !hasReachedWorkspaceLimit
  const hasSingleWorkspaceType = allowedWorkspaceTypes.length === 1
  const accessUnavailableMessage = hasReachedWorkspaceLimit
    ? isNativeApp
      ? "This StackIn account has reached its current workspace limit."
      : `You have used ${currentWorkspaceCount} of ${maxWorkspaces} available workspaces on this subscription.`
    : isNativeApp
      ? authority?.isSubscriptionActive
        ? "This StackIn account does not currently include mobile access to create another workspace."
        : "This mobile app is for existing StackIn customers with mobile access. If you expected access, contact support."
      : authority?.isSubscriptionActive
        ? "Your current subscription does not allow additional workspace creation."
        : "We couldn't find an active subscription for this account yet."

  useEffect(() => {
    if (hasSingleWorkspaceType) {
      setType(allowedWorkspaceTypes[0])
      return
    }

    setType((currentType) => {
      if (!currentType) return null
      return allowedWorkspaceTypes.includes(currentType) ? currentType : null
    })
  }, [allowedWorkspaceTypes, hasSingleWorkspaceType])

  const handleCreateWorkspace = async () => {
    if (!name.trim()) {
      toast({
        title: "Workspace name required",
        description: "Please enter a name for your workspace.",
        variant: "destructive",
      })
      return
    }

    if (!canCreateAnotherWorkspace) {
      toast({
        title: hasReachedWorkspaceLimit
          ? "Workspace limit reached"
          : isNativeApp
            ? "Access unavailable"
            : "Subscription required",
        description: hasReachedWorkspaceLimit
          ? isNativeApp
            ? "This StackIn account has reached its current workspace limit."
            : "Your current subscription has reached its workspace limit."
          : isNativeApp
            ? "This mobile app is for existing StackIn customers with mobile access."
            : "Create your subscription first, then come back here to set up your workspace.",
        variant: "destructive",
      })
      return
    }

    if (!type) {
      toast({
        title: "Workspace type required",
        description: "Please select a workspace type.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsSubmitting(true)

      const res = await createWorkspaceAPI({
        name: name.trim(),
        type,
      })

      if (!res?.workspace) {
        throw new Error("Workspace creation failed")
      }

      addWorkspace(
        {
          id: res.workspace.id,
          name: res.workspace.name,
          type: res.workspace.type,
          status: res.workspace.status ?? "active",
          createdAt: res.workspace.createdAt,
        },
        true
      )

      router.replace(
        `/app/settings?setup=1&workspaceId=${encodeURIComponent(res.workspace.id)}`
      )
    } catch (err: any) {
      toast({
        title: "Failed to create workspace",
        description: err?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (authLoading) {
    return <AppLoader label="Loading workspace setup..." />
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <p className="text-muted-foreground">Please sign in to continue.</p>
      </div>
    )
  }

  if (authorityStatus === "loading" || authorityStatus === "idle") {
    return <AppLoader label={isNativeApp ? "Loading account access..." : "loading subscription"} />
  }

  if (isSubmitting) {
    return <AppLoader label="Creating workspace..." />
  }

  return (
    <div className="min-h-screen bg-secondary/30 p-4 py-8">
      <StackInHeader />

      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">
              {isAddWorkspaceMode
                ? "Add a Workspace"
                : "Let’s Set Up Your First Workspace"}
            </CardTitle>
            <CardDescription>
              {isAddWorkspaceMode
                ? "Create another workspace for a new job or business."
                : "Choose a workspace name and type to continue."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace Name</label>
              <p className="text-xs text-muted-foreground">
                Use your company name, role, or business name. You can edit this later in your
                account settings.
              </p>
              <Input
                placeholder="e.g. Main Job, Freelance, Barber Shop"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace Type</label>

              {hasSingleWorkspaceType && type ? (
                <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                  {type === "w2" ? "W-2 / Hourly" : "Independent / Self-Employed"}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {allowedWorkspaceTypes.includes("w2") && (
                    <Button
                      type="button"
                      variant={type === "w2" ? "default" : "outline"}
                      onClick={() => setType("w2")}
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      W-2 / Hourly
                    </Button>
                  )}

                  {allowedWorkspaceTypes.includes("independent") && (
                    <Button
                      type="button"
                      variant={type === "independent" ? "default" : "outline"}
                      onClick={() => setType("independent")}
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      Independent / Self-Employed
                    </Button>
                  )}
                </div>
              )}

              {!canCreateAnotherWorkspace && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {accessUnavailableMessage}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t">
              <Button
                onClick={handleCreateWorkspace}
                disabled={isSubmitting || !canCreateAnotherWorkspace}
                className="w-full"
              >
                {isSubmitting
                  ? "Creating Workspace..."
                  : isAddWorkspaceMode
                    ? "Add Workspace"
                    : "Create Workspace"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
