import { auth, db } from "../admin"

function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error) }
  }

  const err = error as Error & {
    code?: string
    details?: unknown
    metadata?: unknown
  }

  return {
    name: err.name,
    message: err.message,
    code: err.code,
    details: err.details,
    metadata: err.metadata,
    stack: err.stack,
  }
}

async function runLoggedStep<T>(
  step: string,
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  console.log("[purgeUserData] start", { step, ...context })

  try {
    const result = await fn()
    console.log("[purgeUserData] success", { step, ...context })
    return result
  } catch (error) {
    console.error("[purgeUserData] failed", {
      step,
      ...context,
      error: serializeError(error),
    })
    throw error
  }
}

async function deleteUserAuthRecord(uid: string): Promise<void> {
  try {
    await auth.deleteUser(uid)
  } catch (error: any) {
    if (error?.code !== "auth/user-not-found") {
      throw error
    }
  }
}

async function deleteSupportReports(uid: string): Promise<void> {
  while (true) {
    const supportReportsSnap = await db
      .collection("supportReports")
      .where("userId", "==", uid)
      .limit(500)
      .get()

    if (supportReportsSnap.empty) {
      return
    }

    const batch = db.batch()
    for (const supportReportDoc of supportReportsSnap.docs) {
      batch.delete(supportReportDoc.ref)
    }
    await batch.commit()
  }
}

export async function purgeUserData(uid: string): Promise<void> {
  const userRef = db.collection("users").doc(uid)
  const membershipsRef = userRef.collection("memberships")
  const membershipsSnap = await runLoggedStep(
    "load_user_memberships",
    { uid, membershipsPath: membershipsRef.path },
    () => membershipsRef.get()
  )

  console.log("[purgeUserData] memberships_loaded", {
    uid,
    membershipCount: membershipsSnap.size,
    membershipDocIds: membershipsSnap.docs.map((doc) => doc.id),
  })

  for (const membershipDoc of membershipsSnap.docs) {
    const workspaceId =
      typeof membershipDoc.data().workspaceId === "string"
        ? membershipDoc.data().workspaceId
        : membershipDoc.id

    const workspaceRef = db.collection("workspaces").doc(workspaceId)
    const workspaceSnap = await runLoggedStep(
      "load_workspace",
      {
        uid,
        membershipDocPath: membershipDoc.ref.path,
        workspaceId,
        workspacePath: workspaceRef.path,
      },
      () => workspaceRef.get()
    )

    console.log("[purgeUserData] workspace_loaded", {
      uid,
      membershipDocPath: membershipDoc.ref.path,
      workspaceId,
      workspaceExists: workspaceSnap.exists,
      workspaceOwnerId: workspaceSnap.data()?.ownerId ?? null,
    })

    if (workspaceSnap.exists && workspaceSnap.data()?.ownerId === uid) {
      await runLoggedStep(
        "recursive_delete_workspace",
        { uid, workspaceId, workspacePath: workspaceRef.path },
        () => db.recursiveDelete(workspaceRef)
      )
      continue
    }

    await runLoggedStep(
      "delete_membership",
      {
        uid,
        membershipDocPath: membershipDoc.ref.path,
        workspaceId,
      },
      () => membershipDoc.ref.delete()
    )
  }

  await runLoggedStep("delete_support_reports", { uid }, () =>
    deleteSupportReports(uid)
  )

  // Recursively delete the user's document tree so legacy or newly added
  // subcollections cannot block account removal.
  await runLoggedStep("recursive_delete_user", { uid, userPath: userRef.path }, () =>
    db.recursiveDelete(userRef)
  )
  await runLoggedStep("delete_auth_user", { uid }, () => deleteUserAuthRecord(uid))

  await runLoggedStep("write_deletion_audit", { uid }, () =>
    db.collection("deletions").add({
      uid,
      type: "user_data_purge",
      deletedAt: new Date().toISOString(),
      origin: "api",
    })
  )
}
