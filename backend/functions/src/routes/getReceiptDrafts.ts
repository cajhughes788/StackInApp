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

export async function getReceiptDraftsHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_drafts_read")

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getReceiptDrafts")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "getReceiptDrafts"
      )
      return
    }

    const drafts = await withBackendProfileStep(
      trace,
      "receipt.drafts.list",
      () => receiptDraftsSvc.listReceiptDrafts(parsedQuery.data.workspaceId, uid),
      {
        workspaceId: parsedQuery.data.workspaceId,
      }
    )
    trace.mark("receipt.drafts.response_sent", {
      workspaceId: parsedQuery.data.workspaceId,
      draftCount: drafts.length,
    })
    res.status(200).json({ ok: true, drafts })
  } catch (err: any) {
    trace.error("receipt.drafts.failed", err)
    sendHttpError(res, err, "getReceiptDrafts")
  }
}
