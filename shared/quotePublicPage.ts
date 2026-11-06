import { formatInvoiceDate, formatInvoiceMoney, formatInvoicePhone, formatInvoiceQuantity } from "./invoiceDisplay"
import { TONE_COLORS, escapeHtml, pageFoot, shell, telHref } from "./invoicePublicPage"
import { quoteAnswerBlocker, quoteDisplayStatus, quoteNumberLabel } from "./quotes"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "./schemas/invoice"
import type { QuoteType } from "./schemas/quote"

// ---------------------------------------------------------------------------
// The page a client sees when they open a shared quote link
// (app.the521app.com/q/{token}, served by the publicQuote function). Same
// frame and rules as the invoice page (invoicePublicPage.ts): plain HTML,
// every typed string escaped. Accept and Decline are plain form posts — no
// script — and the decline note sits in a <details> that opens without one.
// ---------------------------------------------------------------------------

export type PublicQuotePageOptions = {
  // Where Accept and Decline post: /q/{token}/answer.
  answerPath: string
  // Back from answering (?answered=1).
  justAnswered?: boolean
  // A problem with what they sent (no name typed), shown above the form.
  error?: string | null
}

export function renderPublicQuotePage(
  quote: QuoteType,
  settings: InvoiceSettings,
  today: string,
  options: PublicQuotePageOptions
): string {
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const status = quoteDisplayStatus(quote, today)
  const tone = TONE_COLORS[status.tone]
  const businessName = settings.businessName || "Quote"
  const label = quoteNumberLabel(quote.number)
  const blocker = quoteAnswerBlocker(quote, today)

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
  const businessAddress = settings.businessAddress?.trim()
  const reachOut = settings.businessPhone || settings.businessEmail ? ` — contact ${escapeHtml(businessName)} if you'd like a new one` : ""

  const banner =
    quote.status === "accepted" || quote.status === "invoiced"
      ? `<div class="banner" style="background:${TONE_COLORS.paid.bg};color:${TONE_COLORS.paid.fg}">${
          options.justAnswered ? "Thank you — you accepted this quote" : "Accepted"
        }${!options.justAnswered && quote.acceptedName ? ` by ${escapeHtml(quote.acceptedName)}` : ""}${
          quote.acceptedAt ? ` on ${escapeHtml(formatInvoiceDate(quote.acceptedAt.slice(0, 10)))}` : ""
        }. ${escapeHtml(businessName)} will be in touch.</div>`
      : quote.status === "declined"
        ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">${
            options.justAnswered ? `Thanks for letting ${escapeHtml(businessName)} know.` : "This quote was declined."
          }</div>`
        : quote.status === "withdrawn"
          ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">This quote was withdrawn${reachOut}.</div>`
          : status.tone === "overdue"
            ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">This quote expired on ${escapeHtml(formatInvoiceDate(quote.validUntil))}${reachOut}.</div>`
            : ""

  const lines = quote.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}${
          line.quantity !== 1
            ? `<div class="qty">${escapeHtml(formatInvoiceQuantity(line.quantity))} × ${escapeHtml(formatInvoiceMoney(line.rate))}</div>`
            : ""
        }</td><td class="amt">${escapeHtml(formatInvoiceMoney(line.amount))}</td></tr>`
    )
    .join("")

  const answerForm = blocker
    ? ""
    : `<section class="section">
    ${options.error ? `<p class="banner" style="margin:0 0 16px;border-radius:10px;background:${TONE_COLORS.overdue.bg};color:${TONE_COLORS.overdue.fg}">${escapeHtml(options.error)}</p>` : ""}
    <form method="post" action="${escapeHtml(options.answerPath)}">
      <input type="hidden" name="answer" value="accept">
      <label class="label" for="accept-name" style="display:block;margin-bottom:6px">Type your name to accept</label>
      <input class="custom" style="display:block;margin-top:0" id="accept-name" name="name" required maxlength="80" autocomplete="name" placeholder="Your full name">
      <button class="btn pay" type="submit" style="margin-top:12px">Accept quote · ${escapeHtml(formatInvoiceMoney(quote.total))}</button>
      <div class="pay-note">By accepting, you agree to the price${quote.policies ? " and terms" : ""} above. Nothing is charged now.</div>
    </form>
    <details style="margin-top:16px">
      <summary style="cursor:pointer;color:var(--muted);text-align:center">Decline this quote</summary>
      <form method="post" action="${escapeHtml(options.answerPath)}" style="margin-top:12px">
        <input type="hidden" name="answer" value="decline">
        <label class="label" for="decline-note" style="display:block;margin-bottom:6px">Why? <span class="muted">(optional)</span></label>
        <textarea class="custom" style="display:block;margin-top:0;min-height:72px" id="decline-note" name="note" maxlength="500" placeholder="e.g. Went with someone else"></textarea>
        <button class="btn secondary" type="submit" style="margin-top:12px;width:100%">Decline quote</button>
      </form>
    </details>
  </section>`

  const body = `<article class="card">
  <div class="bar"></div>
  ${banner}
  <section class="section">
    <div class="biz">
      ${settings.logoDataUrl ? `<img src="${escapeHtml(settings.logoDataUrl)}" alt="">` : ""}
      <div>
        <div class="biz-name">${escapeHtml(businessName)}</div>
        ${contact || businessAddress ? `<div class="biz-contact">${contact}${businessAddress ? `<div class="address">${escapeHtml(businessAddress)}</div>` : ""}</div>` : ""}
      </div>
    </div>
  </section>
  <section class="section">
    <div class="head">
      <h1>Quote ${escapeHtml(label)}</h1>
      <span class="pill" style="background:${tone.bg};color:${tone.fg}">${escapeHtml(status.label)}</span>
    </div>
    <div class="meta">
      <div class="billed"><div class="label">Prepared for</div>${escapeHtml(quote.clientName)}${
        quote.clientEmail ? `<div class="sub">${escapeHtml(quote.clientEmail)}</div>` : ""
      }${quote.clientAddress ? `<div class="sub address">${escapeHtml(quote.clientAddress)}</div>` : ""}</div>
      <div><div class="label">Date</div>${escapeHtml(formatInvoiceDate(quote.issueDate))}</div>
      <div><div class="label">Valid until</div>${escapeHtml(formatInvoiceDate(quote.validUntil))}</div>
    </div>
  </section>
  <section class="section">
    <table class="lines"><tbody>${lines}</tbody></table>
    <div class="total"><span>Total</span><span class="due" style="font-size:24px">${escapeHtml(formatInvoiceMoney(quote.total))}</span></div>
    ${
      quote.deposit
        ? `<div class="pay-note" style="text-align:left">A ${escapeHtml(formatInvoiceMoney(quote.deposit.amount))} deposit is asked for up front once the work is booked.</div>`
        : ""
    }
  </section>
  ${quote.note ? `<section class="section"><div class="label" style="margin-bottom:8px">Note</div><div class="note">${escapeHtml(quote.note)}</div></section>` : ""}
  ${
    quote.policies
      ? `<section class="section"><div class="label" style="margin-bottom:8px">Policies &amp; terms</div><div class="policies">${escapeHtml(quote.policies)}</div></section>`
      : ""
  }
  ${answerForm}
</article>
<div class="actions"><button class="btn secondary" type="button" onclick="window.print()">Save as PDF</button></div>
${pageFoot("Sent with 521")}`

  return shell(`Quote ${label} from ${businessName}`, body, accent)
}

export function renderPublicQuoteNotFound(): string {
  return shell(
    "Quote not found",
    `<article class="card"><div class="bar"></div><section class="section">
  <h1>This quote link isn't valid</h1>
  <p style="color:var(--muted)">It may have been mistyped, or the quote was removed. Ask the sender for a new link.</p>
</section></article>`,
    DEFAULT_INVOICE_ACCENT_COLOR
  )
}
