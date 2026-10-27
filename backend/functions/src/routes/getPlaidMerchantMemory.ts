import type { Request, Response } from "express"
import { z } from "zod"
import { listIncomeMemory, listMerchantMemory } from "../services/plaidService"
import { listPayerMemory } from "../services/payerMemoryService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getPlaidMerchantMemoryHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getPlaidMerchantMemory")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId", parsedQuery.error.format()), "getPlaidMerchantMemory")
      return
    }
    // payers = income memory (PlaidIncomeMemorySchema), appPayers = people
    // who pay through app statements (PayerMemorySchema), returned alongside
    // so Learned Merchants loads everything in one request.
    const [merchants, payers, appPayers] = await Promise.all([
      listMerchantMemory(parsedQuery.data.workspaceId, uid),
      listIncomeMemory(parsedQuery.data.workspaceId, uid),
      listPayerMemory(parsedQuery.data.workspaceId, uid),
    ])
    res.status(200).json({ ok: true, merchants, payers, appPayers })
  } catch (err: any) {
    sendHttpError(res, err, "getPlaidMerchantMemory")
  }
}
