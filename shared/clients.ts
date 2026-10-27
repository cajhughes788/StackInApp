import { getIndependentCategorizedIncomeTotals } from "./independentIncome"
import { invoiceBalanceDue, invoiceDueNow, invoicePaymentEntryMutationId } from "./invoicePayments"
import { invoiceKeptAmount, invoiceKeptIn } from "./invoiceMoney"
import type { ClientPayment, ClientPaymentSummary, ClientType } from "./schemas/client"
import type { InvoiceType } from "./schemas/invoice"

/* ------------------------------------------------------------
 * CLIENTS — matching payments outside invoices to a client
 * (see shared/schemas/client.ts). Pure, shared by the backend and tests.
 * ------------------------------------------------------------ */

/** "Caj Hughes" = "caj  hughes": trimmed, spaces collapsed, lowercased. */
export function clientKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Every key that means a client: their name and aliases. */
export function clientMatchKeys(client: Pick<ClientType, "nameKey" | "aliases">): string[] {
  return [client.nameKey, ...client.aliases]
}

/** key → clientId. Active clients win a key over archived ones. */
export function buildClientKeyIndex(clients: ClientType[]): Map<string, string> {
  const index = new Map<string, string>()
  const ordered = [...clients].sort((a, b) => Number(a.archived) - Number(b.archived))
  for (const client of ordered) {
    for (const key of clientMatchKeys(client)) {
      if (!index.has(key)) index.set(key, client.id)
    }
  }
  return index
}

// The parts of a stored entry matching needs; tolerant of older documents.
export type ClientMatchEntry = {
  id?: string
  workspace?: string
  date?: string
  kind?: "income" | "refund"
  clientMutationId?: string
  payerName?: string | null
  refund?: { invoiceId?: string | null; clientName?: string | null } | null
  independent?: {
    incomeBreakdowns?: Array<Record<string, unknown>>
    customIncome?: Array<{ label?: string; amount?: number }>
  } | null
}

const INVOICE_ENTRY_PREFIX = invoicePaymentEntryMutationId("", "").replace(/_+$/, "_")

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function entryGross(entry: ClientMatchEntry): number {
  return getIndependentCategorizedIncomeTotals((entry.independent ?? undefined) as any).total
}

/**
 * Which client(s) an entry's money belongs to. Entries booked from an invoice
 * payment (and refunds of invoices) are skipped: invoices already count that
 * money, and their custom income is labelled with the client's name.
 * A payer name (Venmo import) claims the whole entry; otherwise each custom
 * income line ("Other income" named for someone) is matched on its own.
 */
export function entryClientPayments(
  entry: ClientMatchEntry,
  index: Map<string, string>
): Array<{ clientId: string; payment: ClientPayment }> {
  if (entry.workspace && entry.workspace !== "independent") return []
  if (!entry.id || !entry.date) return []
  if (entry.clientMutationId?.startsWith(INVOICE_ENTRY_PREFIX)) return []

  const make = (clientId: string, amount: number, label: string) => ({
    clientId,
    payment: { entryId: entry.id as string, date: entry.date as string, amount: round2(amount), label },
  })

  if (entry.kind === "refund") {
    if (entry.refund?.invoiceId) return []
    const name = entry.refund?.clientName ?? null
    const clientId = name ? index.get(clientKey(name)) : undefined
    return clientId ? [make(clientId, entryGross(entry), name as string)] : []
  }

  if (entry.payerName) {
    const clientId = index.get(clientKey(entry.payerName))
    if (clientId) return [make(clientId, entryGross(entry), entry.payerName)]
  }

  const out: Array<{ clientId: string; payment: ClientPayment }> = []
  for (const item of entry.independent?.customIncome ?? []) {
    if (!item.label || !Number(item.amount)) continue
    const clientId = index.get(clientKey(item.label))
    if (clientId) out.push(make(clientId, Number(item.amount), item.label))
  }
  return out
}

/** Per-client totals and payments from entries. year = "2026". */
export function summarizeClientPayments(
  clients: ClientType[],
  entries: ClientMatchEntry[],
  year: string
): {
  summaries: Record<string, ClientPaymentSummary>
  payments: Record<string, ClientPayment[]>
} {
  const index = buildClientKeyIndex(clients)
  const summaries: Record<string, ClientPaymentSummary> = {}
  const payments: Record<string, ClientPayment[]> = {}
  for (const entry of entries) {
    for (const { clientId, payment } of entryClientPayments(entry, index)) {
      const summary = (summaries[clientId] ??= { total: 0, thisYear: 0, count: 0, lastDate: null })
      summary.total = round2(summary.total + payment.amount)
      if (payment.date.startsWith(`${year}-`)) summary.thisYear = round2(summary.thisYear + payment.amount)
      if (payment.amount > 0) summary.count += 1
      if (!summary.lastDate || payment.date > summary.lastDate) summary.lastDate = payment.date
      ;(payments[clientId] ??= []).push(payment)
    }
  }
  for (const list of Object.values(payments)) list.sort((a, b) => b.date.localeCompare(a.date))
  return { summaries, payments }
}

/* ------------------------------------------------------------
 * CLIENT LIST — saved clients with their invoices and other payments
 * ------------------------------------------------------------ */

export type ClientRow = {
  // client.id, or "name:<key>" for invoices whose name matches no client.
  key: string
  client: ClientType | null
  name: string
  // Newest first, as given.
  invoices: InvoiceType[]
  // Invoice money kept (tips included, refunds out), lifetime and this year.
  invoiceEarned: number
  invoiceEarnedThisYear: number
  open: number
  overdue: number
  // Payments outside invoices (ClientPaymentSummary).
  otherPayments: number
  otherPaymentsThisYear: number
  lifetime: number
  thisYear: number
  paidInvoiceCount: number
  visitCount: number
  // 2+ paid invoices or visits.
  isRepeat: boolean
  lastActivity: string | null
}

function addCents(a: number, b: number): number {
  return (Math.round(a * 100) + Math.round(b * 100)) / 100
}

/**
 * Groups invoices under saved clients — by clientId, else by name or alias —
 * and adds what each paid outside invoices. Invoices matching no client keep
 * a row of their own (client: null). Archived clients are left out unless
 * includeArchived. Rows come back A–Z.
 */
export function buildClientRows(
  clients: ClientType[],
  payments: Record<string, ClientPaymentSummary>,
  invoices: InvoiceType[],
  today: string,
  options: { includeArchived?: boolean } = {}
): ClientRow[] {
  const year = today.slice(0, 4)
  const byId = new Map(clients.map((client) => [client.id, client]))
  const index = buildClientKeyIndex(clients)
  const rows = new Map<string, ClientRow>()

  const rowFor = (client: ClientType | null, name: string): ClientRow => {
    const key = client ? client.id : `name:${clientKey(name)}`
    let row = rows.get(key)
    if (!row) {
      const summary = client ? payments[client.id] : undefined
      row = {
        key,
        client,
        name: client?.name ?? name.trim(),
        invoices: [],
        invoiceEarned: 0,
        invoiceEarnedThisYear: 0,
        open: 0,
        overdue: 0,
        otherPayments: summary?.total ?? 0,
        otherPaymentsThisYear: summary?.thisYear ?? 0,
        lifetime: 0,
        thisYear: 0,
        paidInvoiceCount: 0,
        visitCount: summary?.count ?? 0,
        isRepeat: false,
        lastActivity: summary?.lastDate ?? null,
      }
      rows.set(key, row)
    }
    return row
  }

  for (const client of clients) rowFor(client, client.name)

  for (const invoice of invoices) {
    // A walk-in quick charge belongs to no client.
    if (invoice.quickCharge && !invoice.clientId) continue
    const linked = invoice.clientId ? byId.get(invoice.clientId) : undefined
    const matchedId = linked ? linked.id : index.get(clientKey(invoice.clientName))
    const row = rowFor(matchedId ? byId.get(matchedId) ?? null : null, invoice.clientName)
    row.invoices.push(invoice)
    if (invoice.payments.length > 0) {
      row.invoiceEarned = addCents(row.invoiceEarned, invoiceKeptAmount(invoice))
      row.invoiceEarnedThisYear = addCents(row.invoiceEarnedThisYear, invoiceKeptIn(invoice, year))
      row.paidInvoiceCount += 1
      const latest = invoice.payments.reduce<string | null>(
        (max, payment) => (!max || payment.receivedOn > max ? payment.receivedOn : max),
        null
      )
      if (latest && (!row.lastActivity || latest > row.lastActivity)) row.lastActivity = latest
    }
    if (invoice.status === "sent") {
      row.open = addCents(row.open, invoiceBalanceDue(invoice))
      const dueNow = invoiceDueNow(invoice)
      if (dueNow && dueNow.dueDate < today) row.overdue = addCents(row.overdue, dueNow.amount)
    }
  }

  const out: ClientRow[] = []
  for (const row of rows.values()) {
    if (row.client?.archived && !options.includeArchived) continue
    row.lifetime = addCents(row.invoiceEarned, row.otherPayments)
    row.thisYear = addCents(row.invoiceEarnedThisYear, row.otherPaymentsThisYear)
    row.isRepeat = row.paidInvoiceCount + row.visitCount >= 2
    out.push(row)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}
