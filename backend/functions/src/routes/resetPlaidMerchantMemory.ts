import type { Request, Response } from "express"
import { z } from "zod"
import { resetMerchantMemory } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  merchantKey: z.string().min(1),
})

export async function resetPlaidMerchantMemoryHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "resetPlaidMerchantMemory")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      merchantKey: req.query.merchantKey,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing workspaceId or merchantKey", parsedQuery.error.format()),
        "resetPlaidMerchantMemory"
      )
      return
    }
    const { workspaceId, merchantKey } = parsedQuery.data
    await resetMerchantMemory(workspaceId, uid, merchantKey)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "resetPlaidMerchantMemory")
  }
}
