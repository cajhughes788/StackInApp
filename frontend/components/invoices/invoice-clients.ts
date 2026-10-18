import { invoiceBalanceDue, invoiceDueNow } from "@shared/invoicePayments"
import type { InvoiceType } from "@shared/schemas/invoice"

import { invoiceKeptAmount } from "@/components/invoices/invoice-money"

// Invoices only store the typed client name, so a client is every invoice
// whose name matches ignoring case and spacing ("Caj Hughes" = "caj  hughes").
export function clientKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export type InvoiceClient = {
  key: string
  // As typed on their latest invoice.
  name: string
  // Newest first, voided ones included for the record.
  invoices: InvoiceType[]
  // Received (any payment, tips included), less refunds and disputed money
  // not won back.
  earned: number
  // Still owed on open invoices; overdue is the part past its due date.
  open: number
  overdue: number
}

function addMoney(a: number, b: number): number {
  return (Math.round(a * 100) + Math.round(b * 100)) / 100
}

// Expects invoices newest first (as the invoices store keeps them); clients
// come back A–Z.
export function groupInvoicesByClient(invoices: InvoiceType[], today: string): InvoiceClient[] {
  const byKey = new Map<string, InvoiceClient>()
  for (const invoice of invoices) {
    const key = clientKey(invoice.clientName)
    let client = byKey.get(key)
    if (!client) {
      client = { key, name: invoice.clientName.trim(), invoices: [], earned: 0, open: 0, overdue: 0 }
      byKey.set(key, client)
    }
    client.invoices.push(invoice)
    if (invoice.payments.length > 0) client.earned = addMoney(client.earned, invoiceKeptAmount(invoice))
    if (invoice.status === "sent") {
      client.open = addMoney(client.open, invoiceBalanceDue(invoice))
      // What's late: an overdue deposit, or the rest once it's past due.
      const dueNow = invoiceDueNow(invoice)
      if (dueNow && dueNow.dueDate < today) client.overdue = addMoney(client.overdue, dueNow.amount)
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}
