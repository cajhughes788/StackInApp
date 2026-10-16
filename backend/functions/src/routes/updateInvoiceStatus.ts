import type { Request, Response } from "express"
import { z } from "zod"
import * as invoicesSvc from "../services/invoicesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  invoiceId: z.string().min(1),
})

export async function updateInvoiceStatusHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateInvoiceStatus")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      invoiceId: req.query.invoiceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/invoiceId", parsedQuery.error.format()), "updateInvoiceStatus")
      return
    }
    const { workspaceId, invoiceId } = parsedQuery.data
    const result = await invoicesSvc.updateInvoiceStatus(workspaceId, uid, invoiceId, req.body)
    res.status(200).json({ ok: true, invoice: result.invoice, entryId: result.entryId ?? null, shareUrl: result.shareUrl ?? null })
  } catch (err: any) {
    sendHttpError(res, err, "updateInvoiceStatus")
  }
}
