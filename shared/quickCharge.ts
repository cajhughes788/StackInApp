import type { InvoiceType } from "./schemas/invoice"

/* ------------------------------------------------------------
 * QUICK CHARGE → INVOICE ("They'll pay later")
 * Pure, so the server and tests share one copy. Keeps the number, link and
 * line; drops the quick-charge marker so it's a regular invoice from here
 * on (full page, workspace tip setting, reminders, overdue tracking).
 * ------------------------------------------------------------ */
export type PayLaterDetails = {
  clientName: string
  clientId: string | null
  clientEmail: string | null
  clientPhone: string | null
  dueDate: string
  defaultNote: string
  defaultPolicies: string
  nowIso: string
}

/** Why it can't be converted, or null if it can. */
export function payLaterBlocker(invoice: InvoiceType, dueDate: string): string | null {
  if (invoice.status !== "sent" || invoice.payments.length > 0 || invoice.pendingPayment) {
    return "Only an unpaid charge can be turned into an invoice."
  }
  if (dueDate < invoice.issueDate) return "Due date can't be before today."
  return null
}

export function quickChargeAsInvoice(invoice: InvoiceType, details: PayLaterDetails): InvoiceType {
  return {
    ...invoice,
    quickCharge: null,
    clientName: details.clientName,
    clientId: details.clientId,
    clientEmail: details.clientEmail,
    clientPhone: details.clientPhone,
    dueDate: details.dueDate,
    note: invoice.note || details.defaultNote,
    policies: invoice.policies || details.defaultPolicies,
    // Its open Checkout was card-only for the counter; the next Pay makes a new one.
    openCheckout: null,
    updatedAt: details.nowIso,
  }
}
