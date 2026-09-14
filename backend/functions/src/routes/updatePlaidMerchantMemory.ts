import type { Request, Response } from "express"
import { z } from "zod"
import { updateMerchantMemory } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  merchantKey: z.string().min(1),
})

const BodySchema = z.object({
  mode: z.enum(["ask_every_time", "always_personal"]).optional(),
  expenseCategory: z.string().nullable().optional(),
})

export async function updatePlaidMerchantMemoryHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updatePlaidMerchantMemory")
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
        "updatePlaidMerchantMemory"
      )
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid payload", parsedBody.error.format()), "updatePlaidMerchantMemory")
      return
    }
    const { workspaceId, merchantKey } = parsedQuery.data
    const merchant = await updateMerchantMemory(workspaceId, uid, merchantKey, parsedBody.data)
    res.status(200).json({ ok: true, merchant })
  } catch (err: any) {
    sendHttpError(res, err, "updatePlaidMerchantMemory")
  }
}
