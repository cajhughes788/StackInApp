"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Capacitor } from "@capacitor/core"
import { getAuthSafe } from "@/lib/firebase"
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
} from "firebase/auth"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { ChevronRight, CreditCard, KeyRound, LogOut } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { FieldError } from "@/components/ui/field-error"
import { API_ENDPOINTS, apiFetch } from "@/lib/api"
import StackInHeader from "@/components/stackin-header"
import { debugError } from "@/lib/debugLoop"
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context"

// Customer-facing plan names for the subscription tiers.
const PLAN_NAMES: Record<string, string> = {
  w2_basic: "Essential",
  independent_basic: "Pro",
  hybrid_plus: "Complete",
}

export default function AccountPage() {
  const router = useRouter()
  const isNativeApp = Capacitor.isNativePlatform()
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const { authority, authorityStatus, refreshAuthority } = useAppBootstrapState()

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isSchedulingDeletion, setIsSchedulingDeletion] = useState(false)
  const [isCancellingDeletion, setIsCancellingDeletion] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  const subscription = authority?.subscription ?? null
  const isLoadingSubscription = authorityStatus === "loading" || authorityStatus === "idle"

const handleLogout = async () => {
  await logout()        // from auth-context
  router.push("/login")
}

  /** Safe Password Reset */
  const handlePasswordReset = async () => {
    const auth = getAuthSafe()
    if (!user?.email || !auth) {
      toast({
        title: "Couldn't send the reset email",
        description: "Refresh the page and try again.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsResetting(true)
      await sendPasswordResetEmail(auth, user.email)
      toast({
        title: "Password Reset Email Sent",
        description: `A password reset link has been sent to ${user.email}`,
      })
    } catch {
      toast({
        title: "Couldn't send the reset email",
        description: "Check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setIsResetting(false)
    }
  }

  const formatDeletionDate = (timestamp?: number) => {
    if (!timestamp) return null

    const date = new Date(timestamp)
    if (
      Number.isNaN(date.getTime()) ||
      timestamp < Date.UTC(2000, 0, 1) ||
      timestamp > Date.UTC(2100, 0, 1)
    ) {
      return null
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  const scheduledDeletionAt =
    subscription?.scheduledDeletionAt ?? subscription?.currentPeriodEnd
  const accessPeriodEndAt = subscription?.currentPeriodEnd ?? subscription?.scheduledDeletionAt
  const scheduledDeletionLabel = formatDeletionDate(scheduledDeletionAt)
  const subscriptionEndLabel = formatDeletionDate(accessPeriodEndAt)
  const isTrialingSubscription = subscription?.status === "trialing"
  const accessPeriodLabel = isTrialingSubscription
    ? "free trial"
    : "current paid period"
  const accessPeriodEndPhrase = isTrialingSubscription
    ? "when your free trial ends"
    : "when your current paid period ends"
  const nativeAccessPeriodLabel = "current access period"
  const nativeAccessPeriodEndPhrase = "when your current access period ends"

  const handleDeleteAccount = async () => {
    const auth = getAuthSafe()
    if (!user) return
    if (!auth?.currentUser || !user.email) {
      setDeleteError("Something went wrong. Sign out, sign back in and try again.")
      return
    }

    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.")
      return
    }
    setDeleteError(null)

    setIsSchedulingDeletion(true)

    try {
      const credential = EmailAuthProvider.credential(user.email, deletePassword)
      await reauthenticateWithCredential(auth.currentUser, credential)

      const res = await apiFetch<{
        scheduledDeletionAt?: number
        deletedImmediately?: boolean
      }>(API_ENDPOINTS.user.requestDeletion, { method: "POST", body: JSON.stringify({}) })

      if (res.deletedImmediately) {
        await logout()
        router.push("/login")
        return
      }

      toast({
        title: "Deletion Scheduled",
        description: `Your account will stay active until ${
          isNativeApp
            ? "your current access period ends"
            : isTrialingSubscription
              ? "your free trial ends"
              : "your current paid period ends"
        }. It will be deleted on ${
          formatDeletionDate(res.scheduledDeletionAt ?? scheduledDeletionAt) ??
          (isNativeApp ? "the last day of your access period" : "the last day of your subscription")
        } and all of your data will be permanently lost.`,
      })
      setDeletePassword("")
      setShowConfirmDelete(false)
      await refreshAuthority().catch((error) => {
        debugError("account-page", "refresh_authority_after_delete_schedule_failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      })
    } catch (err: any) {
      setDeleteError(err.message || "Couldn't schedule the deletion. Try again.")
    } finally {
      setIsSchedulingDeletion(false)
    }
  }

  const handleUndoDeletionRequest = async () => {
    try {
      setIsCancellingDeletion(true)
      await apiFetch(API_ENDPOINTS.user.cancelDeletionRequest, {
        method: "POST",
        body: JSON.stringify({}),
      })
      await refreshAuthority().catch((error) => {
        debugError("account-page", "refresh_authority_after_delete_cancel_failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      })
    } catch (err: any) {
      toast({
        title: "Couldn't undo the deletion request",
        description: err.message || "Check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setIsCancellingDeletion(false)
    }
  }


  // 🧱 Render
  if (!user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Please log in to view your account.</p>
      </div>
    )

  return (
    <div className="min-h-screen bg-background">
      <StackInHeader />
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10 pt-4">
        <section className="flex items-center gap-4 rounded-[22px] border border-card-border bg-card p-5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xl font-semibold uppercase text-primary" aria-hidden="true">
            {(user.email ?? "?").charAt(0)}
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-medium text-muted-foreground">Account</h1>
            <p className="truncate text-lg font-semibold text-foreground">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your workspace name, appearance and deleting a workspace are in Settings.
            </p>
          </div>
        </section>

        <Card className="gap-0 py-2">
          <CardContent className="divide-y divide-border/70">
            <div className="flex items-start gap-3 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground" aria-hidden="true">
                <CreditCard className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-foreground">{isNativeApp ? "Your account" : "Subscription"}</span>
                  {!isLoadingSubscription && subscription && !isNativeApp ? (
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">{PLAN_NAMES[subscription.tier] ?? subscription.tier}</span>
                  ) : null}
                </div>
                {isLoadingSubscription ? (
                  <p className="text-sm text-muted-foreground">
                    {isNativeApp ? "Loading account details..." : "Loading subscription status..."}
                  </p>
                ) : subscription ? (
                  <>
                    {isNativeApp ? (
                      <p className="text-sm text-muted-foreground">
                        Your 521 account is ready to use on mobile.
                      </p>
                    ) : null}
                    {subscription.pendingAccountDeletion && scheduledDeletionLabel ? (
                      <div className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                        <div className="space-y-1">
                          <div className="font-medium text-destructive">Account deletion scheduled</div>
                          <p className="text-sm text-muted-foreground">
                            Your account will stay active until{" "}
                            {isNativeApp ? nativeAccessPeriodEndPhrase : accessPeriodEndPhrase}. It will be deleted on{" "}
                            <span className="font-medium text-foreground">{scheduledDeletionLabel}</span>, and all of your data will be permanently lost.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full rounded-xl"
                          onClick={handleUndoDeletionRequest}
                          disabled={isCancellingDeletion}
                        >
                          {isCancellingDeletion ? "Restoring..." : "Undo deletion request"}
                        </Button>
                      </div>
                    ) : subscriptionEndLabel ? (
                      <p className="text-sm text-muted-foreground">
                        Your {isNativeApp ? nativeAccessPeriodLabel : accessPeriodLabel} ends on{" "}
                        {subscriptionEndLabel}.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isNativeApp
                      ? "Mobile access is not available for this 521 account right now."
                      : "No active subscription is linked to this account right now."}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground" aria-hidden="true">
                <KeyRound className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">Password</div>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll email you a link to set a new password.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePasswordReset}
                disabled={isResetting}
                className="shrink-0 rounded-full"
              >
                {isResetting ? "Sending..." : "Send link"}
              </Button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 py-3.5 text-left"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground" aria-hidden="true">
                <LogOut className="size-5" />
              </span>
              <span className="flex-1 font-medium text-foreground">Log out</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {isNativeApp
                  ? "Schedule this account for deletion. Your access will remain active until your current access period ends."
                  : "Cancel your subscription and schedule this account for deletion at the end of your free trial or current paid period."}
              </p>
              <Button
                variant="outline"
                className="w-full rounded-xl border-red-500 text-red-600 hover:bg-destructive/12 hover:text-red-500 dark:border-red-500/80 dark:text-red-400"
                onClick={() => setShowConfirmDelete(true)}
                disabled={Boolean(subscription?.pendingAccountDeletion)}
              >
                {subscription?.pendingAccountDeletion ? "Deletion scheduled" : "Delete account"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <DialogContent className="max-w-md text-center space-y-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-destructive">
              Schedule account deletion
            </DialogTitle>
            <DialogDescription>
              {isNativeApp
                ? "Your account will remain active until your current access period ends. That date is "
                : `Your subscription will be canceled and your account will remain active until ${accessPeriodEndPhrase}. That date is `}
              <span className="font-medium text-foreground">
                {scheduledDeletionLabel ??
                  subscriptionEndLabel ??
                  (isNativeApp ? "the last day of your access period" : "the last day of your subscription")}
              </span>
              . On that date, your account and all associated data will be permanently deleted and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-left">
            <div className="space-y-2">
              <Label htmlFor="delete-password">Confirm with your password</Label>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value)
                  setDeleteError(null)
                }}
                placeholder="Enter your password"
                aria-invalid={!!deleteError}
              />
              <FieldError message={deleteError} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={isSchedulingDeletion}
              className="w-full"
            >
              {isSchedulingDeletion
                ? "Scheduling..."
                : isNativeApp
                  ? "Schedule account deletion"
                  : "Cancel subscription and delete account"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmDelete(false)
                setDeletePassword("")
                setDeleteError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
