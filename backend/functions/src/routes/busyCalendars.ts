import type { Request, Response } from "express"
import { z } from "zod"
import { addBusyCalendar, listBusyCalendars, removeBusyCalendar } from "../services/busyCalendarsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})
const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: z.string(), url: z.string() }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(64) }),
])

// Signed in: the owner's busy calendars (Booking setup → Calendar sync).
// GET lists them; POST { action: "add", name, url } or { action: "remove", id }.
export async function busyCalendarsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "busyCalendars")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId"), "busyCalendars")
      return
    }
    const { workspaceId } = parsedQuery.data
    if (req.method === "GET") {
      res.status(200).json({ ok: true, ...(await listBusyCalendars(workspaceId, uid)) })
      return
    }
    const parsedBody = BodySchema.safeParse(req.body ?? {})
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid request"), "busyCalendars")
      return
    }
    const body = parsedBody.data
    const result =
      body.action === "add"
        ? await addBusyCalendar(workspaceId, uid, { name: body.name, url: body.url })
        : await removeBusyCalendar(workspaceId, uid, body.id)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "busyCalendars")
  }
}
