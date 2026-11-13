import type { Request, Response } from "express"
import { z } from "zod"
import * as schedulesSvc from "../services/invoiceSchedulesService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

// POST starts a repeating invoice from an invoice; PATCH (?scheduleId)
// edits, pauses, resumes or stops one.
const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  scheduleId: z.string().min(1).optional(),
})

export async function saveInvoiceScheduleHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "saveInvoiceSchedule")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      scheduleId: typeof req.query.scheduleId === "string" ? req.query.scheduleId : undefined,
    })
    if (!parsedQuery.success || (req.method === "PATCH" && !parsedQuery.data.scheduleId)) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/scheduleId"), "saveInvoiceSchedule")
      return
    }
    const { workspaceId, scheduleId } = parsedQuery.data
    const schedule =
      req.method === "POST"
        ? await schedulesSvc.createInvoiceSchedule(workspaceId, uid, req.body)
        : await schedulesSvc.updateInvoiceSchedule(workspaceId, uid, scheduleId!, req.body)
    res.status(req.method === "POST" ? 201 : 200).json({ ok: true, schedule })
  } catch (err: any) {
    sendHttpError(res, err, "saveInvoiceSchedule")
  }
}
