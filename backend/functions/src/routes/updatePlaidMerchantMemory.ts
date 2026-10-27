import type { Request, Response } from "express"
import { z } from "zod"
import { updateIncomeMemory, updateMerchantMemory } from "../services/plaidService"
import { updatePayerMemory } from "../services/payerMemoryService"
import { IncomeCategorySchema } from "@shared/schemas/entry"
import { PayerMemoryModeSchema } from "@shared/schemas/payerMemory"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  merchantKey: z.string().min(1),
  // "income" manages a payer in plaidIncomeMemory instead (merchantKey is
  // then the payer key) — see PlaidIncomeMemorySchema. "app_payer" manages
  // a person in payerMemory (app statement imports) — see PayerMemorySchema.
  kind: z.enum(["expense", "income", "app_payer"]).default("expense"),
})

const AppPayerBodySchema = z.object({
  mode: PayerMemoryModeSchema.optional(),
  incomeCategory: IncomeCategorySchema.nullable().optional(),
})

const IncomeBodySchema = z.object({
  mode: z.enum(["ask_every_time", "always_not_income"]).optional(),
  incomeCategory: IncomeCategorySchema.nullable().optional(),
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
      kind: req.query.kind,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing workspaceId or merchantKey", parsedQuery.error.format()),
        "updatePlaidMerchantMemory"
      )
      return
    }
    const { workspaceId, merchantKey, kind } = parsedQuery.data
    if (kind === "app_payer") {
      const parsedAppPayerBody = AppPayerBodySchema.safeParse(req.body)
      if (!parsedAppPayerBody.success) {
        sendHttpError(res, new BadRequestError("Invalid payload", parsedAppPayerBody.error.format()), "updatePlaidMerchantMemory")
        return
      }
      const payer = await updatePayerMemory(workspaceId, uid, merchantKey, parsedAppPayerBody.data)
      res.status(200).json({ ok: true, payer })
      return
    }
    if (kind === "income") {
      const parsedIncomeBody = IncomeBodySchema.safeParse(req.body)
      if (!parsedIncomeBody.success) {
        sendHttpError(res, new BadRequestError("Invalid payload", parsedIncomeBody.error.format()), "updatePlaidMerchantMemory")
        return
      }
      const payer = await updateIncomeMemory(workspaceId, uid, merchantKey, parsedIncomeBody.data)
      res.status(200).json({ ok: true, payer })
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid payload", parsedBody.error.format()), "updatePlaidMerchantMemory")
      return
    }
    const merchant = await updateMerchantMemory(workspaceId, uid, merchantKey, parsedBody.data)
    res.status(200).json({ ok: true, merchant })
  } catch (err: any) {
    sendHttpError(res, err, "updatePlaidMerchantMemory")
  }
}
