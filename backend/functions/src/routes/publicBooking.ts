import type { Request, Response } from "express"
import {
  bookableService,
  bookOnline,
  findBookingPage,
  newFormKey,
  openDays,
  openTimes,
  type BookingPage,
} from "../services/publicBookingService"
import { BOOKING_VIA_WEBSITE } from "@shared/onlineBooking"
import { renderPublicBookingPage, renderPublicBookingUnavailable, type PublicBookingView } from "@shared/bookingPublicPage"

// Public, unauthenticated: a business's booking page. Hosting rewrites
// /book/** here; the link name is the segment after /book.
//
// GET /book/{slug} walks the steps from the query: nothing → services,
// ?service → days (?from for later ones), &date → times, &time → details.
// POST /book/{slug}/book books it (a form post), then 303s to Stripe for a
// deposit, or to the customer's appointment page (/b/{token}). A GET of
// /book lands back on the page.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  // Open times change by the minute.
  "Cache-Control": "private, no-store",
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function parsePath(req: Request): { slug: string; book: boolean } {
  const segments = req.path.split("/").filter(Boolean)
  const at = segments.indexOf("book")
  const rest = at >= 0 ? segments.slice(at + 1) : segments
  return { slug: (rest[0] ?? "").toLowerCase(), book: rest[1] === "book" }
}

function query(req: Request, name: string): string {
  const value = req.query[name]
  return typeof value === "string" ? value.slice(0, 64) : ""
}

function context(page: BookingPage, via: string) {
  return {
    slug: page.slug,
    booking: page.booking,
    settings: page.settings,
    onlinePayments: page.onlinePayments,
    fromWebsite: via === BOOKING_VIA_WEBSITE,
    nowIso: new Date().toISOString(),
  }
}

// The step the query asks for, falling back a step when a choice no longer
// holds (a service switched off, a time just taken).
async function viewFor(page: BookingPage, req: Request): Promise<PublicBookingView> {
  const service = bookableService(page, query(req, "service"))
  if (!service) return { step: "services" }
  const date = query(req, "date")
  if (!DATE.test(date)) {
    const from = query(req, "from")
    return { step: "days", service, ...(await openDays(page, service, DATE.test(from) ? from : undefined)) }
  }
  const times = await openTimes(page, service, date)
  const time = query(req, "time")
  if (TIME.test(time) && times.includes(time)) return { step: "details", service, date, time, formKey: newFormKey() }
  return { step: "times", service, date, times, taken: query(req, "taken") === "1" || TIME.test(time) }
}

export async function publicBookingHandler(req: Request, res: Response): Promise<void> {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const { slug, book } = parsePath(req)
  const allowed = book ? ["GET", "POST", "HEAD"] : ["GET", "HEAD"]
  if (!allowed.includes(req.method)) {
    res.status(405).send("Method not allowed")
    return
  }
  const pagePath = `/book/${encodeURIComponent(slug)}`
  try {
    if (book) {
      if (req.method !== "POST") {
        res.redirect(303, pagePath)
        return
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      const field = (name: string) => (typeof body[name] === "string" ? (body[name] as string).slice(0, 300) : "")
      const result = await bookOnline(slug, {
        service: field("service"),
        date: field("date"),
        time: field("time"),
        key: field("key"),
        name: field("name"),
        email: field("email"),
        phone: field("phone"),
        website: field("website"),
        via: field("via"),
      })
      if (result.kind === "not_found") {
        res.status(404).send(renderPublicBookingUnavailable())
        return
      }
      if (result.kind === "pay") {
        res.redirect(303, result.url)
        return
      }
      if (result.kind === "booked") {
        res.redirect(303, `/b/${encodeURIComponent(result.shareToken)}?answered=1`)
        return
      }
      const params = new URLSearchParams({ service: field("service"), date: field("date") })
      if (field("via") === BOOKING_VIA_WEBSITE) params.set("via", BOOKING_VIA_WEBSITE)
      if (result.kind === "taken") {
        params.set("taken", "1")
        res.redirect(303, `${pagePath}?${params.toString()}`)
        return
      }
      // Something to fix in the form: show it again with what they typed.
      const page = await findBookingPage(slug)
      const service = page ? bookableService(page, field("service")) : null
      if (!page || !service || !DATE.test(field("date")) || !TIME.test(field("time"))) {
        res.redirect(303, pagePath)
        return
      }
      res.status(400).send(
        renderPublicBookingPage(context(page, field("via")), {
          step: "details",
          service,
          date: field("date"),
          time: field("time"),
          formKey: newFormKey(),
          error: result.message,
          values: { name: field("name"), email: field("email"), phone: field("phone") },
        })
      )
      return
    }

    const page = await findBookingPage(slug)
    if (!page) {
      res.status(404).send(renderPublicBookingUnavailable())
      return
    }
    res.status(200).send(renderPublicBookingPage(context(page, query(req, "via")), await viewFor(page, req)))
  } catch (error) {
    console.error("publicBooking: failed", error)
    res.status(500).send(renderPublicBookingUnavailable())
  }
}
