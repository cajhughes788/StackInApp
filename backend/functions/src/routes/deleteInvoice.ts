import type { Request, Response } from "express"
import { z } from "zod"
import * as invoicesSvc from "../services/invoicesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  invoiceId: z.string().min(1),
})

export async function deleteInvoiceHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "deleteInvoice")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      invoiceId: req.query.invoiceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/invoiceId", parsedQuery.error.format()), "deleteInvoice")
      return
    }
    const { workspaceId, invoiceId } = parsedQuery.data
    const result = await invoicesSvc.deleteInvoice(workspaceId, uid, invoiceId)
    res.status(200).json({ ok: true, invoiceId, deleted: result.deleted })
  } catch (err: any) {
    sendHttpError(res, err, "deleteInvoice")
  }
}
