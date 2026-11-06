import type { Request, Response } from "express"
import { z } from "zod"
import * as quotesSvc from "../services/quotesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

// One function for a quote's content: POST creates, PATCH edits (?quoteId),
// DELETE removes a draft (?quoteId).
const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  quoteId: z.string().min(1).optional(),
})

export async function saveQuoteHandler(req: Request, res: Response): Promise<void> {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "saveQuote")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      quoteId: typeof req.query.quoteId === "string" ? req.query.quoteId : undefined,
    })
    if (!parsedQuery.success || (req.method !== "POST" && !parsedQuery.data.quoteId)) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/quoteId"), "saveQuote")
      return
    }
    const { workspaceId, quoteId } = parsedQuery.data
    if (req.method === "POST") {
      const quote = await quotesSvc.createQuote(workspaceId, uid, req.body)
      res.status(201).json({ ok: true, id: quote.id, quote })
    } else if (req.method === "PATCH") {
      const quote = await quotesSvc.updateQuote(workspaceId, uid, quoteId!, req.body)
      res.status(200).json({ ok: true, quote })
    } else {
      const result = await quotesSvc.deleteQuote(workspaceId, uid, quoteId!)
      res.status(200).json({ ok: true, ...result })
    }
  } catch (err: any) {
    sendHttpError(res, err, "saveQuote")
  }
}
