import { DateTime } from "luxon"

import { appointmentDepositAmount, appointmentDepositOnline, cancellationPolicyText } from "./appointmentDeposits"
import { appointmentEndTime, formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "./invoiceDisplay"
import { escapeHtml, shell, telHref } from "./invoicePublicPage"
import { BOOKING_VIA_WEBSITE, publicBookingUrl } from "./onlineBooking"
import type { BookingService, BookingSettings } from "./schemas/booking"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The public booking page (app.the521app.com/book/{slug}, served by the
// publicBooking function): pick a service, a day, a time, then details.
// Each step is its own plain page (links carry the choices so far in the
// query), so it works with no scripts, like the invoice and appointment
// pages. Only open times are ever shown — never another client's details.
// ---------------------------------------------------------------------------

export type PublicBookingView =
  | { step: "services" }
  | { step: "days"; service: BookingService; days: string[]; moreFrom: string | null }
  | { step: "times"; service: BookingService; date: string; times: string[]; taken?: boolean }
  | {
      step: "details"
      service: BookingService
      date: string
      time: string
      // A fresh key per form, so a double tap books once.
      formKey: string
      error?: string
      values?: { name: string; email: string; phone: string }
    }

export type PublicBookingContext = {
  slug: string
  booking: Pick<BookingSettings, "services" | "timeZone" | "location" | "refundCutoffHours">
  settings: InvoiceSettings
  // The business takes card payments (deposits are paid when booking).
  onlinePayments: boolean
  // They came from the owner's website button (?via=site); kept on every
  // step so the booking is marked as from their website.
  fromWebsite: boolean
  nowIso: string
}

function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

function depositLabel(service: BookingService): string {
  const amount = appointmentDepositAmount(service)
  return amount > 0 ? ` · ${formatInvoiceMoney(amount)} deposit` : ""
}

function zoneName(context: PublicBookingContext, date: string): string {
  const at = DateTime.fromISO(`${date}T12:00`, { zone: context.booking.timeZone })
  return at.isValid ? at.toFormat("ZZZZ") : ""
}

function stepLink(slug: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return `/book/${encodeURIComponent(slug)}${query ? `?${query}` : ""}`
}

function backLink(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-bottom:12px;color:var(--muted);font-size:14px;text-decoration:none">&larr; ${escapeHtml(label)}</a>`
}

function serviceSummary(service: BookingService): string {
  return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
      <h1>${escapeHtml(service.name)}</h1>
      <span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(formatInvoiceMoney(service.price))}</span>
    </div>
    <p class="muted" style="margin:4px 0 0">${escapeHtml(lengthLabel(service.minutes))}${escapeHtml(depositLabel(service))}</p>`
}

function renderStep(context: PublicBookingContext, view: PublicBookingView): string {
  const { slug } = context
  const link = (params: Record<string, string>) =>
    stepLink(slug, context.fromWebsite ? { ...params, via: BOOKING_VIA_WEBSITE } : params)
  const thisYear = DateTime.fromISO(context.nowIso, { zone: context.booking.timeZone }).toFormat("yyyy")

  if (view.step === "services") {
    const services = context.booking.services.filter((service) => service.active)
    const rows = services
      .map(
        (service) => `<a class="opt" style="color:inherit;text-decoration:none" href="${escapeHtml(link({ service: service.id }))}">
        <span style="min-width:0"><span style="display:block;font-weight:600">${escapeHtml(service.name)}</span>
        <span class="muted" style="font-size:14px">${escapeHtml(lengthLabel(service.minutes))}${escapeHtml(depositLabel(service))}</span></span>
        <strong>${escapeHtml(formatInvoiceMoney(service.price))}</strong>
      </a>`
      )
      .join("")
    return `<h1>Book an appointment</h1>
    <p class="muted" style="margin:4px 0 8px">Pick a service.</p>
    ${rows || `<p>Nothing is open for booking right now.</p>`}`
  }

  if (view.step === "days") {
    const days = view.days
      .map(
        (date) =>
          `<a class="opt" style="color:inherit;text-decoration:none" href="${escapeHtml(link({ service: view.service.id, date }))}"><span>${escapeHtml(formatAppointmentDate(date, thisYear))}</span><strong class="muted">&rsaquo;</strong></a>`
      )
      .join("")
    return `${backLink(link({}), "Services")}
    ${serviceSummary(view.service)}
    <p class="label" style="margin:20px 0 0">Pick a day</p>
    ${days || `<p>No open times right now. Contact ${escapeHtml(context.settings.businessName || "the business")} to book.</p>`}
    ${
      view.moreFrom
        ? `<a class="btn secondary" style="display:block;text-align:center;text-decoration:none;margin-top:14px" href="${escapeHtml(link({ service: view.service.id, from: view.moreFrom }))}">Later dates</a>`
        : ""
    }`
  }

  if (view.step === "times") {
    const zone = zoneName(context, view.date)
    const times = view.times
      .map(
        (time) =>
          `<a class="tip" style="color:inherit;text-decoration:none" href="${escapeHtml(link({ service: view.service.id, date: view.date, time }))}">${escapeHtml(formatBookingTime(time))}</a>`
      )
      .join("")
    return `${backLink(link({ service: view.service.id }), "Days")}
    ${serviceSummary(view.service)}
    ${view.taken ? `<p style="margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#FFF4DE;color:#8A5A00">That time was just taken — pick another.</p>` : ""}
    <p class="label" style="margin:20px 0 0">${escapeHtml(formatAppointmentDate(view.date, thisYear))}${zone ? ` · times in ${escapeHtml(zone)}` : ""}</p>
    ${
      times
        ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px">${times}</div>`
        : `<p>No open times left that day. <a href="${escapeHtml(link({ service: view.service.id }))}">Pick another day</a>.</p>`
    }`
  }

  // details
  const { service } = view
  const zone = zoneName(context, view.date)
  const deposit = appointmentDepositAmount(service)
  const payOnline = appointmentDepositOnline(service, context.onlinePayments)
  const values = view.values ?? { name: "", email: "", phone: "" }
  const input = (name: string, label: string, type: string, value: string, extra: string) =>
    `<label style="display:block;margin-top:12px;font-size:14px;font-weight:600">${label}
      <input class="custom" style="display:block" type="${type}" name="${name}" value="${escapeHtml(value)}" ${extra}>
    </label>`
  return `${backLink(link({ service: service.id, date: view.date }), "Times")}
    ${serviceSummary(service)}
    <p style="margin:12px 0 0">${escapeHtml(formatAppointmentDate(view.date, thisYear))} · ${escapeHtml(formatBookingTime(view.time))} – ${escapeHtml(formatBookingTime(appointmentEndTime(view.time, service.minutes)))}${zone ? ` <span class="muted">(${escapeHtml(zone)})</span>` : ""}</p>
    ${context.booking.location.trim() ? `<p class="muted address" style="margin:4px 0 0">${escapeHtml(context.booking.location.trim())}</p>` : ""}
    ${view.error ? `<p style="margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#FDECEC;color:#A32020">${escapeHtml(view.error)}</p>` : ""}
    <form method="post" action="${escapeHtml(`/book/${encodeURIComponent(slug)}/book`)}" style="margin-top:8px">
      <input type="hidden" name="service" value="${escapeHtml(service.id)}">
      <input type="hidden" name="date" value="${escapeHtml(view.date)}">
      <input type="hidden" name="time" value="${escapeHtml(view.time)}">
      <input type="hidden" name="key" value="${escapeHtml(view.formKey)}">
      ${context.fromWebsite ? `<input type="hidden" name="via" value="${BOOKING_VIA_WEBSITE}">` : ""}
      ${input("name", "Your name", "text", values.name, 'required maxlength="80" autocomplete="name"')}
      ${input("email", "Email", "email", values.email, 'required maxlength="254" autocomplete="email"')}
      ${input("phone", 'Phone <span class="muted">(optional)</span>', "tel", values.phone, 'maxlength="40" autocomplete="tel"')}
      <div style="position:absolute;left:-10000px" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
      ${
        deposit > 0
          ? `<p class="muted" style="margin:16px 0 0;font-size:14px">${
              payOnline
                ? `A ${escapeHtml(formatInvoiceMoney(deposit))} deposit is paid by card now; the rest at your appointment.`
                : `A ${escapeHtml(formatInvoiceMoney(deposit))} deposit is paid at your appointment.`
            } ${escapeHtml(cancellationPolicyText(context.booking.refundCutoffHours))}</p>`
          : ""
      }
      <button class="btn pay" type="submit" style="margin-top:16px">${
        payOnline ? `Book &amp; pay ${escapeHtml(formatInvoiceMoney(deposit))} deposit` : "Book appointment"
      }</button>
    </form>`
}

export function renderPublicBookingPage(context: PublicBookingContext, view: PublicBookingView): string {
  const { settings } = context
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const businessName = settings.businessName || "Book an appointment"
  const contact = [
    settings.businessEmail
      ? `<a class="email" href="mailto:${escapeHtml(settings.businessEmail)}">${escapeHtml(settings.businessEmail)}</a>`
      : "",
    settings.businessPhone
      ? `<a class="phone" href="tel:${escapeHtml(telHref(settings.businessPhone))}">${escapeHtml(formatInvoicePhone(settings.businessPhone))}</a>`
      : "",
  ]
    .filter(Boolean)
    .join("")
  const policies = settings.defaultPolicies?.trim()
  const body = `<article class="card">
  <div class="bar"></div>
  <section class="section">
    <div class="biz">
      ${settings.logoDataUrl ? `<img src="${escapeHtml(settings.logoDataUrl)}" alt="">` : ""}
      <div>
        <div class="biz-name">${escapeHtml(businessName)}</div>
        ${contact ? `<div class="biz-contact">${contact}</div>` : ""}
      </div>
    </div>
  </section>
  <section class="section">
    ${renderStep(context, view)}
  </section>
  ${policies && view.step === "details" ? `<section class="section"><div class="label">Policies</div><div class="policies" style="margin-top:6px">${escapeHtml(policies)}</div></section>` : ""}
</article>
<p class="foot">Booked with 521</p>`
  // The preview card when the link is shared in a text or a post, with the
  // logo when there is one (served at /book/{slug}/logo by publicBooking).
  const preview = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(`Book with ${settings.businessName || "me"}`)}">`,
    `<meta property="og:description" content="Book an appointment online.">`,
    `<meta property="og:url" content="${escapeHtml(publicBookingUrl(context.slug))}">`,
    ...(settings.logoDataUrl
      ? [
          `<meta property="og:image" content="${escapeHtml(`${publicBookingUrl(context.slug)}/logo`)}">`,
          `<meta property="og:image:alt" content="${escapeHtml(`${settings.businessName || "Business"} logo`)}">`,
        ]
      : []),
    `<meta name="twitter:card" content="summary">`,
  ].join("\n")
  return shell(`Book with ${businessName}`, body, accent, preview)
}

export function renderPublicBookingUnavailable(): string {
  return shell(
    "Booking not available",
    `<article class="card"><div class="bar"></div><section class="section">
  <h1>This booking link isn't available</h1>
  <p style="color:var(--muted)">It may have been mistyped, or online booking is turned off. Contact the business to book.</p>
</section></article>`,
    DEFAULT_INVOICE_ACCENT_COLOR
  )
}
