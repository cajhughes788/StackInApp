import type { Request, Response } from "express"
import { z } from "zod"

import { commitReceiptDraftWithExpense } from "../services/receiptDraftsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  receiptDraftId: z.string().min(1),
})

export async function commitReceiptDraftHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "commitReceiptDraft")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      receiptDraftId: req.query.receiptDraftId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid query params", parsedQuery.error.format()),
        "commitReceiptDraft"
      )
      return
    }

    const { workspaceId, receiptDraftId } = parsedQuery.data
    const { expense, draft } = await commitReceiptDraftWithExpense(
      workspaceId,
      uid,
      receiptDraftId,
      req.body
    )

    res.status(201).json({ ok: true, expense, draft, id: expense.id })
  } catch (err: any) {
    sendHttpError(res, err, "commitReceiptDraft")
  }
}
