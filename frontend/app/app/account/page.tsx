"use client"

import { useEffect, useState } from "react"
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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { API_ENDPOINTS, apiFetch } from "@/lib/api"
import { deleteWorkspaceAPI, updateWorkspaceAPI } from "@/lib/api/workspaceApi"
import StackInHeader from "@/components/stackin-header"
import { useTheme } from "next-themes"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore"
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore"
import { useProfitLossStore } from "@/lib/stores/useProfitLossStore"
import { useImportsStore } from "@/lib/stores/useImportsStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
import { clearWorkspaceLocalDomainData } from "@/lib/domain"
import { purgeWorkspaceTimeEntryReminders } from "@/lib/mobile/timeEntryReminderSync"
import {
  syncAllWorkspaceGeofenceEntryStatus,
  syncAllWorkspaceGeofenceReminders,
} from "@/lib/mobile/geofenceReminderSync"
import { debugError, debugLog } from "@/lib/debugLoop"
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context"

export default function AccountPage() {
  const router = useRouter()
  const isNativeApp = Capacitor.isNativePlatform()
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const { authority, authorityStatus, refreshAuthority } = useAppBootstrapState()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace)
  const clearSettings = useSettingsStore((s) => s.clear)
  const clearEntries = useEntriesStore((s) => s.clear)
  const clearExpenses = useExpensesStore((s) => s.clear)
  const clearTaxProfile = useTaxProfileStore((s) => s.clear)
  const clearPayStubs = usePayStubsStore((s) => s.clear)
  const clearProfitLoss = useProfitLossStore((s) => s.clear)
  const clearImports = useImportsStore((s) => s.clear)
  const clearReceiptDrafts = useReceiptDraftsStore((s) => s.clear)

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showDeleteWorkspaceDialog, setShowDeleteWorkspaceDialog] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [isSchedulingDeletion, setIsSchedulingDeletion] = useState(false)
  const [isCancellingDeletion, setIsCancellingDeletion] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [workspaceName, setWorkspaceName] = useState("")
  const [isSavingWorkspaceName, setIsSavingWorkspaceName] = useState(false)
  const [workspaceToDeleteId, setWorkspaceToDeleteId] = useState("")
  const [workspaceDeleteReason, setWorkspaceDeleteReason] = useState("")
  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("")
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [workspaceDeleteNotice, setWorkspaceDeleteNotice] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])
  const subscription = authority?.subscription ?? null
  const isLoadingSubscription = authorityStatus === "loading" || authorityStatus === "idle"

const handleLogout = async () => {
  await logout()        // from auth-context
  router.push("/login")
}

  /** Safe Password Reset */
  const handlePasswordReset = async () => {
    if (!user?.email) {
      toast({
        title: "No email found",
        description: "Unable to send reset email.",
        variant: "destructive",
      })
      return
    }

    const auth = getAuthSafe()
    if (!auth) {
      toast({
        title: "Auth unavailable",
        description: "Please refresh the page and try again.",
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
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send password reset email",
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
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const availableWorkspaces =
    workspaceState.status === "ready" ? workspaceState.workspaces : []
  const workspaceToDelete =
    availableWorkspaces.find((workspace) => workspace.id === workspaceToDeleteId) ?? null
  const isWorkspaceDeleteConfirmed =
    workspaceToDelete != null &&
    workspaceDeleteConfirmation.trim() === workspaceToDelete.name &&
    workspaceDeleteReason.trim().length >= 3

  useEffect(() => {
    setWorkspaceName(activeWorkspace?.name ?? "")
  }, [activeWorkspace?.id, activeWorkspace?.name])

  useEffect(() => {
    if (workspaceState.status !== "ready") {
      setWorkspaceToDeleteId("")
      return
    }

    setWorkspaceToDeleteId((current) => {
      if (
        activeWorkspace?.id &&
        workspaceState.workspaces.some((workspace) => workspace.id === activeWorkspace.id)
      ) {
        return activeWorkspace.id
      }

      if (current && workspaceState.workspaces.some((workspace) => workspace.id === current)) {
        return current
      }
      return workspaceState.workspaces[0]?.id ?? ""
    })
  }, [workspaceState, activeWorkspace?.id])

  const handleDeleteAccount = async () => {
    const auth = getAuthSafe()
    if (!auth || !auth.currentUser) {
      toast({
        title: "Auth unavailable",
        description: "Please refresh and sign in again.",
        variant: "destructive",
      })
      return
    }

    if (!user) return
    if (!user.email) {
      toast({
        title: "Missing email",
        description: "We could not verify your account email for re-authentication.",
        variant: "destructive",
      })
      return
    }

    if (!deletePassword) {
      toast({
        title: "Password required",
        description: "Enter your password to confirm account deletion.",
        variant: "destructive",
      })
      return
    }

    setIsSchedulingDeletion(true)

    try {
      const credential = EmailAuthProvider.credential(user.email, deletePassword)
      await reauthenticateWithCredential(auth.currentUser, credential)

      const res = await apiFetch<{
        scheduledDeletionAt?: number
        deletedImmediately?: boolean
      }>(API_ENDPOINTS.user.requestDeletion, { method: "POST", body: JSON.stringify({}) })

      if (res.deletedImmediately) {
        toast({
          title: "Account Deleted",
          description: "Your account and all data have been permanently removed.",
        })
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
      toast({
        title: "Error",
        description: err.message || "Failed to schedule account deletion",
        variant: "destructive",
      })
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
      toast({
        title: "Deletion Request Removed",
        description: isNativeApp
          ? "Your account deletion request has been removed and your access will continue."
          : "Your subscription and account deletion request have been restored.",
      })
      await refreshAuthority().catch((error) => {
        debugError("account-page", "refresh_authority_after_delete_cancel_failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      })
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to undo account deletion request",
        variant: "destructive",
      })
    } finally {
      setIsCancellingDeletion(false)
    }
  }

  const handleWorkspaceRename = async () => {
    if (!activeWorkspace) return

    const nextName = workspaceName.trim()
    if (!nextName) {
      toast({
        title: "Workspace name required",
        description: "Enter a workspace name before saving.",
        variant: "destructive",
      })
      return
    }

    if (nextName === activeWorkspace.name) {
      toast({
        title: "No changes to save",
        description: "Your workspace name is already up to date.",
      })
      return
    }

    try {
      setIsSavingWorkspaceName(true)
      const res = await updateWorkspaceAPI(activeWorkspace.id, { name: nextName })
      updateWorkspace(activeWorkspace.id, {
        name: res.workspace?.name ?? nextName,
      })
      toast({
        title: "Workspace updated",
        description: "Your workspace name has been saved.",
      })
    } catch (err: any) {
      toast({
        title: "Unable to update workspace",
        description: err?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSavingWorkspaceName(false)
    }
  }

  const resetWorkspaceDeleteDialog = () => {
    setShowDeleteWorkspaceDialog(false)
    setWorkspaceDeleteReason("")
    setWorkspaceDeleteConfirmation("")
  }

  const handleDeleteWorkspace = async () => {
    if (!workspaceToDelete) {
      toast({
        title: "Choose a workspace",
        description: "Select the workspace you want to delete.",
        variant: "destructive",
      })
      return
    }

    if (!isWorkspaceDeleteConfirmed) {
      toast({
        title: "Confirmation required",
        description: "Enter the workspace name and tell us why you're deleting it.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsDeletingWorkspace(true)
      setWorkspaceDeleteNotice(null)
      const deletedWorkspaceId = workspaceToDelete.id
      const deletedWorkspaceName = workspaceToDelete.name
      const remainingWorkspaces = availableWorkspaces.filter(
        (workspace) => workspace.id !== deletedWorkspaceId
      )
      debugLog("workspace-delete", "delete_flow_start", {
        deletedWorkspaceId,
        deletedWorkspaceName,
        remainingWorkspaceCount: remainingWorkspaces.length,
      })

      debugLog("workspace-delete", "backend_delete_start", {
        deletedWorkspaceId,
      })
      await deleteWorkspaceAPI(workspaceToDelete.id, {
        reason: workspaceDeleteReason.trim(),
      })
      debugLog("workspace-delete", "backend_delete_complete", {
        deletedWorkspaceId,
      })

      debugLog("workspace-delete", "local_domain_cleanup_start", {
        deletedWorkspaceId,
      })
      await clearWorkspaceLocalDomainData(deletedWorkspaceId)
      debugLog("workspace-delete", "local_domain_cleanup_complete", {
        deletedWorkspaceId,
      })

      debugLog("workspace-delete", "time_reminder_cleanup_start", {
        deletedWorkspaceId,
      })
      await purgeWorkspaceTimeEntryReminders(deletedWorkspaceId)
      debugLog("workspace-delete", "time_reminder_cleanup_complete", {
        deletedWorkspaceId,
      })

      debugLog("workspace-delete", "workspace_store_remove_start", {
        deletedWorkspaceId,
      })
      removeWorkspace(deletedWorkspaceId)
      debugLog("workspace-delete", "workspace_store_remove_complete", {
        deletedWorkspaceId,
      })

      debugLog("workspace-delete", "workspace_store_cleanup_start", {
        deletedWorkspaceId,
      })
      await clearSettings(deletedWorkspaceId)
      clearEntries(deletedWorkspaceId)
      await clearExpenses(deletedWorkspaceId)
      await clearTaxProfile(deletedWorkspaceId)
      await clearPayStubs(deletedWorkspaceId)
      await clearProfitLoss(deletedWorkspaceId)
      clearImports(deletedWorkspaceId)
      clearReceiptDrafts(deletedWorkspaceId)
      debugLog("workspace-delete", "workspace_store_cleanup_complete", {
        deletedWorkspaceId,
      })

      debugLog("workspace-delete", "geofence_sync_start", {
        deletedWorkspaceId,
        remainingWorkspaceCount: remainingWorkspaces.length,
      })
      await syncAllWorkspaceGeofenceReminders(remainingWorkspaces)
      await syncAllWorkspaceGeofenceEntryStatus(remainingWorkspaces)
      debugLog("workspace-delete", "geofence_sync_complete", {
        deletedWorkspaceId,
        remainingWorkspaceCount: remainingWorkspaces.length,
      })

      toast({
        title: "Workspace deleted",
        description: `${deletedWorkspaceName} and its data were permanently removed.`,
      })
      setWorkspaceDeleteNotice(`${deletedWorkspaceName} was deleted successfully.`)

      resetWorkspaceDeleteDialog()
    } catch (err: any) {
      debugError("workspace-delete", "delete_flow_failed", {
        deletedWorkspaceId: workspaceToDelete?.id ?? null,
        deletedWorkspaceName: workspaceToDelete?.name ?? null,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : null,
        code:
          typeof err?.code === "string" || typeof err?.code === "number"
            ? String(err.code)
            : null,
        details: typeof err?.details === "string" ? err.details : null,
      })
      toast({
        title: "Unable to delete workspace",
        description: err?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      debugLog("workspace-delete", "delete_flow_finished", {
        workspaceId: workspaceToDelete?.id ?? null,
      })
      setIsDeletingWorkspace(false)
    }
  }

  // 🧱 Render
  if (!user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <p className="text-muted-foreground">Please log in to view your account.</p>
      </div>
    )

  return (
    <div className="min-h-screen bg-secondary/30 p-4 py-8">
      <StackInHeader />
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Account Settings</CardTitle>
            <CardDescription>Manage your login and account security.</CardDescription>
          </CardHeader>

	          <CardContent className="space-y-6">
	            <div className="space-y-2">
	              <h3 className="font-semibold text-base">Email</h3>
	              <p className="text-sm text-muted-foreground">{user.email}</p>
	            </div>

	            <div className="space-y-3 border-t border-muted pt-4">
	              <h3 className="font-semibold text-base">
	                {isNativeApp ? "Account" : "Subscription"}
	              </h3>
	              {isLoadingSubscription ? (
	                <p className="text-sm text-muted-foreground">
	                  {isNativeApp ? "Loading account details..." : "Loading subscription status..."}
	                </p>
	              ) : subscription ? (
	                <>
	                  {isNativeApp ? (
	                    <p className="text-sm text-muted-foreground">
	                      Your StackIn account is ready to use on mobile.
	                    </p>
	                  ) : (
	                    <p className="text-sm text-muted-foreground">
	                      Current plan: <span className="font-medium text-foreground">{subscription.tier}</span>
	                    </p>
	                  )}
	                  {subscription.pendingAccountDeletion && scheduledDeletionLabel ? (
	                    <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
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
	                        className="w-full"
	                        onClick={handleUndoDeletionRequest}
	                        disabled={isCancellingDeletion}
	                      >
	                        {isCancellingDeletion ? "Restoring..." : "Undo Deletion Request"}
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
	                    ? "Mobile access is not available for this StackIn account right now."
	                    : "No active subscription is linked to this account right now."}
	                </p>
	              )}
	            </div>

	            <div className="space-y-3 pt-4 border-t border-muted">
	              <h3 className="font-semibold text-base">Workspace</h3>
              {activeWorkspace ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Update the name of your current workspace.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="workspace-name">Workspace Name</Label>
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="Workspace name"
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleWorkspaceRename}
                    disabled={isSavingWorkspaceName}
                    className="w-full"
                  >
                    {isSavingWorkspaceName ? "Saving..." : "Save Workspace Name"}
                  </Button>
                  {workspaceDeleteNotice ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      {workspaceDeleteNotice}
                    </div>
                  ) : null}
                  <div className="space-y-2 pt-2">
                    <h4 className="font-semibold text-sm text-red-600">Delete Workspace</h4>
                    <p className="text-sm text-muted-foreground">
                      Permanently remove one workspace, all of its records, and its nested files without deleting your whole account.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full border-red-500 text-red-600 hover:bg-destructive/12 hover:text-red-500 dark:border-red-500/80 dark:text-red-400"
                      onClick={() => setShowDeleteWorkspaceDialog(true)}
                      disabled={availableWorkspaces.length === 0}
                    >
                      Delete Workspace
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Create a workspace first to edit its name here.
                </p>
              )}
            </div>

            <div className="space-y-3 pt-4 border-t border-muted">
              <h3 className="font-semibold text-base">Appearance</h3>
              <p className="text-sm text-muted-foreground">
                Light mode is now the default. Switch on dark mode anytime and we’ll remember your preference.
              </p>
              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                <div className="space-y-1">
                  <div className="font-medium">Dark Mode</div>
                  <div className="text-sm text-muted-foreground">
                    {mounted
                      ? theme === "dark"
                        ? "Using the darker green and charcoal theme."
                        : "Using the lighter gray default theme."
                      : "Loading theme preference..."}
                  </div>
                </div>
                <Switch
                  checked={mounted ? theme === "dark" : false}
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                  aria-label="Toggle dark mode"
                />
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-muted">
              <h3 className="font-semibold text-base">Password</h3>
              <p className="text-sm text-muted-foreground mb-2">
                You can reset your password via email.
              </p>
              <Button
                variant="outline"
                onClick={handlePasswordReset}
                disabled={isResetting}
                className="w-full"
              >
                {isResetting ? "Sending..." : "Send Password Reset Email"}
              </Button>
            </div>

            {/* Action Footer */}
<div className="border-t pt-6 space-y-6">

  {/* Logout */}
  <div className="space-y-2">
    <h3 className="font-semibold text-base">Logout</h3>
    <Button
      variant="outline"
      className="w-full border-border text-foreground hover:bg-accent transition"
      onClick={handleLogout}
    >
      Log Out
    </Button>
  </div>

  {/* Delete Account */}
	  <div className="space-y-2">
	    <h3 className="font-semibold text-base text-red-600">Delete Account</h3>
	    <p className="text-sm text-muted-foreground">
	      {isNativeApp
	        ? "Schedule this account for deletion. Your access will remain active until your current access period ends."
	        : "Cancel your subscription and schedule this account for deletion at the end of your free trial or current paid period."}
	    </p>

	    <Button
	      variant="outline"
      className="w-full border-red-500 text-red-600 hover:bg-destructive/12 hover:text-red-500 dark:border-red-500/80 dark:text-red-400"
      onClick={() => setShowConfirmDelete(true)}
      disabled={Boolean(subscription?.pendingAccountDeletion)}
    >
      {subscription?.pendingAccountDeletion ? "Deletion Scheduled" : "Delete Account"}
    </Button>
  </div>
</div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <DialogContent className="max-w-md text-center space-y-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-destructive">
              Schedule Account Deletion
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
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your password"
              />
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
                  ? "Schedule Account Deletion"
                  : "Cancel Subscription and Delete Account"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmDelete(false)
                setDeletePassword("")
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteWorkspaceDialog} onOpenChange={setShowDeleteWorkspaceDialog}>
        <DialogContent className="max-w-md space-y-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-destructive">
              Delete Workspace
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the selected workspace, all nested Firestore data, and any workspace files tied to it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="workspace-delete-target">Workspace</Label>
              <Select value={workspaceToDeleteId} onValueChange={setWorkspaceToDeleteId}>
                <SelectTrigger id="workspace-delete-target" className="w-full">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {availableWorkspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-delete-reason">Why are you deleting it?</Label>
              <Textarea
                id="workspace-delete-reason"
                value={workspaceDeleteReason}
                onChange={(e) => setWorkspaceDeleteReason(e.target.value)}
                placeholder="Example: I left this job and no longer need this workspace."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-delete-confirmation">
                Type <span className="font-medium text-foreground">{workspaceToDelete?.name ?? "the workspace name"}</span> to confirm
              </Label>
              <Input
                id="workspace-delete-confirmation"
                value={workspaceDeleteConfirmation}
                onChange={(e) => setWorkspaceDeleteConfirmation(e.target.value)}
                placeholder={workspaceToDelete?.name ?? "Workspace name"}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              variant="destructive"
              onClick={handleDeleteWorkspace}
              disabled={isDeletingWorkspace || !isWorkspaceDeleteConfirmed}
              className="w-full"
            >
              {isDeletingWorkspace ? "Deleting..." : "Delete Workspace Permanently"}
            </Button>
            <Button
              variant="outline"
              onClick={resetWorkspaceDeleteDialog}
              disabled={isDeletingWorkspace}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
