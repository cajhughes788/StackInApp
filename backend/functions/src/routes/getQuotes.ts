import type { Request, Response } from "express"
import { z } from "zod"
import * as quotesSvc from "../services/quotesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getQuotesHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getQuotes")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "getQuotes")
      return
    }
    const quotes = await quotesSvc.listQuotes(parsedQuery.data.workspaceId, uid)
    res.status(200).json({ ok: true, quotes })
  } catch (err: any) {
    sendHttpError(res, err, "getQuotes")
  }
}
