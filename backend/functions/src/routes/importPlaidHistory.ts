import type { Request, Response } from "express"
import { z } from "zod"
import { importPlaidHistory } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
})

const BodySchema = z.object({
  months: z.number().int().min(1).max(24).optional(),
})

export async function importPlaidHistoryHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "importPlaidHistory")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      itemId: req.query.itemId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId or itemId", parsedQuery.error.format()), "importPlaidHistory")
      return
    }
    const parsedBody = BodySchema.safeParse(req.body ?? {})
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid request body", parsedBody.error.format()), "importPlaidHistory")
      return
    }
    const result = await importPlaidHistory(
      parsedQuery.data.workspaceId,
      uid,
      parsedQuery.data.itemId,
      parsedBody.data.months
    )
    res.status(200).json({ ok: true, added: result.added })
  } catch (err: any) {
    sendHttpError(res, err, "importPlaidHistory")
  }
}
