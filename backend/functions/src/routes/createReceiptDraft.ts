import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptDraftsSvc from "../services/receiptDraftsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function createReceiptDraftHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_draft")
  trace.mark("receipt.draft_create.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createReceiptDraft")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "createReceiptDraft"
      )
      return
    }

    const draft = await withBackendProfileStep(
      trace,
      "receipt.draft.create",
      () =>
        receiptDraftsSvc.createReceiptDraft(
          parsedQuery.data.workspaceId,
          uid,
          req.body
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
        receiptAssetId:
          typeof req.body?.receiptAssetId === "string" ? req.body.receiptAssetId : undefined,
        analysisStatus:
          typeof req.body?.analysisStatus === "string" ? req.body.analysisStatus : undefined,
      }
    )

    trace.mark("receipt.draft_create.response_sent", {
      receiptDraftId: draft.id,
      receiptAssetId: draft.receiptAssetId,
      status: draft.status,
      analysisStatus: draft.analysisStatus ?? null,
      lineItemCount: draft.lineItems?.length ?? 0,
    })

    res.status(200).json({ ok: true, draft })
  } catch (err: any) {
    trace.error("receipt.draft_create.failed", err)
    sendHttpError(res, err, "createReceiptDraft")
  }
}
