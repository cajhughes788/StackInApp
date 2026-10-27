import type { Request, Response } from "express"
import { z } from "zod"
import * as bookingSvc from "../services/bookingService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getBookingSettingsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getBookingSettings")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "getBookingSettings")
      return
    }
    const { workspaceId } = parsedQuery.data
    const settings = await bookingSvc.getBookingSettings(workspaceId, uid)
    res.status(200).json({ ok: true, settings })
  } catch (err: any) {
    sendHttpError(res, err, "getBookingSettings")
  }
}
