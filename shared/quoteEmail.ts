import { formatInvoiceDate, formatInvoiceMoney, textColorOnAccent } from "./invoiceDisplay"
import type { InvoiceEmail } from "./invoiceEmail"
import { escapeHtml } from "./invoicePublicPage"
import { quoteNumberLabel } from "./quotes"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "./schemas/invoice"
import type { QuoteType } from "./schemas/quote"

// ---------------------------------------------------------------------------
// The email 521 sends a client for a quote (quotesService.ts). Built like the
// invoice email (invoiceEmail.ts): table layout, inline styles, no images,
// everything typed escaped.
// ---------------------------------------------------------------------------

export function buildQuoteEmail(params: {
  quote: QuoteType
  settings: InvoiceSettings
  link: string
  message?: string | null
}): InvoiceEmail {
  const { quote, settings, link } = params
  const message = params.message?.trim() || null
  const business = settings.businessName?.trim() || "Your service provider"
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const label = quoteNumberLabel(quote.number)
  const total = formatInvoiceMoney(quote.total)
  const validUntil = formatInvoiceDate(quote.validUntil)

  const subject = `Quote ${label} from ${business} — ${total}`
  const text = [
    `${business} sent you Quote ${label}.`,
    "",
    `Total: ${total}`,
    `Valid until: ${validUntil}`,
    ...(quote.deposit ? [`Deposit up front once booked: ${formatInvoiceMoney(quote.deposit.amount)}`] : []),
    ...(message ? ["", message] : []),
    "",
    `View and accept the quote: ${link}`,
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
<tr><td style="padding:0 24px 20px;font-size:15px;color:#5F6864;">sent you Quote ${e(label)}</td></tr>
<tr><td style="padding:0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2E1DC;border-bottom:1px solid #E2E1DC;">
<tr><td style="padding:16px 0 4px;font-size:12px;color:#5F6864;text-transform:uppercase;letter-spacing:.04em;">Quote total</td></tr>
<tr><td style="padding:0 0 4px;font-size:30px;font-weight:700;">${e(total)}</td></tr>
<tr><td style="padding:0 0 16px;font-size:14px;color:#5F6864;">Valid until ${e(validUntil)}${
    quote.deposit ? ` · ${e(formatInvoiceMoney(quote.deposit.amount))} deposit up front once booked` : ""
  }</td></tr>
</table></td></tr>
${message ? `<tr><td style="padding:20px 24px 0;font-size:15px;line-height:1.5;white-space:pre-wrap;">${e(message)}</td></tr>` : ""}
<tr><td align="center" style="padding:24px;">
<a href="${e(link)}" style="display:inline-block;background:${accent};color:${textColorOnAccent(accent)};text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:999px;">View &amp; accept quote</a>
</td></tr>
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
