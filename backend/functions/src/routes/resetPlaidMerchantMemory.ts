import type { Request, Response } from "express"
import { z } from "zod"
import { resetIncomeMemory, resetMerchantMemory } from "../services/plaidService"
import { resetPayerMemory } from "../services/payerMemoryService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  merchantKey: z.string().min(1),
  // "income" forgets a payer in plaidIncomeMemory instead; "app_payer" a
  // person in payerMemory (app statement imports).
  kind: z.enum(["expense", "income", "app_payer"]).default("expense"),
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
      kind: req.query.kind,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing workspaceId or merchantKey", parsedQuery.error.format()),
        "resetPlaidMerchantMemory"
      )
      return
    }
    const { workspaceId, merchantKey, kind } = parsedQuery.data
    if (kind === "app_payer") await resetPayerMemory(workspaceId, uid, merchantKey)
    else if (kind === "income") await resetIncomeMemory(workspaceId, uid, merchantKey)
    else await resetMerchantMemory(workspaceId, uid, merchantKey)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "resetPlaidMerchantMemory")
  }
}
