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
  receiptDraftId: z.string().min(1),
})

export async function updateReceiptDraftHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_draft")
  trace.mark("receipt.draft_update.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateReceiptDraft")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      receiptDraftId: req.query.receiptDraftId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError(
          "Missing or invalid receipt draft query",
          parsedQuery.error.format()
        ),
        "updateReceiptDraft"
      )
      return
    }

    const draft = await withBackendProfileStep(
      trace,
      "receipt.draft.update",
      () =>
        receiptDraftsSvc.updateReceiptDraft(
          parsedQuery.data.workspaceId,
          uid,
          parsedQuery.data.receiptDraftId,
          req.body
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
        receiptDraftId: parsedQuery.data.receiptDraftId,
        patchKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
      }
    )

    trace.mark("receipt.draft_update.response_sent", {
      receiptDraftId: draft.id,
      status: draft.status,
      analysisStatus: draft.analysisStatus ?? null,
      committedExpenseId: draft.committedExpenseId ?? null,
      lineItemCount: draft.lineItems?.length ?? 0,
    })

    res.status(200).json({ ok: true, draft })
  } catch (err: any) {
    trace.error("receipt.draft_update.failed", err)
    sendHttpError(res, err, "updateReceiptDraft")
  }
}
