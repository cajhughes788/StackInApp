import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptDraftsSvc from "../services/receiptDraftsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

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

    const drafts = await receiptDraftsSvc.listReceiptDrafts(
      parsedQuery.data.workspaceId,
      uid
    )
    res.status(200).json({ ok: true, drafts })
  } catch (err: any) {
    sendHttpError(res, err, "getReceiptDrafts")
  }
}
