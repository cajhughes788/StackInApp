import { invoiceAmountPaid, invoiceBalanceDue, invoiceLatestPayment } from "./invoicePayments"
import { invoiceRefundedTotal, type InvoiceTerms, type InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// Invoice display helpers
//
// Shared by the PDF (built on the device, frontend/lib/invoicePdf.ts) and the
// public invoice page (rendered by the publicInvoice function), so both
// show the same status, dates and amounts.
// ---------------------------------------------------------------------------

// Shared invoice links: the hosting site rewrites /i/** to the publicInvoice
// function. app.the521app.com is a custom domain on the same hosting site,
// so links already sent on stackin.web.app keep working.
export const PUBLIC_INVOICE_BASE_URL = "https://app.the521app.com/i/"

export function publicInvoiceUrl(shareToken: string): string {
  return `${PUBLIC_INVOICE_BASE_URL}${shareToken}`
}

export const INVOICE_TERMS_LABELS: Record<InvoiceTerms, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Due in 15 days",
  net_30: "Due in 30 days",
}

const TERMS_DAYS: Record<InvoiceTerms, number> = { due_on_receipt: 0, net_15: 15, net_30: 30 }

function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00Z`)
}

export function dueDateForTerms(issueDate: string, terms: InvoiceTerms): string {
  const due = parseDay(issueDate)
  due.setUTCDate(due.getUTCDate() + TERMS_DAYS[terms])
  return due.toISOString().slice(0, 10)
}

const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatInvoiceMoney(amount: number): string {
  return moneyFormat.format(Math.round(amount * 100) / 100)
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

// "2026-10-15" → "Oct 15, 2026", independent of the viewer's time zone.
export function formatInvoiceDate(date: string): string {
  return dateFormat.format(parseDay(date))
}

export type InvoiceDisplayStatus = {
  label: string
  tone: "paid" | "overdue" | "open" | "draft" | "void" | "closed"
}

// `today` is a YYYY-MM-DD in the business's local time; the caller decides.
export function invoiceDisplayStatus(
  invoice: Pick<InvoiceType, "status" | "dueDate"> & Partial<Pick<InvoiceType, "total" | "refunds" | "dispute" | "payments">>,
  today: string
): InvoiceDisplayStatus {
  if (invoice.status === "paid" && (invoice.dispute?.status === "open" || invoice.dispute?.status === "inquiry")) {
    return { label: "Disputed", tone: "overdue" }
  }
  const refunded = invoiceRefundedTotal(invoice)
  if (invoice.status === "paid" && refunded > 0) {
    const fully = Math.round(refunded * 100) >= Math.round((invoice.total ?? 0) * 100)
    return { label: fully ? "Refunded" : "Paid · partly refunded", tone: "paid" }
  }
  switch (invoice.status) {
    case "paid": {
      const latest = invoiceLatestPayment(invoice)
      return { label: latest ? `Paid ${formatInvoiceDate(latest.receivedOn)}` : "Paid", tone: "paid" }
    }
    case "void":
      return { label: "Void", tone: "void" }
    case "closed":
      return { label: invoiceAmountPaid(invoice) > 0 ? `Closed · ${formatInvoiceMoney(invoiceAmountPaid(invoice))} kept` : "Closed", tone: "closed" }
    case "draft":
      return { label: "Draft", tone: "draft" }
    case "sent":
      if (invoice.total !== undefined && invoiceAmountPaid(invoice) > 0) {
        const balance = invoiceBalanceDue({ status: invoice.status, total: invoice.total, payments: invoice.payments })
        return {
          label: `Partly paid · ${formatInvoiceMoney(balance)} due`,
          tone: invoice.dueDate < today ? "overdue" : "open",
        }
      }
      if (invoice.dueDate < today) return { label: `Overdue since ${formatInvoiceDate(invoice.dueDate)}`, tone: "overdue" }
      if (invoice.dueDate === today) return { label: "Due today", tone: "open" }
      return { label: `Due ${formatInvoiceDate(invoice.dueDate)}`, tone: "open" }
  }
}


// "Invoice-0012-Acme-Corp.pdf" — safe on every OS and share target.
export function invoiceFileName(invoice: Pick<InvoiceType, "number" | "clientName">): string {
  const client = invoice.clientName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return `Invoice-${invoice.number}${client ? `-${client}` : ""}.pdf`
}

// Black or white text, whichever reads better on the accent color (WCAG
// relative luminance). The default green takes dark text.
export function textColorOnAccent(hex: string): "#FFFFFF" | "#161B1E" {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.179 ? "#161B1E" : "#FFFFFF"
}
