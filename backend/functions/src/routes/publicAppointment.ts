import type { Request, Response } from "express"
import { findSharedAppointment, respondToAppointment } from "../services/appointmentsService"
import { renderPublicAppointmentNotFound, renderPublicAppointmentPage } from "@shared/appointmentPublicPage"
import { AppointmentResponseSchema } from "@shared/schemas/appointment"

// Public, unauthenticated: the page behind an appointment link. Hosting
// rewrites /b/** here, so the token is the last path segment (?t= also
// works when the function is hit directly).
//
// /b/{token}/respond takes the client's answer (a POST from the page's
// Confirm / Can't make it buttons), then 303s back to the page. A GET of
// it (a mail scanner following links) changes nothing.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
}

function parsePath(req: Request): { token: string; respond: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const respond = segments[segments.length - 1] === "respond"
  const fromQuery = typeof req.query.t === "string" ? req.query.t : ""
  const token = fromQuery || (respond ? segments[segments.length - 2] : segments[segments.length - 1]) || ""
  return { token, respond }
}

export async function publicAppointmentHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { token, respond } = parsePath(req)
  const allowed = respond ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
  if (!allowed.includes(req.method)) {
    res.status(405).send("Method not allowed")
    return
  }
  const pagePath = `/b/${encodeURIComponent(token)}`
  try {
    if (respond) {
      if (req.method !== "POST") {
        res.redirect(303, pagePath)
        return
      }
      const answer = AppointmentResponseSchema.safeParse((req.body ?? {}).answer)
      if (!answer.success) {
        res.redirect(303, pagePath)
        return
      }
      const result = await respondToAppointment(token, answer.data)
      if (result === "not_found") {
        res.status(404).send(renderPublicAppointmentNotFound())
        return
      }
      res.redirect(303, `${pagePath}?answered=1`)
      return
    }
    const shared = await findSharedAppointment(token)
    if (!shared) {
      res.status(404).send(renderPublicAppointmentNotFound())
      return
    }
    res.status(200).send(
      renderPublicAppointmentPage(shared.appointment, shared.settings, {
        respondPath: `${pagePath}/respond`,
        justAnswered: req.query.answered === "1",
      })
    )
  } catch (error) {
    console.error("publicAppointment: failed", error)
    res.status(500).send(renderPublicAppointmentNotFound())
  }
}
