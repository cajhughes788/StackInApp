import type { Request, Response } from "express"
import { findSharedInvoice } from "../services/invoicesService"
import { renderPublicInvoiceNotFound, renderPublicInvoicePage } from "@shared/invoicePublicPage"

// Public, unauthenticated: the page behind a shared invoice link. Hosting
// rewrites /i/** here, so the token is the last path segment; ?t= also
// works when the function is hit directly.
//
// The CSP allows nothing but inline styles, data: images (the logo) and
// the one inline print handler.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  // Status and amounts change (paid, voided), so never serve a stale copy.
  "Cache-Control": "private, no-store",
}

function tokenFrom(req: Request): string {
  const fromQuery = typeof req.query.t === "string" ? req.query.t : ""
  if (fromQuery) return fromQuery
  const segments = req.path.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? ""
}

export async function publicInvoiceHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method not allowed")
    return
  }
  try {
    const shared = await findSharedInvoice(tokenFrom(req))
    if (!shared) {
      res.status(404).send(renderPublicInvoiceNotFound())
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    res.status(200).send(renderPublicInvoicePage(shared.invoice, shared.settings, today))
  } catch (error) {
    console.error("publicInvoice: failed to render", error)
    res.status(500).send(renderPublicInvoiceNotFound())
  }
}
