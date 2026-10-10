import type { Request, Response } from "express"
import { z } from "zod"
import { restoreHiddenTransfer } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  pendingId: z.string().min(1),
})

export async function restorePlaidHiddenTransferHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "restorePlaidHiddenTransfer")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      pendingId: req.query.pendingId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId or pendingId", parsedQuery.error.format()), "restorePlaidHiddenTransfer")
      return
    }
    const { workspaceId, pendingId } = parsedQuery.data
    const result = await restoreHiddenTransfer(workspaceId, uid, pendingId)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "restorePlaidHiddenTransfer")
  }
}
