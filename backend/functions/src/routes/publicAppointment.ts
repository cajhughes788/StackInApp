import type { Request, Response } from "express"
import { findSharedAppointment, respondToAppointment } from "../services/appointmentsService"
import { startAppointmentCheckout } from "../services/appointmentDepositsService"
import { renderPublicAppointmentNotFound, renderPublicAppointmentPage } from "@shared/appointmentPublicPage"
import { AppointmentResponseSchema } from "@shared/schemas/appointment"

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
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
}

function parsePath(req: Request): { token: string; respond: boolean; pay: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const last = segments[segments.length - 1]
  const respond = last === "respond"
  const pay = last === "pay"
  const fromQuery = typeof req.query.t === "string" ? req.query.t : ""
  const token = fromQuery || (respond || pay ? segments[segments.length - 2] : last) || ""
  return { token, respond, pay }
}

export async function publicAppointmentHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { token, respond, pay } = parsePath(req)
  const allowed = respond || pay ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
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
      })
    )
  } catch (error) {
    console.error("publicAppointment: failed", error)
    res.status(500).send(renderPublicAppointmentNotFound())
  }
}
