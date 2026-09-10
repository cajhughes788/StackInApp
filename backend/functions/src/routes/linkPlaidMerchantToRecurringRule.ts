import type { Request, Response } from "express"
import { z } from "zod"
import { markMerchantCoveredByRecurringRule } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const BodySchema = z.object({
  merchantKey: z.string().min(1),
})

export async function linkPlaidMerchantToRecurringRuleHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "linkPlaidMerchantToRecurringRule")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId", parsedQuery.error.format()), "linkPlaidMerchantToRecurringRule")
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Missing merchantKey", parsedBody.error.format()), "linkPlaidMerchantToRecurringRule")
      return
    }
    await markMerchantCoveredByRecurringRule(parsedQuery.data.workspaceId, uid, parsedBody.data.merchantKey)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "linkPlaidMerchantToRecurringRule")
  }
}
