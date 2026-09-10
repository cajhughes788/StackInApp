import type { Request, Response } from "express"
import { z } from "zod"
import { updateLinkedAccountDefault } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
  accountId: z.string().min(1),
})

const BodySchema = z.object({
  defaultBusiness: z.boolean().nullable(),
})

export async function updatePlaidAccountDefaultHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updatePlaidAccountDefault")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      itemId: req.query.itemId,
      accountId: req.query.accountId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing workspaceId, itemId, or accountId", parsedQuery.error.format()),
        "updatePlaidAccountDefault"
      )
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid payload", parsedBody.error.format()), "updatePlaidAccountDefault")
      return
    }
    const { workspaceId, itemId, accountId } = parsedQuery.data
    await updateLinkedAccountDefault(workspaceId, uid, itemId, accountId, parsedBody.data.defaultBusiness)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "updatePlaidAccountDefault")
  }
}
