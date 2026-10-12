"use client"

// Workspace and appearance cards for the Settings page: renaming the active
// workspace, its Danger zone (deleting a workspace), and the dark-mode switch.
// These used to live on the Account page; Settings is per workspace, so the
// workspace's own name and deletion sit with the rest of its settings.

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
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
import { deleteWorkspaceAPI, updateWorkspaceAPI } from "@/lib/api/workspaceApi"
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

/** Rename the active workspace. */
export function WorkspaceNameCard() {
  const { toast } = useToast()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const [workspaceName, setWorkspaceName] = useState("")
  const [isSavingWorkspaceName, setIsSavingWorkspaceName] = useState(false)

  useEffect(() => {
    setWorkspaceName(activeWorkspace?.name ?? "")
  }, [activeWorkspace?.id, activeWorkspace?.name])

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
      return
    }

    try {
      setIsSavingWorkspaceName(true)
      const res = await updateWorkspaceAPI(activeWorkspace.id, { name: nextName })
      updateWorkspace(activeWorkspace.id, {
        name: res.workspace?.name ?? nextName,
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

  if (!activeWorkspace) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="workspace-name" className="text-sm font-normal text-muted-foreground">Workspace name</Label>
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
          className="w-full rounded-xl"
        >
          {isSavingWorkspaceName ? "Saving..." : "Save workspace name"}
        </Button>
      </CardContent>
    </Card>
  )
}

/** The dark-mode switch. */
export function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-foreground">Dark mode</div>
            <div className="text-xs text-muted-foreground">
              {mounted
                ? theme === "dark"
                  ? "Charcoal theme. Turn off for the light theme."
                  : "Light theme. Turn on for the charcoal theme."
                : "Loading theme preference..."}
            </div>
          </div>
          <Switch
            checked={mounted ? theme === "dark" : false}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            aria-label="Toggle dark mode"
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Delete a workspace — any of yours, defaulting to the active one. */
export function WorkspaceDangerZone() {
  const { toast } = useToast()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace)
  const clearSettings = useSettingsStore((s) => s.clear)
  const clearEntries = useEntriesStore((s) => s.clear)
  const clearExpenses = useExpensesStore((s) => s.clear)
  const clearTaxProfile = useTaxProfileStore((s) => s.clear)
  const clearPayStubs = usePayStubsStore((s) => s.clear)
  const clearProfitLoss = useProfitLossStore((s) => s.clear)
  const clearImports = useImportsStore((s) => s.clear)
  const clearReceiptDrafts = useReceiptDraftsStore((s) => s.clear)

  const [showDeleteWorkspaceDialog, setShowDeleteWorkspaceDialog] = useState(false)
  const [workspaceToDeleteId, setWorkspaceToDeleteId] = useState("")
  const [workspaceDeleteReason, setWorkspaceDeleteReason] = useState("")
  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("")
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [workspaceDeleteNotice, setWorkspaceDeleteNotice] = useState<string | null>(null)

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

  if (availableWorkspaces.length === 0 && !workspaceDeleteNotice) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {workspaceDeleteNotice ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {workspaceDeleteNotice}
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Delete workspace</h3>
            <p className="text-sm text-muted-foreground">
              Permanently remove one workspace, all of its records, and its nested files without deleting your whole account.
            </p>
            <Button
              variant="outline"
              className="w-full rounded-xl border-red-500 text-red-600 hover:bg-destructive/12 hover:text-red-500 dark:border-red-500/80 dark:text-red-400"
              onClick={() => setShowDeleteWorkspaceDialog(true)}
              disabled={availableWorkspaces.length === 0}
            >
              Delete workspace
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDeleteWorkspaceDialog} onOpenChange={setShowDeleteWorkspaceDialog}>
        <DialogContent className="max-w-md space-y-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-destructive">
              Delete workspace
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
              {isDeletingWorkspace ? "Deleting..." : "Delete workspace permanently"}
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
    </>
  )
}
