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
import { FieldError } from "@/components/ui/field-error"
import { API_ENDPOINTS, apiFetch, createWorkspaceAPI } from "@/lib/api"
import { detectNativeSignupCountryEligibility } from "@/lib/mobile/nativeSignupEligibility"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import type { WorkspaceType } from "@shared/contracts/workspace"
import type { SubscriptionTier } from "@shared/contracts/subscription"

// Customer-facing plan names, matching app/app/account/page.tsx.
const PLAN_OPTIONS: { tier: SubscriptionTier; name: string; description: string }[] = [
  { tier: "w2_basic", name: "Essential", description: "For W-2 and hourly work" },
  { tier: "independent_basic", name: "Pro", description: "For independent and self-employed work" },
  { tier: "hybrid_plus", name: "Complete", description: "For both W-2 and self-employed work" },
]

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
  const [nameError, setNameError] = useState<string | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)
  const [requestedAddWorkspaceMode, setRequestedAddWorkspaceMode] = useState(false)
  const lastBillingRefreshAtRef = useRef(0)
  const [nativeCheckoutAllowed, setNativeCheckoutAllowed] = useState(false)
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null)
  const [openingCheckout, setOpeningCheckout] = useState(false)
  // Set once checkout has been opened in the browser; shows the "finished
  // checkout?" panel and makes returns to the app re-check access.
  const [awaitingCheckout, setAwaitingCheckout] = useState(false)
  const [checkingSubscription, setCheckingSubscription] = useState(false)

  useEffect(() => {
    setNativeCheckoutAllowed(isNativeApp && detectNativeSignupCountryEligibility())
  }, [isNativeApp])

  const loadAccountAuthority = useCallback(
    async (options: { silent?: boolean; showActivatedToast?: boolean } = {}) => {
      if (!user) {
        return null
      }

      try {
        const refreshedAuthority = await refreshAccountAuthority({
          silent: options.silent,
        })

        return refreshedAuthority
      } catch (err: any) {
        // Refreshes on focus and resume fail quietly; the next one retries.
        if (options.silent) return null
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

  const checkForNewSubscription = useCallback(
    async (options: { attempts?: number; announce?: boolean } = {}) => {
      const attempts = options.attempts ?? 6
      setCheckingSubscription(true)
      try {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const refreshed = await loadAccountAuthority({ silent: true })
          if (refreshed?.isSubscriptionActive) {
            setAwaitingCheckout(false)
            toast({
              title: "You're all set",
              description: "Your subscription is active. Now name your first workspace.",
            })
            return true
          }
          if (attempt < attempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
        }
        if (options.announce) {
          toast({
            title: "Subscription not active yet",
            description:
              "If you finished checkout, give it a moment and tap “I've finished checkout” again.",
          })
        }
        return false
      } finally {
        setCheckingSubscription(false)
      }
    },
    [loadAccountAuthority, toast]
  )

  // Stripe sends the person back through app.the521app.com/checkout/return,
  // which opens stackin://checkout/return?result=success|cancel.
  useEffect(() => {
    if (!isNativeApp) return
    let remove: (() => void) | undefined
    let cancelled = false

    void (async () => {
      try {
        const { App } = await import("@capacitor/app")
        const handle = await App.addListener("appUrlOpen", (event) => {
          if (!event.url.startsWith("stackin://checkout/return")) return
          const result = new URL(event.url).searchParams.get("result")
          if (result === "success") {
            setAwaitingCheckout(true)
            void checkForNewSubscription({ announce: true })
          } else {
            toast({
              title: "Checkout canceled",
              description: "No charge was made. Pick a plan whenever you're ready.",
            })
          }
        })
        if (cancelled) handle.remove()
        else remove = () => handle.remove()
      } catch {
        // @capacitor/app is always present in the native build.
      }
    })()

    return () => {
      cancelled = true
      remove?.()
    }
  }, [checkForNewSubscription, isNativeApp, toast])

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

  const handleOpenCheckout = async () => {
    // The button stays disabled until a plan is picked.
    if (!selectedTier) return

    try {
      setOpeningCheckout(true)
      const result = await apiFetch<{ ok: boolean; url?: string; error?: string }>(
        API_ENDPOINTS.subscription.createCheckoutSession,
        {
          method: "POST",
          body: JSON.stringify({ tier: selectedTier, source: "ios-app" }),
        }
      )
      if (!result?.url) {
        throw new Error(result?.error || "Checkout is unavailable right now.")
      }
      // Purchases link out to the default browser (US storefront external
      // purchase link). Capacitor hands top-level navigations to external
      // hosts to UIApplication.open, which launches Safari. The resume
      // listener above refreshes access when the person comes back.
      setAwaitingCheckout(true)
      window.location.href = result.url
    } catch (err: any) {
      toast({
        title: "Couldn't open checkout",
        description: err?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setOpeningCheckout(false)
    }
  }

  const allowedWorkspaceTypes = authority?.allowedWorkspaceTypes ?? []

  const hasExistingWorkspace = workspaceState.status === "ready"
  const isAddWorkspaceMode = requestedAddWorkspaceMode || hasExistingWorkspace
  const currentWorkspaceCount =
    workspaceState.status === "ready" ? workspaceState.workspaces.length : 0
  const maxWorkspaces = authority?.maxWorkspaces ?? 0
  // maxWorkspaces is 0 for an account with no subscription yet, which is
  // "nothing purchased", not "limit reached" — only a paid plan has a limit.
  const hasReachedWorkspaceLimit =
    Boolean(authority?.isSubscriptionActive) &&
    typeof maxWorkspaces === "number" &&
    currentWorkspaceCount >= maxWorkspaces
  const canCreateWorkspace = allowedWorkspaceTypes.length > 0
  const canCreateAnotherWorkspace = canCreateWorkspace && !hasReachedWorkspaceLimit
  const hasSingleWorkspaceType = allowedWorkspaceTypes.length === 1
  const showNativePlanPicker = nativeCheckoutAllowed && !authority?.isSubscriptionActive
  const accessUnavailableMessage = hasReachedWorkspaceLimit
    ? isNativeApp
      ? "This 521 account has reached its current workspace limit."
      : `You have used ${currentWorkspaceCount} of ${maxWorkspaces} available workspaces on this subscription.`
    : isNativeApp
      ? authority?.isSubscriptionActive
        ? "This 521 account does not currently include mobile access to create another workspace."
        : "This mobile app is for existing 521 customers with mobile access. If you expected access, contact support."
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
    setNameError(name.trim() ? null : "Enter a name for this workspace.")
    setTypeError(type ? null : "Choose a workspace type.")
    if (!name.trim()) return

    // The button is disabled and the reason shown under the type picker.
    if (!canCreateAnotherWorkspace) return

    if (!type) return

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
        user.uid,
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
                : showNativePlanPicker
                  ? "Pick a plan to get started. Then you'll name your first workspace."
                  : "Choose a workspace name and type to continue."}
            </CardDescription>
          </CardHeader>

          {showNativePlanPicker ? (
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Choose your plan</label>
                <div className="grid grid-cols-1 gap-3">
                  {PLAN_OPTIONS.map((plan) => (
                    <button
                      key={plan.tier}
                      type="button"
                      onClick={() => setSelectedTier(plan.tier)}
                      disabled={openingCheckout}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        selectedTier === plan.tier
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="text-sm font-semibold">{plan.name}</div>
                      <div className="text-xs text-muted-foreground">{plan.description}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Checkout opens in your web browser. Come back to the app when you're done to set up
                  your workspace.
                </p>
              </div>

              <div className="pt-4 border-t">
                <Button
                  onClick={handleOpenCheckout}
                  disabled={openingCheckout || !selectedTier}
                  className="w-full"
                >
                  {openingCheckout ? "Opening checkout..." : "Continue to checkout"}
                </Button>
                {awaitingCheckout && (
                  <Button
                    variant="outline"
                    onClick={() => void checkForNewSubscription({ attempts: 3, announce: true })}
                    disabled={checkingSubscription}
                    className="w-full mt-3"
                  >
                    {checkingSubscription ? "Checking your subscription..." : "I've finished checkout"}
                  </Button>
                )}
              </div>
            </CardContent>
          ) : (
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
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(null)
                }}
                disabled={isSubmitting}
                aria-invalid={!!nameError}
              />
              <FieldError message={nameError} />
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

              <FieldError message={type ? null : typeError} />

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
          )}
        </Card>
      </div>
    </div>
  )
}
