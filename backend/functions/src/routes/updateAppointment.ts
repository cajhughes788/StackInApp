import type { Request, Response } from "express"
import { z } from "zod"
import * as appointmentsSvc from "../services/appointmentsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  appointmentId: z.string().min(1).max(160),
})

export async function updateAppointmentHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateAppointment")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      appointmentId: req.query.appointmentId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid query", parsedQuery.error.format()), "updateAppointment")
      return
    }
    const { workspaceId, appointmentId } = parsedQuery.data
    const result = await appointmentsSvc.updateAppointment(workspaceId, uid, appointmentId, req.body)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "updateAppointment")
  }
}
