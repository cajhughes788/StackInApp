import { invoiceAmountPaid, invoiceTipsReceived } from "./invoicePayments"
import { invoiceRefundedTotal, type InvoiceType } from "./schemas/invoice"

type KeptInvoice = Pick<InvoiceType, "payments" | "refunds" | "dispute">

function disputedOutstanding(invoice: KeptInvoice): number {
  const dispute = invoice.dispute
  return dispute && dispute.fundsWithdrawn && dispute.status !== "won" ? dispute.amount : 0
}

// Money the user still has from this invoice: what was paid (tips
// included), less refunds and any disputed money not won back.
export function invoiceKeptAmount(invoice: KeptInvoice): number {
  const received = Math.round(invoiceAmountPaid(invoice) * 100) + Math.round(invoiceTipsReceived(invoice) * 100)
  return (received - Math.round(invoiceRefundedTotal(invoice) * 100) - Math.round(disputedOutstanding(invoice) * 100)) / 100
}

// The same, counting only money that moved in `year` ("2026"): payments by
// the day received, refunds by their date, a dispute by its payment's date.
export function invoiceKeptIn(invoice: KeptInvoice, year: string): number {
  const inYear = (date: string | null | undefined) => !!date && date.startsWith(`${year}-`)
  let cents = 0
  for (const payment of invoice.payments ?? []) {
    if (inYear(payment.receivedOn)) cents += Math.round(payment.amount * 100) + Math.round((payment.tipAmount ?? 0) * 100)
  }
  for (const refund of invoice.refunds ?? []) {
    if (inYear(refund.date)) cents -= Math.round(refund.amount * 100)
  }
  const disputed = disputedOutstanding(invoice)
  if (disputed > 0) {
    const payment = (invoice.payments ?? []).find((p) => p.id === invoice.dispute?.paymentId)
    if (inYear(payment?.receivedOn)) cents -= Math.round(disputed * 100)
  }
  return cents / 100
}
