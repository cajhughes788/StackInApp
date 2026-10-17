import type { Request, Response } from "express"
import { findSharedInvoice } from "../services/invoicesService"
import { invoiceOnlinePayment, startInvoiceCheckout } from "../services/invoicePaymentsService"
import { renderPublicInvoiceNotFound, renderPublicInvoicePage } from "@shared/invoicePublicPage"

// Public, unauthenticated: the page behind a shared invoice link. Hosting
// rewrites /i/** here, so the token is the last path segment; ?t= also
// works when the function is hit directly.
//
// /i/{token}/pay starts Stripe Checkout for the client (303 to Stripe): POST
// from the page's Pay button, GET from the email's "Pay now" link. The
// amount always comes from the stored invoice, never the request, and the
// session is reused per invoice — so a mail scanner opening the link first
// can't create a second payment.
//
// The CSP allows nothing but inline styles, data: images (the logo), the one
// inline print handler, and the Pay form posting here and on to Stripe.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  // Status and amounts change (paid, voided), so never serve a stale copy.
  "Cache-Control": "private, no-store",
}

function parsePath(req: Request): { token: string; pay: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const pay = segments[segments.length - 1] === "pay"
  const fromQuery = typeof req.query.t === "string" ? req.query.t : ""
  const token = fromQuery || (pay ? segments[segments.length - 2] : segments[segments.length - 1]) || ""
  return { token, pay }
}

export async function publicInvoiceHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { token, pay } = parsePath(req)
  const allowed = pay ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
  if (!allowed.includes(req.method)) {
    res.status(405).send("Method not allowed")
    return
  }
  // A HEAD probe of the pay link shouldn't start a Checkout session.
  if (pay && req.method === "HEAD") {
    res.status(200).end()
    return
  }
  try {
    if (pay) {
      const result = await startInvoiceCheckout(token)
      if (result.kind === "not_found") {
        res.status(404).send(renderPublicInvoiceNotFound())
        return
      }
      // Not payable (already paid, voided, payments off): back to the page.
      res.redirect(303, result.kind === "redirect" ? result.url : `/i/${encodeURIComponent(token)}`)
      return
    }
    const shared = await findSharedInvoice(token)
    if (!shared) {
      res.status(404).send(renderPublicInvoiceNotFound())
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const online = await invoiceOnlinePayment(shared.workspaceId, shared.invoice).catch(() => ({ payable: false, bankTransfer: false }))
    res.status(200).send(
      renderPublicInvoicePage(shared.invoice, shared.settings, today, {
        payPath: online.payable ? `/i/${encodeURIComponent(token)}/pay` : null,
        justPaid: req.query.paid === "1",
        bankTransfer: online.bankTransfer,
      })
    )
  } catch (error) {
    console.error("publicInvoice: failed to render", error)
    res.status(500).send(renderPublicInvoiceNotFound())
  }
}
