import type { Request, Response } from "express"
import { z } from "zod"
import { calendarFeedFile, calendarFeedLink } from "../services/calendarFeedService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})
const BodySchema = z.object({ reset: z.boolean().optional() })

// Signed in: the owner's calendar sync link (made the first time), or a new
// one with { reset: true }.
export async function calendarFeedLinkHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "calendarFeedLink")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    const parsedBody = BodySchema.safeParse(req.body ?? {})
    if (!parsedQuery.success || !parsedBody.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid request"), "calendarFeedLink")
      return
    }
    const link = await calendarFeedLink(parsedQuery.data.workspaceId, uid, parsedBody.data.reset ?? false)
    res.status(200).json({ ok: true, ...link })
  } catch (err: any) {
    sendHttpError(res, err, "calendarFeedLink")
  }
}

// Public: GET /cal/{token}.ics — what calendar apps subscribe to.
export async function calendarFeedHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("X-Robots-Tag", "noindex, nofollow")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-Content-Type-Options", "nosniff")
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method not allowed")
    return
  }
  const last = req.path.split("/").filter(Boolean).pop() ?? ""
  const token = last.replace(/\.ics$/i, "")
  try {
    const file = await calendarFeedFile(token)
    if (!file) {
      res.status(404).type("text/plain").send("This calendar link isn't active. Get a new one in 521: Booking setup → Calendar sync.")
      return
    }
    res.setHeader("Content-Type", "text/calendar; charset=utf-8")
    res.setHeader("Content-Disposition", 'inline; filename="521-bookings.ics"')
    // Private to each subscriber; a few minutes' reuse spares repeat reads.
    res.setHeader("Cache-Control", "private, max-age=300")
    res.status(200).send(file)
  } catch (error) {
    console.error("calendarFeed: failed", error)
    res.status(500).type("text/plain").send("Couldn't load the calendar. It'll try again later.")
  }
}
