import type { Request, Response } from "express"
import { answerQuote, findSharedQuote } from "../services/quotesService"
import { renderPublicQuoteNotFound, renderPublicQuotePage } from "@shared/quotePublicPage"

// Public, unauthenticated: the page behind a shared quote link. Hosting
// rewrites /q/** here, so the token is the path segment after /q.
//
// POST /q/{token}/answer is the Accept or Decline form, then a 303 back to
// the page (?answered=1). A GET of it (a mail scanner) just lands on the page.
//
// The CSP allows nothing but inline styles, data: images (the logo), the one
// inline print handler, and the forms posting back here.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
}

function parsePath(req: Request): { token: string; answer: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const at = segments.indexOf("q")
  const rest = at >= 0 ? segments.slice(at + 1) : segments
  return { token: rest[0] ?? "", answer: rest[1] === "answer" }
}

export async function publicQuoteHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { token, answer } = parsePath(req)
  const allowed = answer ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
  if (!allowed.includes(req.method)) {
    res.status(405).send("Method not allowed")
    return
  }
  const pagePath = `/q/${encodeURIComponent(token)}`
  const today = new Date().toISOString().slice(0, 10)
  try {
    if (answer && req.method !== "POST") {
      res.redirect(303, pagePath)
      return
    }
    if (answer) {
      const body = (req.body ?? {}) as Record<string, unknown>
      const field = (name: string, max: number) => (typeof body[name] === "string" ? (body[name] as string).slice(0, max) : undefined)
      const result = await answerQuote(token, { answer: field("answer", 20), name: field("name", 200), note: field("note", 1000) })
      if (result.kind === "not_found") {
        res.status(404).send(renderPublicQuoteNotFound())
        return
      }
      if (result.kind === "answered") {
        res.redirect(303, `${pagePath}?answered=1`)
        return
      }
      res.status(400).send(
        renderPublicQuotePage(result.shared.quote, result.shared.settings, today, { answerPath: `${pagePath}/answer`, error: result.message })
      )
      return
    }
    const shared = await findSharedQuote(token)
    if (!shared) {
      res.status(404).send(renderPublicQuoteNotFound())
      return
    }
    res.status(200).send(
      renderPublicQuotePage(shared.quote, shared.settings, today, { answerPath: `${pagePath}/answer`, justAnswered: req.query.answered === "1" })
    )
  } catch (error) {
    console.error("publicQuote: failed", error)
    res.status(500).send(renderPublicQuoteNotFound())
  }
}
