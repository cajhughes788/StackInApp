import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoicePhone,
  formatInvoiceQuantity,
  invoiceDisplayStatus,
  textColorOnAccent,
  type InvoiceDisplayStatus,
} from "./invoiceDisplay"
import {
  INVOICE_TIP_PRESETS,
  invoiceAmountPaid,
  invoiceBalanceDue,
  invoiceDueNow,
  invoicePaymentOptions,
  type InvoicePaymentOption,
} from "./invoicePayments"
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
  .biz { display: flex; gap: 16px; align-items: flex-start; }
  .biz > div { min-width: 0; }
  .biz img { max-width: 96px; max-height: 64px; object-fit: contain; flex-shrink: 0; }
  .biz-name { font-size: 18px; font-weight: 600; }
  .biz a { color: var(--muted); text-decoration: none; }
  .biz-contact { color: var(--muted); font-size: 14px; line-height: 1.45; margin-top: 2px; }
  .biz-contact a { display: block; }
  .biz-contact .email { overflow-wrap: anywhere; }
  .biz-contact .phone { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .address { white-space: pre-line; }
  .meta .sub { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
  .qty { color: var(--muted); font-size: 13px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .policies { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 14px; line-height: 1.5; }
  @media (max-width: 480px) {
    .biz { gap: 12px; }
    .biz img { max-width: 64px; max-height: 48px; }
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  /* Billed to on its own row, the dates side by side — three across on wider screens. */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 16px; }
  .meta .billed { grid-column: 1 / -1; overflow-wrap: anywhere; }
  @media (min-width: 560px) {
    .meta { grid-template-columns: 2fr 1fr 1fr; }
    .meta .billed { grid-column: auto; }
  }
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
  .muted { color: var(--muted); font-weight: 400; }
  .choice { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
  .choice:disabled { opacity: .45; }
  .opt { display: flex; gap: 10px; align-items: center; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; margin-top: 8px; cursor: pointer; }
  .opt:has(input:checked) { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .opt strong { margin-left: auto; font-variant-numeric: tabular-nums; }
  .tipgrid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
  .tip { position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; font-size: 14px; cursor: pointer; text-align: center; }
  .tip input { position: absolute; opacity: 0; pointer-events: none; }
  .tip:has(input:checked) { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); font-weight: 600; }
  .tip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .custom { display: none; width: 100%; margin-top: 8px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; font: inherit; }
  .tips:has(input[value="custom"]:checked) .custom { display: block; }
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

const PURPOSE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  full: "Pay in full",
  partial: "Payment",
}

// The amounts the client can pay: one hidden choice, or radio buttons for
// the deposit or everything. data-amount (cents) feeds the button label.
function renderPayChoices(invoice: InvoiceType, payOptions: InvoicePaymentOption[]): string {
  if (payOptions.length === 1) {
    const [only] = payOptions
    return `<input type="hidden" name="purpose" value="${escapeHtml(only.purpose)}" data-amount="${Math.round(only.amount * 100)}">`
  }
  const choices = payOptions
    .map((option, index) => {
      const due = option.purpose === "deposit" && invoice.deposit ? ` <span class="muted">due ${escapeHtml(formatInvoiceDate(invoice.deposit.dueDate))}</span>` : ""
      return `<label class="opt"><input type="radio" name="purpose" value="${escapeHtml(option.purpose)}" data-amount="${Math.round(option.amount * 100)}"${
        index === 0 ? " checked" : ""
      }><span>${escapeHtml(PURPOSE_LABELS[option.purpose] ?? "Payment")}${due}</span><strong>${escapeHtml(formatInvoiceMoney(option.amount))}</strong></label>`
    })
    .join("")
  return `<fieldset class="choice"><legend class="label">How much are you paying?</legend>${choices}</fieldset>`
}

function renderTipPicker(onlyWhenPayingInFull: boolean): string {
  const presets = INVOICE_TIP_PRESETS.map(
    (percent) => `<label class="tip"><input type="radio" name="tip" value="${percent}"><span>${percent}%</span></label>`
  ).join("")
  return `<fieldset class="choice tips" id="tips"><legend class="label">${
    onlyWhenPayingInFull ? "Add a tip <span class=\"muted\">(when paying in full)</span>" : "Add a tip"
  }</legend><div class="tipgrid"><label class="tip"><input type="radio" name="tip" value="0" checked><span>No tip</span></label>${presets}<label class="tip"><input type="radio" name="tip" value="custom"><span>Other</span></label></div><input class="custom" name="customTip" inputmode="decimal" autocomplete="off" placeholder="Tip amount, e.g. 50" aria-label="Tip amount"></fieldset>`
}

// Keeps the Pay button's amount in step with the choices (the form works
// without it — the server works the amounts out either way).
const PAY_FORM_SCRIPT = `<script>
(function () {
  var form = document.getElementById("payform");
  var button = document.getElementById("paybtn");
  if (!form || !button) return;
  var tips = document.getElementById("tips");
  function money(cents) { return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function update() {
    var chosen = form.querySelector('input[name="purpose"]:checked') || form.querySelector('input[name="purpose"]');
    var amount = Number(chosen.getAttribute("data-amount")) || 0;
    var isDeposit = chosen.value === "deposit";
    var tip = 0;
    if (tips) {
      tips.disabled = isDeposit;
      var pick = form.querySelector('input[name="tip"]:checked');
      if (!isDeposit && pick) {
        if (pick.value === "custom") {
          var typed = Math.round(Number((form.customTip.value || "").replace(/[$,\\s]/g, "")) * 100);
          tip = typed > 0 && typed <= amount ? typed : 0;
        } else {
          tip = Math.round(amount * Number(pick.value) / 100) || 0;
        }
      }
    }
    button.textContent = "Pay " + money(amount + tip) + (isDeposit ? " deposit" : "");
  }
  form.addEventListener("change", update);
  form.addEventListener("input", update);
  update();
})();
</script>`

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

  // One line each, so a phone number never breaks across lines on a phone.
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

  const showPay = !!options.payPath && invoice.status === "sent" && !invoice.pendingPayment
  const paid = invoiceAmountPaid(invoice)
  // What the client pays next: the deposit while one is owed, else the rest.
  const dueNow = invoiceDueNow(invoice)
  const depositDue = dueNow?.purpose === "deposit" ? dueNow : null
  // What the client can pay online, and whether a tip is asked for (only on
  // a payment that finishes the invoice).
  const payOptions = invoicePaymentOptions(invoice)
  const payAmount = payOptions[0]?.amount ?? balance
  const showTips = !!settings.offerTips && payOptions.some((o) => o.purpose === "balance" || o.purpose === "full")
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
        `<tr><td>${escapeHtml(line.description)}${
          line.quantity !== 1
            ? `<div class="qty">${escapeHtml(formatInvoiceQuantity(line.quantity))} × ${escapeHtml(formatInvoiceMoney(line.rate))}</div>`
            : ""
        }</td><td class="amt">${escapeHtml(formatInvoiceMoney(line.amount))}</td></tr>`
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
        ${contact || businessAddress ? `<div class="biz-contact">${contact}${businessAddress ? `<div class="address">${escapeHtml(businessAddress)}</div>` : ""}</div>` : ""}
      </div>
    </div>
  </section>
  <section class="section">
    <div class="head">
      <h1>Invoice #${escapeHtml(invoice.number)}</h1>
      <span class="pill" style="background:${tone.bg};color:${tone.fg}">${escapeHtml(status.label)}</span>
    </div>
    <div class="meta">
      <div class="billed"><div class="label">Billed to</div>${escapeHtml(invoice.clientName)}${
        invoice.clientEmail ? `<div class="sub">${escapeHtml(invoice.clientEmail)}</div>` : ""
      }${invoice.clientAddress ? `<div class="sub address">${escapeHtml(invoice.clientAddress)}</div>` : ""}</div>
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
      showPay && !options.justPaid && payOptions.length > 0
        ? `<form method="post" action="${escapeHtml(options.payPath!)}" id="payform" style="margin-top:16px">
      ${renderPayChoices(invoice, payOptions)}
      ${showTips ? renderTipPicker(payOptions.length > 1) : ""}
      <button class="btn pay" type="submit" id="paybtn">Pay ${escapeHtml(formatInvoiceMoney(payAmount))}${depositDue ? " deposit" : ""}</button>
      <div class="pay-note">${options.bankTransfer ? "Card, Apple Pay, Google Pay or bank account" : "Card, Apple Pay or Google Pay"} · secure checkout by Stripe</div>
    </form>
    ${PAY_FORM_SCRIPT}`
        : ""
    }
  </section>
  ${
    invoice.note && invoice.status !== "void" && invoice.status !== "closed"
      ? `<section class="section"><div class="label" style="margin-bottom:8px">${invoice.status === "paid" ? "Note" : showPay ? "Other ways to pay" : "How to pay"}</div><div class="note">${escapeHtml(invoice.note)}</div></section>`
      : ""
  }
  ${
    invoice.policies && invoice.status !== "void"
      ? `<section class="section"><div class="label" style="margin-bottom:8px">Policies &amp; terms</div><div class="policies">${escapeHtml(invoice.policies)}</div></section>`
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
