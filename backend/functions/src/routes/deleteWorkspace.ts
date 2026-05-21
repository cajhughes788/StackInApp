import type { Request, Response } from "express"
import { z } from "zod"

import {
  purgeWorkspace,
  WorkspaceDeleteStepError,
} from "../services/workspaceDeletionService"
import { createBackendProfileTrace } from "../lib/profileTrace"

const QuerySchema = z.object({
  workspaceId: z.string().trim().min(1),
})

const BodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

export async function deleteWorkspaceHandler(
  req: Request,
  res: Response
): Promise<void> {
  const trace = createBackendProfileTrace(req, "workspace.delete")
  trace.mark("workspace.delete_handler_invoked")

  if (req.method !== "DELETE") {
    trace.mark("workspace.delete_method_not_allowed", {
      method: req.method,
    })
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      trace.mark("workspace.delete_unauthorized")
      res.status(401).json({ ok: false, error: "Unauthorized" })
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      trace.mark("workspace.delete_invalid_query", {
        queryWorkspaceId:
          typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined,
      })
      res.status(400).json({ ok: false, error: "Missing workspaceId" })
      return
    }

    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      trace.mark("workspace.delete_invalid_body")
      res.status(400).json({ ok: false, error: "Please tell us why you're deleting this workspace." })
      return
    }

    const { workspaceId } = parsedQuery.data
    const { reason } = parsedBody.data

    trace.mark("workspace.delete_validated", {
      uid,
      workspaceId,
      reasonLength: reason.length,
    })

    await purgeWorkspace(uid, workspaceId, reason)

    trace.mark("workspace.delete_completed", {
      uid,
      workspaceId,
    })

    res.status(200).json({
      ok: true,
      deletedWorkspaceId: workspaceId,
    })
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Internal server error"
    const failedStep =
      error instanceof WorkspaceDeleteStepError ? error.step : "handler"
    const rootError =
      error instanceof WorkspaceDeleteStepError ? error.causeValue : error
    const code =
      typeof rootError?.code === "string" || typeof rootError?.code === "number"
        ? String(rootError.code)
        : null
    const details =
      typeof rootError?.details === "string" ? rootError.details : null
    trace.error("workspace.delete_failed", error, {
      failedStep,
      errorCode:
        code ?? undefined,
      errorStatus:
        typeof rootError?.status === "string" || typeof rootError?.status === "number"
          ? String(rootError.status)
          : undefined,
      errorDetails: details ?? undefined,
    })

    if (message === "Forbidden") {
      res.status(403).json({
        ok: false,
        error: message,
        traceId: trace.traceId,
        failedStep,
        code,
        details,
      })
      return
    }

    if (message === "Workspace not found") {
      res.status(404).json({
        ok: false,
        error: message,
        traceId: trace.traceId,
        failedStep,
        code,
        details,
      })
      return
    }

    if (message === "Only the workspace owner can delete this workspace") {
      res.status(403).json({
        ok: false,
        error: message,
        traceId: trace.traceId,
        failedStep,
        code,
        details,
      })
      return
    }

    res.status(500).json({
      ok: false,
      error: message,
      traceId: trace.traceId,
      failedStep,
      code,
      details,
    })
  }
}
