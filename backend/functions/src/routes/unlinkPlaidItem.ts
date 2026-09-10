import type { Request, Response } from "express"
import { z } from "zod"
import { unlinkItem } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
})

export async function unlinkPlaidItemHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "unlinkPlaidItem")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      itemId: req.query.itemId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId or itemId", parsedQuery.error.format()), "unlinkPlaidItem")
      return
    }
    await unlinkItem(parsedQuery.data.workspaceId, uid, parsedQuery.data.itemId)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "unlinkPlaidItem")
  }
}
