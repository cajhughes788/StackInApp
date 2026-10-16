import type { Request, Response } from "express"
import { z } from "zod"
import * as invoicesSvc from "../services/invoicesService"
import * as paymentAccountsSvc from "../services/paymentAccountsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getInvoicesHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getInvoices")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "getInvoices")
      return
    }
    const { workspaceId } = parsedQuery.data
    const [invoices, settings, paymentAccount] = await Promise.all([
      invoicesSvc.listInvoices(workspaceId, uid),
      invoicesSvc.getInvoiceSettings(workspaceId, uid),
      paymentAccountsSvc.getPaymentAccount(workspaceId, uid),
    ])
    res.status(200).json({ ok: true, invoices, settings, paymentAccount })
  } catch (err: any) {
    sendHttpError(res, err, "getInvoices")
  }
}
