import type { Request, Response } from "express"
import { z } from "zod"
import * as appointmentsSvc from "../services/appointmentsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function createAppointmentHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createAppointment")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid query", parsedQuery.error.format()), "createAppointment")
      return
    }
    const { workspaceId } = parsedQuery.data
    const result = await appointmentsSvc.createAppointment(workspaceId, uid, req.body)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "createAppointment")
  }
}
