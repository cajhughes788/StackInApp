import type { Request, Response } from "express"
import { z } from "zod"
import { confirmPendingTransaction } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  pendingId: z.string().min(1),
})

const BodySchema = z.object({
  isBusiness: z.boolean(),
  account: z.string().optional(),
  alwaysPersonal: z.boolean().optional(),
  receiptAssetId: z.string().optional(),
})

export async function confirmPlaidPendingTransactionHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "confirmPlaidPendingTransaction")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      pendingId: req.query.pendingId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId or pendingId", parsedQuery.error.format()), "confirmPlaidPendingTransaction")
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid confirmation payload", parsedBody.error.format()), "confirmPlaidPendingTransaction")
      return
    }
    const { workspaceId, pendingId } = parsedQuery.data
    const result = await confirmPendingTransaction(workspaceId, uid, pendingId, parsedBody.data)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "confirmPlaidPendingTransaction")
  }
}
