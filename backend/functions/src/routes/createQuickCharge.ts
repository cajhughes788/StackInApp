import type { Request, Response } from "express"
import { z } from "zod"
import * as invoicesSvc from "../services/invoicesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function createQuickChargeHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createQuickCharge")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "createQuickCharge")
      return
    }
    const { workspaceId } = parsedQuery.data
    const { invoice, shareUrl } = await invoicesSvc.createQuickCharge(workspaceId, uid, req.body)
    res.status(201).json({ ok: true, invoice, shareUrl })
  } catch (err: any) {
    sendHttpError(res, err, "createQuickCharge")
  }
}
