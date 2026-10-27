import type { Request, Response } from "express"
import { z } from "zod"
import * as bookingSvc from "../services/bookingService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function saveBookingSettingsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "saveBookingSettings")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "saveBookingSettings")
      return
    }
    const { workspaceId } = parsedQuery.data
    const settings = await bookingSvc.saveBookingSettings(workspaceId, uid, req.body)
    res.status(200).json({ ok: true, settings })
  } catch (err: any) {
    sendHttpError(res, err, "saveBookingSettings")
  }
}
