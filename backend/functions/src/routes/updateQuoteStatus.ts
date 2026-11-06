import type { Request, Response } from "express"
import { z } from "zod"
import * as quotesSvc from "../services/quotesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  quoteId: z.string().min(1),
})

export async function updateQuoteStatusHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateQuoteStatus")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId, quoteId: req.query.quoteId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/quoteId", parsedQuery.error.format()), "updateQuoteStatus")
      return
    }
    const { workspaceId, quoteId } = parsedQuery.data
    const result = await quotesSvc.updateQuoteStatus(workspaceId, uid, quoteId, req.body)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "updateQuoteStatus")
  }
}
