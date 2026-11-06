import { formatInvoiceDate, formatInvoiceMoney, type InvoiceDisplayStatus } from "./invoiceDisplay"
import { QuoteSchema, type QuoteType } from "./schemas/quote"

// ---------------------------------------------------------------------------
// Quotes (shared/schemas/quote.ts): how one reads, whether the client can
// still answer it, and what the invoice made from it starts with.
// ---------------------------------------------------------------------------

// Same host as invoice links (invoiceDisplay.ts); Hosting rewrites /q/** to
// the publicQuote function.
export const PUBLIC_QUOTE_BASE_URL = "https://app.the521app.com/q/"

// A new quote is good for this long unless the owner picks another date.
export const DEFAULT_QUOTE_VALID_DAYS = 30

export function publicQuoteUrl(shareToken: string): string {
  return `${PUBLIC_QUOTE_BASE_URL}${shareToken}`
}

export function quoteNumberLabel(number: string): string {
  return `Q-${number}`
}

export function addQuoteDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Sent, and past the last day it could be accepted. */
export function quoteIsExpired(quote: Pick<QuoteType, "status" | "validUntil">, today: string): boolean {
  return quote.status === "sent" && quote.validUntil < today
}

/** Why the client can't accept or decline it now, or null when they can. */
export function quoteAnswerBlocker(quote: Pick<QuoteType, "status" | "validUntil">, today: string): string | null {
  if (quote.status === "accepted" || quote.status === "invoiced") return "This quote was already accepted."
  if (quote.status === "declined") return "This quote was declined."
  if (quote.status === "withdrawn") return "This quote was withdrawn."
  if (quote.status !== "sent") return "This quote isn't available."
  if (quoteIsExpired(quote, today)) return "This quote has expired."
  return null
}

/** The pill on the quote (in the app and on the client's page); tones as invoices'. */
export function quoteDisplayStatus(quote: QuoteType, today: string, options: { short?: boolean } = {}): InvoiceDisplayStatus {
  switch (quote.status) {
    case "draft":
      return { label: "Draft", tone: "draft" }
    case "accepted":
      return { label: "Accepted", tone: "paid" }
    case "invoiced":
      return { label: "Invoiced", tone: "closed" }
    case "declined":
      return { label: "Declined", tone: "closed" }
    case "withdrawn":
      return { label: "Withdrawn", tone: "closed" }
    case "sent": {
      if (quoteIsExpired(quote, today)) return { label: "Expired", tone: "overdue" }
      const until = formatInvoiceDate(quote.validUntil)
      return { label: options.short ? `Valid to ${until.replace(/, \d{4}$/, "")}` : `Valid until ${until}`, tone: "open" }
    }
  }
}

/** Quotes the client accepted that don't have their invoice yet (the Needs you row). */
export function quotesToInvoice(quotes: QuoteType[]): QuoteType[] {
  return quotes.filter((quote) => quote.status === "accepted" && !quote.invoiceId)
}

/** The owner's push when the client answers. */
export function quoteAnswerNotificationText(quote: QuoteType, answer: "accept" | "decline"): { title: string; body: string } {
  const what = `${quoteNumberLabel(quote.number)} · ${formatInvoiceMoney(quote.total)}`
  if (answer === "accept") return { title: `${quote.clientName} accepted your quote`, body: `${what} — turn it into an invoice` }
  const reason = quote.declineNote?.trim()
  return { title: `${quote.clientName} declined your quote`, body: reason ? `${what} · “${reason.slice(0, 120)}”` : what }
}

export type QuoteInvoicePrefill = {
  clientName: string
  clientId: string | null
  clientEmail: string
  clientPhone: string
  clientAddress: string
  lines: Array<{ description: string; quantity: number; rate: number; category: QuoteType["lines"][number]["category"] }>
  note: string
  policies: string
  depositAmount: number | null
}

/** What "Turn into invoice" fills the invoice form with: everything but the dates. */
export function quoteInvoicePrefill(quote: QuoteType): QuoteInvoicePrefill {
  return {
    clientName: quote.clientName,
    clientId: quote.clientId,
    clientEmail: quote.clientEmail ?? "",
    clientPhone: quote.clientPhone ?? "",
    clientAddress: quote.clientAddress ?? "",
    lines: quote.lines.map((line) => ({ description: line.description, quantity: line.quantity, rate: line.rate, category: line.category })),
    note: quote.note,
    policies: quote.policies,
    depositAmount: quote.deposit?.amount ?? null,
  }
}

/** Marked once its invoice is made (createInvoice with quoteId). */
export function quoteInvoiced(quote: QuoteType, invoiceId: string, nowIso: string): QuoteType {
  return QuoteSchema.parse({ ...quote, status: "invoiced", invoiceId, updatedAt: nowIso })
}

/** The invoice made from it was deleted (a draft): the quote is back where the client left it. */
export function quoteReleased(quote: QuoteType, nowIso: string): QuoteType {
  const status = quote.acceptedAt ? "accepted" : quote.declinedAt ? "declined" : quote.shareToken ? "sent" : "draft"
  return QuoteSchema.parse({ ...quote, status, invoiceId: null, updatedAt: nowIso })
}
