import { db, storage } from "../admin"

export class WorkspaceDeleteStepError extends Error {
  readonly step: string
  readonly causeValue?: unknown

  constructor(step: string, message: string, causeValue?: unknown) {
    super(message)
    this.name = "WorkspaceDeleteStepError"
    this.step = step
    this.causeValue = causeValue
  }
}

function logWorkspaceDeleteInfo(
  event: string,
  payload: Record<string, unknown>
): void {
  console.info("[workspace-delete]", JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...payload,
  }))
}

function logWorkspaceDeleteError(
  event: string,
  error: unknown,
  payload: Record<string, unknown>
): void {
  console.error("[workspace-delete]", JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...payload,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode:
      typeof (error as any)?.code === "string" || typeof (error as any)?.code === "number"
        ? String((error as any).code)
        : undefined,
    errorStatus:
      typeof (error as any)?.status === "string" || typeof (error as any)?.status === "number"
        ? String((error as any).status)
        : undefined,
    errorDetails:
      typeof (error as any)?.details === "string"
        ? (error as any).details
        : undefined,
    errorStack: error instanceof Error ? error.stack : undefined,
  }))
}

async function deleteWorkspaceStorage(workspaceId: string): Promise<void> {
  const prefix = `workspaces/${workspaceId}/`
  logWorkspaceDeleteInfo("storage_delete_start", {
    workspaceId,
    prefix,
  })

  try {
    await storage.bucket().deleteFiles({ prefix })
    logWorkspaceDeleteInfo("storage_delete_complete", {
      workspaceId,
      prefix,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    const isMissingBucketConfig =
      message.includes("bucket name not specified") ||
      message.includes("invalid bucket name") ||
      message.includes("storagebucket")
    const isMissingBucket =
      message.includes("specified bucket does not exist") ||
      message.includes("bucket does not exist") ||
      message.includes("no such bucket")

    if (!isMissingBucketConfig && !isMissingBucket) {
      logWorkspaceDeleteError("storage_delete_failed", error, {
        workspaceId,
        prefix,
      })
      throw error
    }

    console.warn("workspace storage cleanup skipped", {
      workspaceId,
      reason: error instanceof Error ? error.message : String(error),
    })
    logWorkspaceDeleteInfo("storage_delete_skipped", {
      workspaceId,
      prefix,
      reason: error instanceof Error ? error.message : String(error),
      missingBucketConfig: isMissingBucketConfig,
      missingBucket: isMissingBucket,
    })
  }
}

export async function purgeWorkspace(
  uid: string,
  workspaceId: string,
  reason: string
): Promise<void> {
  logWorkspaceDeleteInfo("purge_start", {
    uid,
    workspaceId,
    reasonLength: reason.length,
  })
  const membershipRef = db.doc(`users/${uid}/memberships/${workspaceId}`)
  const workspaceRef = db.doc(`workspaces/${workspaceId}`)

  let membershipSnap
  let workspaceSnap

  try {
    ;[membershipSnap, workspaceSnap] = await Promise.all([
      membershipRef.get(),
      workspaceRef.get(),
    ])
    logWorkspaceDeleteInfo("membership_and_workspace_loaded", {
      uid,
      workspaceId,
      membershipExists: membershipSnap.exists,
      workspaceExists: workspaceSnap.exists,
    })
  } catch (error) {
    logWorkspaceDeleteError("membership_and_workspace_load_failed", error, {
      uid,
      workspaceId,
    })
    throw new WorkspaceDeleteStepError(
      "membership_and_workspace_load",
      error instanceof Error ? error.message : String(error),
      error
    )
  }

  if (!membershipSnap.exists) {
    logWorkspaceDeleteInfo("membership_missing", {
      uid,
      workspaceId,
    })
    throw new Error("Forbidden")
  }

  if (!workspaceSnap.exists) {
    logWorkspaceDeleteInfo("workspace_missing", {
      uid,
      workspaceId,
    })
    throw new Error("Workspace not found")
  }

  const membership = membershipSnap.data() as { role?: string } | undefined
  const workspace = workspaceSnap.data() as { ownerId?: string } | undefined

  if (membership?.role !== "owner" || workspace?.ownerId !== uid) {
    logWorkspaceDeleteInfo("ownership_check_failed", {
      uid,
      workspaceId,
      membershipRole: membership?.role,
      workspaceOwnerId: workspace?.ownerId,
    })
    throw new Error("Only the workspace owner can delete this workspace")
  }

  try {
    logWorkspaceDeleteInfo("recursive_delete_start", {
      uid,
      workspaceId,
    })
    await db.recursiveDelete(workspaceRef)
    logWorkspaceDeleteInfo("recursive_delete_complete", {
      uid,
      workspaceId,
    })
  } catch (error) {
    logWorkspaceDeleteError("recursive_delete_failed", error, {
      uid,
      workspaceId,
    })
    throw new WorkspaceDeleteStepError(
      "recursive_delete",
      error instanceof Error ? error.message : String(error),
      error
    )
  }

  try {
    await deleteWorkspaceStorage(workspaceId)
  } catch (error) {
    logWorkspaceDeleteError("storage_cleanup_failed", error, {
      uid,
      workspaceId,
    })
    throw new WorkspaceDeleteStepError(
      "storage_cleanup",
      error instanceof Error ? error.message : String(error),
      error
    )
  }

  try {
    await membershipRef.delete()
    logWorkspaceDeleteInfo("owner_membership_deleted", {
      uid,
      workspaceId,
      membershipPath: membershipRef.path,
    })
  } catch (error) {
    logWorkspaceDeleteError("owner_membership_delete_failed", error, {
      uid,
      workspaceId,
      membershipPath: membershipRef.path,
    })
    throw new WorkspaceDeleteStepError(
      "owner_membership_delete",
      error instanceof Error ? error.message : String(error),
      error
    )
  }

  try {
    await db.collection("deletions").add({
      uid,
      workspaceId,
      reason,
      type: "workspace_purge",
      deletedAt: new Date().toISOString(),
      origin: "api",
    })
    logWorkspaceDeleteInfo("audit_log_written", {
      uid,
      workspaceId,
    })
  } catch (error) {
    logWorkspaceDeleteError("audit_log_write_failed", error, {
      uid,
      workspaceId,
    })
    throw new WorkspaceDeleteStepError(
      "audit_log_write",
      error instanceof Error ? error.message : String(error),
      error
    )
  }

  logWorkspaceDeleteInfo("purge_complete", {
    uid,
    workspaceId,
  })
}
