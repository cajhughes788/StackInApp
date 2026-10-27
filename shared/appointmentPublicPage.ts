import { DateTime } from "luxon"

import { appointmentEndTime, formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "./invoiceDisplay"
import { escapeHtml, shell, telHref } from "./invoicePublicPage"
import type { AppointmentStatus, AppointmentType } from "./schemas/appointment"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The page a client sees from an appointment link
// (app.the521app.com/b/{token}, served by the publicAppointment function).
// Same frame and rules as the invoice page: plain HTML, every owner-typed
// string escaped. A waiting request shows Confirm and Can't make it, which
// post to /b/{token}/respond.
// ---------------------------------------------------------------------------

const STATUS_PILLS: Record<AppointmentStatus, { label: string; bg: string; fg: string }> = {
  requested: { label: "Please confirm", bg: "#FFF4DE", fg: "#8A5A00" },
  confirmed: { label: "Confirmed", bg: "#E3F4EA", fg: "#1E7A47" },
  declined: { label: "Declined", bg: "#ECEBE6", fg: "#5B6166" },
  canceled: { label: "Canceled", bg: "#ECEBE6", fg: "#5B6166" },
  completed: { label: "Done", bg: "#E3F4EA", fg: "#1E7A47" },
  expired: { label: "Expired", bg: "#ECEBE6", fg: "#5B6166" },
}

// "Dec 3 at 2pm", in the business's time zone.
function formatHoldUntil(iso: string, timeZone: string): string {
  const at = DateTime.fromISO(iso, { zone: timeZone })
  if (!at.isValid) return ""
  const time = formatBookingTime(at.toFormat("HH:mm"))
  return `${at.toFormat("LLL d")} at ${time}`
}

export function renderPublicAppointmentPage(
  appointment: AppointmentType,
  settings: InvoiceSettings,
  options: { respondPath: string; justAnswered?: boolean }
): string {
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const businessName = settings.businessName || "Your appointment"
  const pill = STATUS_PILLS[appointment.status]
  const zone = DateTime.fromISO(appointment.startAt, { zone: appointment.timeZone })
  const zoneName = zone.isValid ? zone.toFormat("ZZZZ") : ""
  const when = `${formatAppointmentDate(appointment.date, appointment.date.slice(0, 4))} · ${formatBookingTime(appointment.startTime)} – ${formatBookingTime(appointmentEndTime(appointment.startTime, appointment.minutes))}${zoneName ? ` <span class="muted">(${escapeHtml(zoneName)})</span>` : ""}`

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

  const deposit =
    appointment.deposit.type === "fixed"
      ? appointment.deposit.value
      : appointment.deposit.type === "percent"
        ? Math.round(appointment.price * appointment.deposit.value) / 100
        : 0

  const messages: Record<AppointmentStatus, string> = {
    requested: appointment.holdExpiresAt
      ? `${escapeHtml(businessName)} is holding this time for you until ${escapeHtml(formatHoldUntil(appointment.holdExpiresAt, appointment.timeZone))}.`
      : "",
    confirmed: options.justAnswered ? "You're booked. See you then!" : "You're booked.",
    declined: `You let ${escapeHtml(businessName)} know you can't make it. Reach out to pick another time.`,
    canceled: "This appointment was canceled.",
    completed: "Thanks for coming in.",
    expired: `This request wasn't confirmed in time, so the slot was released. Contact ${escapeHtml(businessName)} to book again.`,
  }

  const actions =
    appointment.status === "requested"
      ? `<form method="post" action="${escapeHtml(options.respondPath)}" style="margin-top:16px">
      <button class="btn pay" type="submit" name="answer" value="confirm">Confirm appointment</button>
      <button class="btn secondary" type="submit" name="answer" value="decline" style="width:100%;margin-top:8px">I can't make it</button>
    </form>`
      : ""

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
    <div class="head">
      <h1>${escapeHtml(appointment.serviceName)}</h1>
      <span class="pill" style="background:${pill.bg};color:${pill.fg}">${pill.label}</span>
    </div>
    <p style="margin:8px 0 0">${when}</p>
    <p class="muted" style="margin:2px 0 0">For ${escapeHtml(appointment.clientName)}</p>
    <div class="total" style="margin-top:16px">
      <span class="label">Price</span>
      <span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(formatInvoiceMoney(appointment.price))}</span>
    </div>
    ${
      deposit > 0
        ? `<div class="total"><span class="label">Deposit</span><span class="muted" style="font-variant-numeric:tabular-nums">${escapeHtml(formatInvoiceMoney(deposit))}, paid at your appointment</span></div>`
        : ""
    }
    ${messages[appointment.status] ? `<p style="margin:16px 0 0">${messages[appointment.status]}</p>` : ""}
    ${actions}
  </section>
  ${policies ? `<section class="section"><div class="label">Policies</div><div class="policies" style="margin-top:6px">${escapeHtml(policies)}</div></section>` : ""}
</article>
<p class="foot">Booked with 521</p>`
  return shell(`${appointment.serviceName} with ${businessName}`, body, accent)
}

export function renderPublicAppointmentNotFound(): string {
  return shell(
    "Appointment not found",
    `<article class="card"><div class="bar"></div><section class="section">
  <h1>This appointment link isn't valid</h1>
  <p style="color:var(--muted)">It may have been mistyped, or the appointment was removed. Ask the sender for a new link.</p>
</section></article>`,
    DEFAULT_INVOICE_ACCENT_COLOR
  )
}
