import type { Request, Response } from "express"
import { findSharedAppointment, respondToAppointment } from "../services/appointmentsService"
import { startAppointmentCheckout } from "../services/appointmentDepositsService"
import { renderPublicAppointmentNotFound, renderPublicAppointmentPage } from "@shared/appointmentPublicPage"
import { AppointmentClientMoveSchema, AppointmentResponseSchema } from "@shared/schemas/appointment"

// Public, unauthenticated: the page behind an appointment link. Hosting
// rewrites /b/** here, so the token is the last path segment (?t= also
// works when the function is hit directly).
//
// /b/{token}/respond takes the client's answer (a POST from the page's
// Confirm / Can't make it buttons), then 303s back to the page. A GET of
// it (a mail scanner following links) changes nothing.
//
// /b/{token}/pay starts Stripe Checkout for the deposit (a POST from the
// page's Pay button, 303 to Stripe). ?cancel=1 shows what canceling means
// for the deposit before the client confirms it.
//
// ?move=1 (&date, &time) walks the client through picking a new time;
// /b/{token}/move takes it (a POST), then 303s back with ?moved=1, or to
// the times again when it was just taken.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
}

function parsePath(req: Request): { token: string; respond: boolean; pay: boolean; move: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const last = segments[segments.length - 1]
  const respond = last === "respond"
  const pay = last === "pay"
  const move = last === "move"
  const fromQuery = typeof req.query.t === "string" ? req.query.t : ""
  const token = fromQuery || (respond || pay || move ? segments[segments.length - 2] : last) || ""
  return { token, respond, pay, move }
}

function query(req: Request, name: string): string | undefined {
  const value = req.query[name]
  return typeof value === "string" ? value.slice(0, 32) : undefined
}

export async function publicAppointmentHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { token, respond, pay, move } = parsePath(req)
  const allowed = respond || pay || move ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
  if (!allowed.includes(req.method)) {
    res.status(405).send("Method not allowed")
    return
  }
  const pagePath = `/b/${encodeURIComponent(token)}`
  try {
    if (pay) {
      // Only the page's Pay button starts a payment.
      if (req.method !== "POST") {
        res.redirect(303, pagePath)
        return
      }
      const result = await startAppointmentCheckout(token)
      if (result.kind === "not_found") {
        res.status(404).send(renderPublicAppointmentNotFound())
        return
      }
      res.redirect(303, result.kind === "redirect" ? result.url : pagePath)
      return
    }
    if (move) {
      if (req.method !== "POST") {
        res.redirect(303, pagePath)
        return
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      const parsed = AppointmentClientMoveSchema.safeParse({ date: body.date, time: body.time })
      if (!parsed.success) {
        res.redirect(303, `${pagePath}?move=1`)
        return
      }
      const { rescheduleByClient } = await import("../services/appointmentRescheduleService.js")
      const result = await rescheduleByClient(token, { date: parsed.data.date, startTime: parsed.data.time })
      if (result === "not_found") {
        res.status(404).send(renderPublicAppointmentNotFound())
        return
      }
      if (result === "taken") {
        const params = new URLSearchParams({ move: "1", date: parsed.data.date, time: parsed.data.time })
        res.redirect(303, `${pagePath}?${params.toString()}`)
        return
      }
      res.redirect(303, result === "moved" ? `${pagePath}?moved=1` : pagePath)
      return
    }
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
      res.redirect(303, `${pagePath}?answered=${answer.data === "cancel" ? "cancel" : "1"}`)
      return
    }
    const shared = await findSharedAppointment(token)
    if (!shared) {
      res.status(404).send(renderPublicAppointmentNotFound())
      return
    }
    const { clientMoveView } = await import("../services/appointmentRescheduleService.js")
    const moving = req.query.move === "1"
    const moveState = await clientMoveView(
      shared,
      moving ? { date: query(req, "date"), from: query(req, "from"), time: query(req, "time"), pick: req.query.pick === "1" } : null
    )
    res.status(200).send(
      renderPublicAppointmentPage(shared.appointment, shared.settings, {
        respondPath: `${pagePath}/respond`,
        payPath: `${pagePath}/pay`,
        pagePath,
        invoice: shared.invoice,
        depositOnline: shared.depositOnline,
        nowIso: new Date().toISOString(),
        justAnswered: req.query.answered === "1",
        justPaid: req.query.paid === "1",
        askingToCancel: req.query.cancel === "1",
        move: { check: moveState.check, view: moveState.view, movePath: `${pagePath}/move`, justMoved: req.query.moved === "1" },
        // Their confirmation (with this link) went by email when 521 sends them.
        confirmationEmailedTo:
          shared.appointment.lastEmailedTo ?? (moveState.emailClients ? shared.appointment.clientEmail : null),
      })
    )
  } catch (error) {
    console.error("publicAppointment: failed", error)
    res.status(500).send(renderPublicAppointmentNotFound())
  }
}
