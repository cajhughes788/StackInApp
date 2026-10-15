import type { Request, Response } from "express"
import { z } from "zod"
import { listHiddenTransfers } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getPlaidHiddenTransfersHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getPlaidHiddenTransfers")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId", parsedQuery.error.format()), "getPlaidHiddenTransfers")
      return
    }
    const transactions = await listHiddenTransfers(parsedQuery.data.workspaceId, uid)
    res.status(200).json({ ok: true, transactions })
  } catch (err: any) {
    sendHttpError(res, err, "getPlaidHiddenTransfers")
  }
}
