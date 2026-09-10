import type { Request, Response } from "express"
import { z } from "zod"
import { getItems } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getPlaidItemsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getPlaidItems")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId", parsedQuery.error.format()), "getPlaidItems")
      return
    }
    const items = await getItems(parsedQuery.data.workspaceId, uid)
    res.status(200).json({ ok: true, items })
  } catch (err: any) {
    sendHttpError(res, err, "getPlaidItems")
  }
}
