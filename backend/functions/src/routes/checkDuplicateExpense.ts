import type { Request, Response } from "express"
import { z } from "zod"

import { findDuplicateExpenses } from "../services/expensesService"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const BodySchema = z.object({
  date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  amount: z.number().positive(),
  merchant: z.string().default(""),
})

export async function checkDuplicateExpenseHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "checkDuplicateExpense")
      return
    }

    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing workspaceId", parsedQuery.error.format()),
        "checkDuplicateExpense"
      )
      return
    }

    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(
        res,
        new BadRequestError("Invalid duplicate check payload", parsedBody.error.format()),
        "checkDuplicateExpense"
      )
      return
    }

    const { workspaceId } = parsedQuery.data
    await assertWorkspaceMembership(workspaceId, uid)

    const { date, amount, merchant } = parsedBody.data
    const { exactMatches, nearDateMatches } = await findDuplicateExpenses(
      workspaceId, date, amount, merchant
    )

    const toSummary = (e: { id: string; date: string; amount: number; vendor: string; account: string }) => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      vendor: e.vendor,
      account: e.account,
    })

    res.status(200).json({
      ok: true,
      possibleDuplicate: exactMatches.length > 0,
      possibleNearDuplicate: nearDateMatches.length > 0,
      matchingExpenses: exactMatches.map(toSummary),
      nearDateExpenses: nearDateMatches.map(toSummary),
    })
  } catch (err: any) {
    sendHttpError(res, err, "checkDuplicateExpense")
  }
}
