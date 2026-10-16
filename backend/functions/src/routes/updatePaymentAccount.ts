import type { Request, Response } from "express"
import { z } from "zod"
import * as paymentAccountsSvc from "../services/paymentAccountsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function updatePaymentAccountHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updatePaymentAccount")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "updatePaymentAccount")
      return
    }
    const { workspaceId } = parsedQuery.data
    const result = await paymentAccountsSvc.updatePaymentAccount(workspaceId, uid, req.body)
    res.status(200).json({ ok: true, paymentAccount: result.paymentAccount, url: result.url ?? null })
  } catch (err: any) {
    sendHttpError(res, err, "updatePaymentAccount")
  }
}
