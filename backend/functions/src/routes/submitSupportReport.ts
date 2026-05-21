import type { Request, Response } from "express"
import { FieldValue } from "firebase-admin/firestore"
import { z } from "zod"

import { auth, db } from "../admin"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace"

const SupportContextSchema = z.object({
  route: z.string(),
  workspaceId: z.string().nullable(),
  workspaceType: z.string().nullable(),
  workspaceName: z.string().nullable(),
  deviceType: z.string(),
  platform: z.string(),
  buildId: z.string().nullable(),
  userAgent: z.string(),
  capturedAt: z.string(),
  recentLogs: z.array(
    z.object({
      ts: z.string(),
      level: z.enum(["info", "error"]),
      source: z.string(),
      event: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
  ),
})

const SubmitSupportReportSchema = z.object({
  kind: z.enum(["help", "problem", "question", "feedback"]),
  message: z.string().trim().min(1).max(5000),
  context: SupportContextSchema,
})

export async function submitSupportReportHandler(
  req: Request,
  res: Response
): Promise<void> {
  const trace = createBackendProfileTrace(req, "support_report")
  trace.mark("support_report.handler_invoked")

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    trace.mark("support_report.auth_checked", {
      hasUser: Boolean(uid),
    })

    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "submitSupportReport")
      return
    }

    const parsed = SubmitSupportReportSchema.safeParse(req.body)
    if (!parsed.success) {
      sendHttpError(
        res,
        new BadRequestError("Invalid support report payload", parsed.error.flatten()),
        "submitSupportReport"
      )
      return
    }

    const userRecord = await withBackendProfileStep(
      trace,
      "support_report.user_lookup",
      () => auth.getUser(uid),
      { uid }
    ).catch(() => null)

    const reportRef = db.collection("supportReports").doc()

    await withBackendProfileStep(
      trace,
      "support_report.firestore_write",
      () =>
        reportRef.set({
          id: reportRef.id,
          userId: uid,
          userEmail: userRecord?.email ?? null,
          kind: parsed.data.kind,
          message: parsed.data.message,
          context: parsed.data.context,
          status: "new",
          source: "in_app",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      {
        uid,
        kind: parsed.data.kind,
        reportId: reportRef.id,
      }
    )

    res.status(200).json({ ok: true, reportId: reportRef.id })
    trace.mark("support_report.response_sent", {
      uid,
      kind: parsed.data.kind,
      reportId: reportRef.id,
    })
  } catch (err) {
    trace.error("support_report.failed", err)
    sendHttpError(res, err, "submitSupportReport")
  }
}
