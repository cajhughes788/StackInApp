import { formatInvoiceDate, formatInvoiceMoney, textColorOnAccent } from "./invoiceDisplay"
import { invoiceBalanceDue } from "./invoicePayments"
import { escapeHtml } from "./invoicePublicPage"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings, type InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The email 521 sends a client for an invoice (invoiceEmailService.ts).
//
// Table layout and inline styles only — mail apps ignore <style> blocks and
// most modern CSS. No images: the logo lives as a data: URL, which most mail
// apps block, so the business name stands in. Everything typed by the user
// is escaped.
// ---------------------------------------------------------------------------

export type InvoiceEmail = { subject: string; text: string; html: string }

export function buildInvoiceEmail(params: {
  invoice: InvoiceType
  settings: InvoiceSettings
  link: string
  message?: string | null
  payableOnline: boolean
}): InvoiceEmail {
  const { invoice, settings, link, payableOnline } = params
  const message = params.message?.trim() || null
  const business = settings.businessName?.trim() || "Your service provider"
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const due = formatInvoiceMoney(invoiceBalanceDue(invoice))
  const dueDate = formatInvoiceDate(invoice.dueDate)
  // Pay now goes straight to Stripe Checkout (GET /i/{token}/pay); the
  // invoice page stays one tap away.
  const payLink = payableOnline ? `${link.replace(/\/+$/, "")}/pay` : null

  const subject = `Invoice #${invoice.number} from ${business} — ${due} due ${dueDate.replace(/, \d{4}$/, "")}`

  const text = [
    `${business} sent you Invoice #${invoice.number}.`,
    "",
    `Amount due: ${due}`,
    `Due: ${dueDate}`,
    ...(message ? ["", message] : []),
    "",
    ...(payLink ? [`Pay now: ${payLink}`, ""] : []),
    `View invoice: ${link}`,
    ...(invoice.note ? ["", payableOnline ? "Other ways to pay:" : "How to pay:", invoice.note] : []),
    "",
    settings.businessEmail ? `Questions? Reply to this email to reach ${business}.` : "",
    `Sent with 521 on behalf of ${business}.`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")

  const e = escapeHtml
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F3EF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161B1E;">
<tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:17px;font-weight:600;">${e(business)}</td></tr>
<tr><td style="padding:0 24px 20px;font-size:15px;color:#5F6864;">sent you Invoice #${e(invoice.number)}</td></tr>
<tr><td style="padding:0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2E1DC;border-bottom:1px solid #E2E1DC;">
<tr><td style="padding:16px 0 4px;font-size:12px;color:#5F6864;text-transform:uppercase;letter-spacing:.04em;">Amount due</td></tr>
<tr><td style="padding:0 0 4px;font-size:30px;font-weight:700;">${e(due)}</td></tr>
<tr><td style="padding:0 0 16px;font-size:14px;color:#5F6864;">Due ${e(dueDate)}</td></tr>
</table></td></tr>
${message ? `<tr><td style="padding:20px 24px 0;font-size:15px;line-height:1.5;white-space:pre-wrap;">${e(message)}</td></tr>` : ""}
<tr><td align="center" style="padding:24px 24px ${payLink ? "8px" : "24px"};">
<a href="${e(payLink ?? link)}" style="display:inline-block;background:${accent};color:${textColorOnAccent(accent)};text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:999px;">${payLink ? `Pay ${e(due)} now` : "View invoice"}</a>
</td></tr>
${
  payLink
    ? `<tr><td align="center" style="padding:4px 24px 24px;"><a href="${e(link)}" style="display:inline-block;color:#161B1E;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:999px;border:1px solid #D6D5CF;">View invoice</a></td></tr>`
    : ""
}
${
  invoice.note
    ? `<tr><td style="padding:0 24px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF8;border-left:4px solid ${accent};"><tr><td style="padding:12px 14px;font-size:12px;color:#5F6864;text-transform:uppercase;letter-spacing:.04em;">${
        payableOnline ? "Other ways to pay" : "How to pay"
      }</td></tr><tr><td style="padding:0 14px 14px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${e(invoice.note)}</td></tr></table></td></tr>`
    : ""
}
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
