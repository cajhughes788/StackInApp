import { DateTime } from "luxon"

import {
  appointmentDepositAmount,
  appointmentMoney,
  cancellationPolicyText,
  clientCanCancel,
  clientCancelRefunds,
  refundCutoffLabel,
} from "./appointmentDeposits"
import { formatMovedFrom, type ClientMoveView, type ClientRescheduleCheck } from "./appointmentReschedule"
import { appointmentEndTime, appointmentMapLinks, formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "./invoiceDisplay"
import { escapeHtml, pageFoot, shell, telHref } from "./invoicePublicPage"
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
// what happens to the deposit), or moved once to an open time (?move=1 is
// a warning first; then a day → a time → "Move to …?", a POST to
// /b/{token}/move). Right after booking the page offers only Cancel: moving
// is offered when they come back to it from their email or text.
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
  // Right after booking: where the confirmation (with this link) was
  // emailed, or null to tell them to keep this page's link.
  confirmationEmailedTo?: string | null
  // Moving it (appointmentReschedule.ts): whether they may, and the step
  // they're on (null when not picking a time).
  move?: { check: ClientRescheduleCheck; view: ClientMoveView | null; movePath: string; justMoved?: boolean }
}

// "Thu, Dec 4 at 2pm", or "… 2026" when not this year.
function moveWhen(date: string, time: string, thisYear: string): string {
  return `${formatAppointmentDate(date, thisYear)} at ${formatBookingTime(time)}`
}

// The steps for moving it; plain links and one form, no scripts.
function renderMoveStep(
  view: ClientMoveView,
  context: { pagePath: string; movePath: string; thisYear: string; businessName: string; timeZone: string }
): string {
  const { pagePath, movePath, thisYear } = context
  const link = (params: Record<string, string>) => `${pagePath}?${new URLSearchParams({ move: "1", ...params }).toString()}`
  const back = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:16px 0 4px;color:var(--muted);font-size:14px;text-decoration:none">&larr; ${escapeHtml(label)}</a>`
  if (view.step === "warn") {
    return `<div style="margin-top:16px;padding:14px;border-radius:12px;background:#FFF4DE;color:#5C3D00">
      <p style="margin:0;font-weight:600">Move this appointment?</p>
      <p style="margin:6px 0 0">You can move it yourself only once, until ${escapeHtml(formatHoldUntil(view.deadline, context.timeZone))}. After that, you'll need to contact ${escapeHtml(context.businessName)} to change it.</p>
      <p style="margin:6px 0 0">Your current time stays yours until you pick a new one. Your deposit, if you paid one, moves with it.</p>
      <a class="btn pay" style="display:block;text-align:center;text-decoration:none;margin-top:12px" href="${escapeHtml(link({ pick: "1" }))}">Yes, pick a new time</a>
      <a class="btn secondary" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="${escapeHtml(pagePath)}">Keep my appointment</a>
    </div>`
  }
  if (view.step === "days") {
    const days = view.days
      .map(
        (date) =>
          `<a class="opt" style="color:inherit;text-decoration:none" href="${escapeHtml(link({ date }))}"><span>${escapeHtml(formatAppointmentDate(date, thisYear))}</span><strong class="muted">&rsaquo;</strong></a>`
      )
      .join("")
    return `${back(pagePath, "Keep my current time")}
    <p class="label" style="margin:8px 0 0">Pick a new day</p>
    ${days || "<p>No other open times right now.</p>"}
    ${view.moreFrom ? `<a class="btn secondary" style="display:block;text-align:center;text-decoration:none;margin-top:14px" href="${escapeHtml(link({ from: view.moreFrom }))}">Later dates</a>` : ""}`
  }
  if (view.step === "times") {
    const times = view.times
      .map(
        (time) =>
          `<a class="tip" style="color:inherit;text-decoration:none" href="${escapeHtml(link({ date: view.date, time }))}">${escapeHtml(formatBookingTime(time))}</a>`
      )
      .join("")
    return `${back(link({ pick: "1" }), "Days")}
    ${view.taken ? `<p style="margin:8px 0 0;padding:10px 12px;border-radius:10px;background:#FFF4DE;color:#8A5A00">That time was just taken — pick another.</p>` : ""}
    <p class="label" style="margin:8px 0 0">${escapeHtml(formatAppointmentDate(view.date, thisYear))}</p>
    ${times ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px">${times}</div>` : `<p>No open times left that day. <a href="${escapeHtml(link({ pick: "1" }))}">Pick another day</a>.</p>`}`
  }
  return `<div style="margin-top:16px;padding:14px;border-radius:12px;background:#F6F5F1">
      <p style="margin:0;font-weight:600">Move to ${escapeHtml(moveWhen(view.date, view.time, thisYear))}?</p>
      <p class="muted" style="margin:6px 0 0;font-size:14px">You can move it yourself once. Your deposit, if you paid one, moves with it.</p>
      <form method="post" action="${escapeHtml(movePath)}" style="margin-top:12px">
        <input type="hidden" name="date" value="${escapeHtml(view.date)}">
        <input type="hidden" name="time" value="${escapeHtml(view.time)}">
        <button class="btn pay" type="submit">Yes, move it</button>
      </form>
      <a class="btn secondary" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="${escapeHtml(link({ date: view.date }))}">Pick another time</a>
    </div>`
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
      : options.move?.justMoved
        ? "Your appointment is moved. See you then!"
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

  const thisYear = options.nowIso.slice(0, 4)
  const move = options.move
  // Right after booking (or paying), only Cancel is offered: moving shows
  // when they come back to this page later.
  const justBooked = !!options.justAnswered || !!options.justPaid
  const moveOffer = (() => {
    if (!move || appointment.status !== "confirmed" || !before || justBooked) return ""
    if (move.check.ok) {
      return `<a style="display:block;text-align:center;margin-top:14px;color:var(--muted);font-size:14px" href="${escapeHtml(options.pagePath)}?move=1">Need a different time?</a>`
    }
    if (move.check.reason === "status") return ""
    return `<p class="muted" style="margin:16px 0 0;font-size:14px">${
      move.check.reason === "used" ? "You've already moved this once. " : ""
    }To change the time, contact ${escapeHtml(businessName)}.</p>`
  })()
  // Where to find this page again.
  const keepLinkNote =
    justBooked && (appointment.status === "confirmed" || appointment.status === "requested")
      ? `<p class="muted" style="margin:8px 0 0;font-size:14px">${
          options.confirmationEmailedTo
            ? `We emailed your confirmation to ${escapeHtml(options.confirmationEmailedTo)}. Use the link in it if you need to change anything.`
            : "Save this page's link if you might need to change anything."
        }</p>`
      : ""

  const actions = (() => {
    if (options.askingToCancel && canCancel) return cancelStep
    if (move?.view && move.check.ok) {
      return renderMoveStep(move.view, {
        pagePath: options.pagePath,
        movePath: move.movePath,
        thisYear,
        businessName,
        timeZone: appointment.timeZone,
      })
    }
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
      moveOffer,
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
    <p class="muted" style="margin:2px 0 0">For ${escapeHtml(appointment.clientName)}${
      appointment.reschedules.length > 0
        ? ` · moved from ${escapeHtml(formatMovedFrom(appointment.reschedules[appointment.reschedules.length - 1], thisYear))}`
        : ""
    }</p>
    ${renderWhere(appointment.location)}
    <div class="total" style="margin-top:16px">
      <span class="label">Price</span>
      <span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(formatInvoiceMoney(appointment.price))}</span>
    </div>
    ${depositRow}
    ${messages[appointment.status] ? `<p style="margin:16px 0 0">${messages[appointment.status]}</p>` : ""}
    ${keepLinkNote}
    ${actions}
  </section>
  ${policies ? `<section class="section"><div class="label">Policies</div><div class="policies" style="margin-top:6px">${escapeHtml(policies)}</div></section>` : ""}
</article>
${pageFoot("Booked with 521")}`
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
