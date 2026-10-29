import { appointmentDepositAmount, appointmentRefundCutoffAt, cancellationPolicyText } from "./appointmentDeposits"
import { appointmentDayWords, appointmentWhenWords, formatReminderMoment } from "./appointmentReminders"
import { formatMovedFrom } from "./appointmentReschedule"
import { appointmentEndTime, appointmentLocationLine, formatAppointmentDate, formatBookingTime } from "./appointments"
import { formatInvoiceMoney, textColorOnAccent } from "./invoiceDisplay"
import { escapeHtml } from "./invoicePublicPage"
import type { AppointmentType } from "./schemas/appointment"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The email 521 sends a client about an appointment
// (appointmentEmailService.ts): asked to confirm, booked, canceled by the
// business, a reminder before it (appointmentReminders.ts), or moved to a
// new time (appointmentReschedule.ts). Same look and rules as the invoice email (invoiceEmail.ts):
// tables and inline styles, no images, everything typed escaped.
// ---------------------------------------------------------------------------

export type AppointmentEmailKind = "request" | "booked" | "canceled" | "reminder" | "moved"
export type AppointmentEmail = { subject: string; text: string; html: string }

type AppointmentEmailParams = {
  kind: AppointmentEmailKind
  appointment: AppointmentType
  settings: InvoiceSettings
  // The client's appointment page (/b/{token}).
  link: string
  // The deposit is paid by card on that page and isn't paid yet.
  depositDueOnline: boolean
  // "canceled" only: the paid deposit is being refunded.
  depositRefunded?: boolean
  // "reminder" only: when it's sent, for "tomorrow" and the free-cancel line.
  nowIso?: string
  // "moved" only: the time it had before, and who moved it.
  movedFrom?: { fromDate: string; fromStartTime: string }
  movedBy?: "owner" | "client"
}

/** "PDT" for the business's time zone at that moment; "" if unknown. */
function zoneAbbreviation(timeZone: string, atIso: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(atIso))
    return parts.find((part) => part.type === "timeZoneName")?.value ?? ""
  } catch {
    return ""
  }
}

export function buildAppointmentEmail(params: AppointmentEmailParams): AppointmentEmail {
  const { kind, appointment, settings, link, depositDueOnline } = params
  const business = settings.businessName?.trim() || "Your service provider"
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const service = appointment.serviceName
  // The year shows when it isn't this year.
  const day = formatAppointmentDate(appointment.date, new Date().toISOString().slice(0, 4))
  const start = formatBookingTime(appointment.startTime)
  const zone = zoneAbbreviation(appointment.timeZone, appointment.startAt)
  const time = `${start} – ${formatBookingTime(appointmentEndTime(appointment.startTime, appointment.minutes))}${zone ? ` ${zone}` : ""}`
  const place = appointmentLocationLine(appointment.location)
  const deposit = appointmentDepositAmount(appointment)
  const depositText = formatInvoiceMoney(deposit)
  const depositPaid = deposit > 0 && !!appointment.invoiceId
  const payNow = deposit > 0 && depositDueOnline && !depositPaid
  const nowIso = params.nowIso ?? new Date().toISOString()
  const dayWords = kind === "reminder" ? appointmentDayWords(appointment, nowIso) || `on ${day}` : ""
  const balance = Math.round((appointment.price - deposit) * 100) / 100
  const cancelFreeUntil = appointmentRefundCutoffAt(appointment)
  // A waiting request that was moved still asks them to confirm.
  const asRequest = kind === "request" || (kind === "moved" && appointment.status === "requested")

  const subject =
    kind === "request"
      ? `Please confirm: ${service} with ${business} on ${day} at ${start}`
      : kind === "booked"
        ? `You're booked: ${service} with ${business} on ${day} at ${start}`
        : kind === "reminder"
          ? `Reminder: ${service} with ${business} ${dayWords} at ${start}`
          : kind === "moved"
            ? `Moved: ${service} with ${business}, now ${day} at ${start}`
            : `Canceled: ${service} with ${business} on ${day}`
  const lead =
    kind === "request"
      ? `${business} booked a time for you. Please confirm it.`
      : kind === "booked"
        ? `You're booked with ${business}.`
        : kind === "reminder"
          ? `Your appointment with ${business} is ${appointmentWhenWords(appointment, nowIso) || dayWords}.`
          : kind === "moved"
            ? params.movedBy === "client"
              ? `Your appointment with ${business} is moved.`
              : asRequest
                ? `${business} moved the time they're holding for you. Please confirm it.`
                : `${business} moved your appointment.`
            : `${business} canceled your appointment.`
  const moneyLine =
    kind === "canceled"
      ? depositPaid
        ? params.depositRefunded
          ? `Your ${depositText} deposit is being refunded. It can take 5–10 business days to show up.`
          : null
        : null
      : payNow
        ? asRequest
          ? `A ${depositText} deposit confirms it.`
          : `A ${depositText} deposit is due to hold your time.`
        : depositPaid
          ? kind === "reminder" && balance > 0
            ? `${depositText} deposit paid. ${formatInvoiceMoney(balance)} due at your appointment.`
            : `${depositText} deposit paid.`
          : null
  const holdLine =
    kind === "request"
      ? "The time is held for you for 48 hours."
      : kind === "reminder"
        ? "Can't make it? You can cancel from your appointment page."
        : kind === "moved" && params.movedFrom
          ? `It was ${formatMovedFrom(params.movedFrom, new Date().toISOString().slice(0, 4))}.`
          : null
  const button =
    asRequest
      ? payNow
        ? `Confirm & pay ${depositText} deposit`
        : "Confirm"
      : (kind === "booked" || kind === "reminder" || kind === "moved") && payNow
        ? `Pay ${depositText} deposit`
        : "View appointment"
  // A reminder only says when cancelling stops being free, and only while
  // that's still ahead: never a refund the client can't get.
  const policy =
    kind === "reminder"
      ? depositPaid && cancelFreeUntil && nowIso < cancelFreeUntil
        ? `Free to cancel until ${formatReminderMoment(cancelFreeUntil, appointment.timeZone)}. After that, the deposit is kept.`
        : null
      : kind !== "canceled" && deposit > 0
        ? cancellationPolicyText(appointment.refundCutoffHours)
        : null

  const text = [
    lead,
    "",
    service,
    `${day}, ${time}`,
    ...(place ? [place] : []),
    ...(moneyLine ? ["", moneyLine] : []),
    ...(holdLine ? [holdLine] : []),
    "",
    `${button}: ${link}`,
    ...(policy ? ["", policy] : []),
    "",
    settings.businessEmail ? `Questions? Reply to this email to reach ${business}.` : "",
    `Sent with 521 on behalf of ${business}.`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")

  const e = escapeHtml
  const detailRow = (value: string, style: string) => `<tr><td style="${style}">${e(value)}</td></tr>`
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F3EF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161B1E;">
<tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:17px;font-weight:600;">${e(business)}</td></tr>
<tr><td style="padding:0 24px 20px;font-size:15px;color:#5F6864;">${e(lead)}</td></tr>
<tr><td style="padding:0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2E1DC;border-bottom:1px solid #E2E1DC;">
${detailRow(service, "padding:16px 0 4px;font-size:20px;font-weight:700;" + (kind === "canceled" ? "text-decoration:line-through;color:#5F6864;" : ""))}
${detailRow(`${day}, ${time}`, `padding:0 0 ${place ? "4px" : "16px"};font-size:15px;`)}
${place ? detailRow(place, "padding:0 0 16px;font-size:14px;color:#5F6864;") : ""}
</table></td></tr>
${moneyLine || holdLine ? `<tr><td style="padding:16px 24px 0;font-size:15px;line-height:1.5;">${[moneyLine, holdLine].filter(Boolean).map((line) => e(line!)).join("<br>")}</td></tr>` : ""}
<tr><td align="center" style="padding:24px;">
<a href="${e(link)}" style="display:inline-block;background:${accent};color:${textColorOnAccent(accent)};text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:999px;">${e(button)}</a>
</td></tr>
${policy ? `<tr><td style="padding:0 24px 24px;font-size:13px;line-height:1.5;color:#5F6864;">${e(policy)}</td></tr>` : ""}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="padding:16px 12px;font-size:12px;line-height:1.5;color:#5F6864;">
${settings.businessEmail ? `Questions? Reply to this email to reach ${e(business)}.<br>` : ""}Sent with 521 on behalf of ${e(business)}.<br>
<a href="${e(link)}" style="color:#5F6864;">${e(link)}</a>
</td></tr></table>
</td></tr></table>
</body></html>`

  return { subject, text, html }
}
