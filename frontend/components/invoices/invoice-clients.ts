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
  // Paid, less refunds and disputed money not won back.
  earned: number
  // Sent and not paid yet; overdue is the part past its due date.
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
    if (invoice.status === "paid") {
      client.earned = addMoney(client.earned, invoiceKeptAmount(invoice))
    } else if (invoice.status === "sent") {
      client.open = addMoney(client.open, invoice.total)
      if (invoice.dueDate < today) client.overdue = addMoney(client.overdue, invoice.total)
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}
