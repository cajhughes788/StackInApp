import { DateTime } from "luxon"

import {
  appointmentDepositAmount,
  appointmentMoney,
  cancellationPolicyText,
  clientCanCancel,
  clientCancelRefunds,
  refundCutoffLabel,
} from "./appointmentDeposits"
import { appointmentEndTime, appointmentMapLinks, formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "./invoiceDisplay"
import { escapeHtml, shell, telHref } from "./invoicePublicPage"
import type { AppointmentStatus, AppointmentType } from "./schemas/appointment"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings, type InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The page a client sees from an appointment link
// (app.the521app.com/b/{token}, served by the publicAppointment function).
// Same frame and rules as the invoice page: plain HTML, every owner-typed
// string escaped. A waiting request shows Confirm and Can't make it, which
// post to /b/{token}/respond. When the deposit is paid online, Confirm is
// "Confirm & pay deposit" (a POST to /b/{token}/pay, on to Stripe). A
// confirmed appointment can be canceled from here (?cancel=1 first says
// what happens to the deposit).
// ---------------------------------------------------------------------------

const STATUS_PILLS: Record<AppointmentStatus, { label: string; bg: string; fg: string }> = {
  requested: { label: "Please confirm", bg: "#FFF4DE", fg: "#8A5A00" },
  confirmed: { label: "Confirmed", bg: "#E3F4EA", fg: "#1E7A47" },
  declined: { label: "Declined", bg: "#ECEBE6", fg: "#5B6166" },
  canceled: { label: "Canceled", bg: "#ECEBE6", fg: "#5B6166" },
  completed: { label: "Done", bg: "#E3F4EA", fg: "#1E7A47" },
  expired: { label: "Expired", bg: "#ECEBE6", fg: "#5B6166" },
  no_show: { label: "Missed", bg: "#ECEBE6", fg: "#5B6166" },
}

// "Dec 3 at 2pm", in the business's time zone.
function formatHoldUntil(iso: string, timeZone: string): string {
  const at = DateTime.fromISO(iso, { zone: timeZone })
  if (!at.isValid) return ""
  const time = formatBookingTime(at.toFormat("HH:mm"))
  return `${at.toFormat("LLL d")} at ${time}`
}

// The address as typed, then directions in whichever maps app they use.
function renderWhere(location: string): string {
  const address = location.trim()
  if (!address) return ""
  const maps = appointmentMapLinks(address)
  return `<div style="margin-top:16px">
      <div class="label">Where</div>
      <div class="address" style="margin-top:4px">${escapeHtml(address)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn secondary" style="padding:8px 14px;font-size:14px;text-decoration:none" href="${escapeHtml(maps.apple)}" target="_blank" rel="noopener">Apple Maps</a>
        <a class="btn secondary" style="padding:8px 14px;font-size:14px;text-decoration:none" href="${escapeHtml(maps.google)}" target="_blank" rel="noopener">Google Maps</a>
      </div>
    </div>`
}

export type PublicAppointmentPageOptions = {
  respondPath: string
  payPath: string
  // The page itself (the cancel step links back to it).
  pagePath: string
  // The appointment's invoice (its deposit payments), or null.
  invoice: Pick<InvoiceType, "payments" | "refunds"> | null
  // The deposit is paid here, online (appointmentDepositOnline).
  depositOnline: boolean
  nowIso: string
  justAnswered?: boolean
  justPaid?: boolean
  askingToCancel?: boolean
}

export function renderPublicAppointmentPage(
  appointment: AppointmentType,
  settings: InvoiceSettings,
  options: PublicAppointmentPageOptions
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

  const deposit = appointmentDepositAmount(appointment)
  const money = appointmentMoney(appointment, options.invoice)
  const depositMoney = escapeHtml(formatInvoiceMoney(deposit))
  const before = appointment.startAt > options.nowIso
  // Paying online is how a waiting request is confirmed, and how a booked
  // one pays a deposit still owed.
  const payNow =
    options.depositOnline && money.kind === "due" && before && (appointment.status === "requested" || appointment.status === "confirmed")
  const canCancel = clientCanCancel(appointment, options.nowIso)
  const paidOnline = (options.invoice?.payments ?? []).some((payment) => payment.via === "online")

  const depositRow = (() => {
    const row = (value: string) =>
      `<div class="total"><span class="label">Deposit</span><span class="muted" style="font-variant-numeric:tabular-nums">${value}</span></div>`
    if (money.kind === "paid") return row(`${escapeHtml(formatInvoiceMoney(money.amount))} paid`)
    if (money.kind === "refunded") return row(`${escapeHtml(formatInvoiceMoney(money.amount))} refunded`)
    if (money.kind === "none") return ""
    if (options.depositOnline) return row(appointment.status === "requested" ? `${depositMoney}, paid now to book` : `${depositMoney}, due before your appointment`)
    return row(`${depositMoney}, paid at your appointment`)
  })()

  const canceledMessage = (() => {
    const who = appointment.canceledBy === "client" ? "You canceled this appointment." : "This appointment was canceled."
    if (money.kind === "refunded") return `${who} Your deposit was refunded — it can take 5–10 business days to show up.`
    if (money.kind === "paid") {
      return appointment.canceledBy === "client" && paidOnline
        ? `${who} The ${escapeHtml(formatInvoiceMoney(money.amount))} deposit was kept, per the cancellation policy.`
        : `${who} Contact ${escapeHtml(businessName)} about your deposit.`
    }
    return who
  })()

  const messages: Record<AppointmentStatus, string> = {
    requested: options.justPaid
      ? "Payment received — confirming your booking. Refresh this page in a moment."
      : appointment.holdExpiresAt
        ? `${escapeHtml(businessName)} is holding this time for you until ${escapeHtml(formatHoldUntil(appointment.holdExpiresAt, appointment.timeZone))}.`
        : "",
    confirmed: options.justPaid
      ? "Deposit received — you're booked. Stripe is emailing you a receipt."
      : options.justAnswered
        ? "You're booked. See you then!"
        : "You're booked.",
    declined: `You let ${escapeHtml(businessName)} know you can't make it. Reach out to pick another time.`,
    canceled: canceledMessage,
    completed: "Thanks for coming in.",
    expired: `This request wasn't confirmed in time, so the slot was released. Contact ${escapeHtml(businessName)} to book again.`,
    no_show: money.kind === "paid" ? "This appointment was missed, so the deposit was kept." : "This appointment was missed.",
  }

  const cancelStep = (() => {
    const refunds = clientCancelRefunds(appointment, options.nowIso)
    const outcome =
      money.kind !== "paid"
        ? ""
        : !paidOnline
          ? `Contact ${escapeHtml(businessName)} about your ${escapeHtml(formatInvoiceMoney(money.amount))} deposit.`
          : refunds
            ? `Your ${escapeHtml(formatInvoiceMoney(money.amount))} deposit will be refunded to your card.`
            : appointment.refundCutoffHours === null
              ? `Your ${escapeHtml(formatInvoiceMoney(money.amount))} deposit won't be refunded.`
              : `It's less than ${escapeHtml(refundCutoffLabel(appointment.refundCutoffHours))} before your appointment, so your ${escapeHtml(formatInvoiceMoney(money.amount))} deposit won't be refunded.`
    return `<div style="margin-top:16px;padding:14px;border-radius:12px;background:#F6F5F1">
      <p style="margin:0;font-weight:600">Cancel this appointment?</p>
      ${outcome ? `<p style="margin:6px 0 0">${outcome}</p>` : ""}
      <form method="post" action="${escapeHtml(options.respondPath)}" style="margin-top:12px">
        <button class="btn pay" type="submit" name="answer" value="cancel">Yes, cancel appointment</button>
      </form>
      <a class="btn secondary" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="${escapeHtml(options.pagePath)}">Keep my appointment</a>
    </div>`
  })()

  const payForm = (label: string) =>
    `<form method="post" action="${escapeHtml(options.payPath)}" style="margin-top:16px">
      <button class="btn pay" type="submit">${label}</button>
    </form>`

  const actions = (() => {
    if (options.askingToCancel && canCancel) return cancelStep
    if (appointment.status === "requested") {
      const confirm = payNow
        ? `<button class="btn pay" type="submit" formaction="${escapeHtml(options.payPath)}">Confirm &amp; pay ${depositMoney} deposit</button>`
        : `<button class="btn pay" type="submit" name="answer" value="confirm">Confirm appointment</button>`
      return `<form method="post" action="${escapeHtml(options.respondPath)}" style="margin-top:16px">
      ${confirm}
      <button class="btn secondary" type="submit" name="answer" value="decline" style="width:100%;margin-top:8px">I can't make it</button>
    </form>`
    }
    const parts = [
      payNow && !options.justPaid ? payForm(`Pay ${depositMoney} deposit`) : "",
      canCancel
        ? `<a style="display:block;text-align:center;margin-top:14px;color:var(--muted);font-size:14px" href="${escapeHtml(options.pagePath)}?cancel=1">Cancel appointment</a>`
        : "",
    ]
    return parts.join("")
  })()

  const policies = [deposit > 0 ? cancellationPolicyText(appointment.refundCutoffHours) : "", settings.defaultPolicies?.trim() ?? ""]
    .filter(Boolean)
    .join("\n\n")
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
    ${renderWhere(appointment.location)}
    <div class="total" style="margin-top:16px">
      <span class="label">Price</span>
      <span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(formatInvoiceMoney(appointment.price))}</span>
    </div>
    ${depositRow}
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
