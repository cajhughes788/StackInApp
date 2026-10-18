import {
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceDisplayStatus,
  textColorOnAccent,
  type InvoiceDisplayStatus,
} from "./invoiceDisplay"
import { invoiceAmountPaid, invoiceBalanceDue, invoiceDueNow, invoicePaymentOptions } from "./invoicePayments"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings, type InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// The page a client sees when they open a shared invoice link
// (app.the521app.com/i/{token}, served by the publicInvoice function).
//
// Plain server-rendered HTML: no app bundle, no sign-in, works in any mail
// or messaging in-app browser. Every user-supplied string goes through
// escapeHtml — the page is public and the content is typed by whoever owns
// the workspace. "Save as PDF" is the browser's own print dialog, styled by
// the print rules below.
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function telHref(phone: string): string {
  return phone.replace(/[^\d+]/g, "")
}

const TONE_COLORS: Record<InvoiceDisplayStatus["tone"], { bg: string; fg: string }> = {
  paid: { bg: "#E3F4EA", fg: "#1E7A47" },
  open: { bg: "#ECEBE6", fg: "#161B1E" },
  overdue: { bg: "#FBE7E4", fg: "#A3261A" },
  draft: { bg: "#ECEBE6", fg: "#5B6166" },
  void: { bg: "#ECEBE6", fg: "#5B6166" },
  closed: { bg: "#ECEBE6", fg: "#5B6166" },
}

function shell(title: string, body: string, accent: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { --accent: ${accent}; --ink: #161B1E; --muted: #5B6166; --line: #E2E1DC; --page: #F4F3EF; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 2px rgba(22,27,30,.06), 0 8px 24px rgba(22,27,30,.06); }
  .bar { height: 6px; background: var(--accent); }
  .section { padding: 24px; }
  .section + .section { border-top: 1px solid var(--line); }
  .biz { display: flex; gap: 16px; align-items: center; }
  .biz img { max-width: 96px; max-height: 64px; object-fit: contain; }
  .biz-name { font-size: 18px; font-weight: 600; }
  .biz a { color: var(--muted); text-decoration: none; }
  .biz-contact { color: var(--muted); font-size: 14px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; }
  .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .lines { width: 100%; border-collapse: collapse; }
  .lines td { padding: 10px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .lines td.amt { text-align: right; white-space: nowrap; padding-left: 16px; font-variant-numeric: tabular-nums; }
  .lines tr:last-child td { border-bottom: 0; }
  .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px; }
  .due { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .note { border-left: 4px solid var(--accent); background: #FAFAF8; padding: 14px 16px; border-radius: 0 10px 10px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .banner { padding: 12px 24px; font-weight: 600; text-align: center; }
  .actions { text-align: center; margin-top: 20px; }
  .btn { display: inline-block; border: 0; border-radius: 999px; padding: 12px 22px; font: inherit; font-weight: 600; cursor: pointer;
    background: var(--accent); color: ${textColorOnAccent(accent)}; }
  .btn.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
  .btn.pay { width: 100%; padding: 15px 22px; font-size: 17px; }
  .pay-note { text-align: center; color: var(--muted); font-size: 12px; margin-top: 8px; }
  .foot { text-align: center; color: var(--muted); font-size: 12px; margin-top: 24px; }
  @media print {
    body { background: #fff; }
    .wrap { padding: 0; max-width: none; }
    .card { box-shadow: none; border-radius: 0; }
    .actions, .foot, form { display: none; }
    .bar, .pill, .note, .banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<main class="wrap">
${body}
</main>
</body>
</html>`
}

export type PublicInvoicePageOptions = {
  // Show "Pay $X" (online payments on, invoice open). payPath is where the
  // button posts: /i/{token}/pay.
  payPath?: string | null
  // Back from Stripe Checkout (?paid=1) before the webhook has marked it paid.
  justPaid?: boolean
  // Checkout offers bank transfer too (the account has ACH enabled).
  bankTransfer?: boolean
}

export function renderPublicInvoicePage(
  invoice: InvoiceType,
  settings: InvoiceSettings,
  today: string,
  options: PublicInvoicePageOptions = {}
): string {
  const accent = settings.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  const status = invoiceDisplayStatus(invoice, today)
  const tone = TONE_COLORS[status.tone]
  const businessName = settings.businessName || "Invoice"
  const balance = invoiceBalanceDue(invoice)

  const contact = [
    settings.businessEmail
      ? `<a href="mailto:${escapeHtml(settings.businessEmail)}">${escapeHtml(settings.businessEmail)}</a>`
      : "",
    settings.businessPhone
      ? `<a href="tel:${escapeHtml(telHref(settings.businessPhone))}">${escapeHtml(settings.businessPhone)}</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")

  const showPay = !!options.payPath && invoice.status === "sent" && !invoice.pendingPayment
  const paid = invoiceAmountPaid(invoice)
  // What the client pays next: the deposit while one is owed, else the rest.
  const dueNow = invoiceDueNow(invoice)
  const depositDue = dueNow?.purpose === "deposit" ? dueNow : null
  const payAmount = invoicePaymentOptions(invoice)[0]?.amount ?? balance
  const processing = invoice.status === "sent" && !!invoice.pendingPayment
  const banner =
    processing
      ? `<div class="banner" style="background:${TONE_COLORS.open.bg};color:${TONE_COLORS.open.fg}">A bank payment is on its way — it usually clears in about 4 business days.</div>`
      : options.justPaid && invoice.status === "sent"
      ? `<div class="banner" style="background:${TONE_COLORS.paid.bg};color:${TONE_COLORS.paid.fg}">Thank you — your payment is being processed.</div>`
      : invoice.status === "void"
      ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">This invoice was voided — nothing is owed.</div>`
      : invoice.status === "closed"
      ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">This invoice is closed — nothing more is owed.</div>`
      : invoice.status === "paid"
        ? `<div class="banner" style="background:${tone.bg};color:${tone.fg}">${escapeHtml(status.label)} — thank you!</div>`
        : ""

  const lines = invoice.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td class="amt">${escapeHtml(formatInvoiceMoney(line.amount))}</td></tr>`
    )
    .join("")

  const body = `<article class="card">
  <div class="bar"></div>
  ${banner}
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
      <h1>Invoice #${escapeHtml(invoice.number)}</h1>
      <span class="pill" style="background:${tone.bg};color:${tone.fg}">${escapeHtml(status.label)}</span>
    </div>
    <div class="meta">
      <div><div class="label">Billed to</div>${escapeHtml(invoice.clientName)}</div>
      <div><div class="label">Issued</div>${escapeHtml(formatInvoiceDate(invoice.issueDate))}</div>
      <div><div class="label">Due</div>${escapeHtml(formatInvoiceDate(invoice.dueDate))}</div>
    </div>
  </section>
  <section class="section">
    <table class="lines"><tbody>${lines}</tbody></table>
    <div class="total"><span>Total</span><strong>${escapeHtml(formatInvoiceMoney(invoice.total))}</strong></div>
    ${
      paid > 0 && invoice.status !== "paid"
        ? `<div class="total"><span>Paid so far</span><span>−${escapeHtml(formatInvoiceMoney(paid))}</span></div>`
        : ""
    }
  </section>
  <section class="section">
    <div class="label">${depositDue ? `Deposit due ${escapeHtml(formatInvoiceDate(depositDue.dueDate))}` : "Balance due"}</div>
    <div class="due">${escapeHtml(formatInvoiceMoney(depositDue ? depositDue.amount : balance))}</div>
    ${
      depositDue
        ? `<div class="pay-note" style="text-align:left">Then ${escapeHtml(formatInvoiceMoney(Math.max(0, Math.round((balance - depositDue.amount) * 100)) / 100))} due ${escapeHtml(formatInvoiceDate(invoice.dueDate))}</div>`
        : ""
    }
    ${
      showPay && !options.justPaid
        ? `<form method="post" action="${escapeHtml(options.payPath!)}" style="margin-top:16px">
      <button class="btn pay" type="submit">Pay ${escapeHtml(formatInvoiceMoney(payAmount))}${depositDue ? " deposit" : ""}</button>
      <div class="pay-note">${options.bankTransfer ? "Card, Apple Pay, Google Pay or bank account" : "Card, Apple Pay or Google Pay"} · secure checkout by Stripe</div>
    </form>`
        : ""
    }
  </section>
  ${
    invoice.note && invoice.status !== "void" && invoice.status !== "closed"
      ? `<section class="section"><div class="label" style="margin-bottom:8px">${invoice.status === "paid" ? "Note" : showPay ? "Other ways to pay" : "How to pay"}</div><div class="note">${escapeHtml(invoice.note)}</div></section>`
      : ""
  }
</article>
<div class="actions"><button class="btn secondary" type="button" onclick="window.print()">Save as PDF</button></div>
<p class="foot">Sent with 521</p>`

  return shell(`Invoice #${invoice.number} from ${businessName}`, body, accent)
}

export function renderPublicInvoiceNotFound(): string {
  return shell(
    "Invoice not found",
    `<article class="card"><div class="bar"></div><section class="section">
  <h1>This invoice link isn't valid</h1>
  <p style="color:var(--muted)">It may have been mistyped, or the invoice was removed. Ask the sender for a new link.</p>
</section></article>`,
    DEFAULT_INVOICE_ACCENT_COLOR
  )
}
