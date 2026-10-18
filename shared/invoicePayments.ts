import type { IncomeBreakdown, IncomeCategory, PaymentMethod } from "./schemas/entry"
// Types only: shared/schemas/invoice.ts imports invoiceLedgerFields from here.
import type { InvoiceLine, InvoicePaidMethod, InvoicePayment, InvoicePaymentPurpose, InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// Invoice payment ledger — the one place payment state is worked out
// (docs/invoice-payments-architecture.md). The backend, the app, the PDF, the
// email and the public page all read through these, never the older paid*
// fields. Amounts are compared in integer cents.
// ---------------------------------------------------------------------------

type LedgerInvoice = Pick<InvoiceType, "status" | "total"> & {
  payments?: InvoicePayment[]
  deposit?: InvoiceType["deposit"]
  dueDate?: string
  pendingPayment?: InvoiceType["pendingPayment"]
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/* --------------------------------------------------------
 * Ledger operations — the only way payments change, used by the payment
 * engine on the server and by the app's instant (optimistic) updates.
 * -------------------------------------------------------- */

// The fields derived from payments and stored for Firestore queries.
export function invoiceLedgerFields(payments: InvoicePayment[]): {
  amountPaid: number
  paymentEntryIds: string[]
  paymentPlaidTransactionIds: string[]
  paymentIntentIds: string[]
  lastManualPaymentOn: string | null
} {
  return {
    amountPaid: payments.reduce((sum, payment) => sum + toCents(payment.amount), 0) / 100,
    paymentEntryIds: payments.flatMap((payment) => (payment.entryId ? [payment.entryId] : [])),
    paymentPlaidTransactionIds: payments.flatMap((payment) => (payment.plaidTransactionId ? [payment.plaidTransactionId] : [])),
    paymentIntentIds: payments.flatMap((payment) => (payment.stripePaymentIntentId ? [payment.stripePaymentIntentId] : [])),
    lastManualPaymentOn:
      payments
        .filter((payment) => payment.via === "manual")
        .map((payment) => payment.receivedOn)
        .sort()
        .pop() ?? null,
  }
}

// The invoice with this payments list: ledger fields recomputed and the
// status following the money — paid once payments cover the total, open
// (sent) while they don't. A closed invoice stays closed while it keeps a
// payment.
export function invoiceWithPayments<T extends InvoiceType>(invoice: T, payments: InvoicePayment[]): T {
  const ledger = invoiceLedgerFields(payments)
  const covered = toCents(ledger.amountPaid) >= toCents(invoice.total)
  const status: InvoiceType["status"] = covered
    ? "paid"
    : invoice.status === "closed" && payments.length > 0
      ? "closed"
      : "sent"
  return {
    ...invoice,
    ...ledger,
    payments,
    status,
    // Nothing left to pay online once it's settled.
    openCheckout: status === "sent" ? invoice.openCheckout : null,
  }
}

// What a payment of `amount` is paying, judged before it's applied.
export function invoicePaymentPurposeFor(invoice: LedgerInvoice, amount: number): InvoicePaymentPurpose {
  const cents = toCents(amount)
  if (cents === toCents(invoiceBalanceDue(invoice))) return invoiceAmountPaid(invoice) > 0 ? "balance" : "full"
  const deposit = invoiceDepositOutstanding(invoice)
  if (deposit > 0 && cents === toCents(deposit)) return "deposit"
  return "partial"
}

// The Entry payment method a payment is booked under. A check has none of
// its own: it's named "Other" income under the client.
export function entryPaymentMethodFor(method: InvoicePaidMethod): PaymentMethod {
  return method === "check" ? "other" : method
}

// Each payment's Entry is keyed by the invoice and the payment, so a retry
// finds the Entry it already made.
export function invoicePaymentEntryMutationId(invoiceId: string, paymentId: string): string {
  return `invoice_${invoiceId}_${paymentId}`
}

export function invoiceAmountPaid(invoice: { payments?: Array<{ amount: number }> }): number {
  return (invoice.payments ?? []).reduce((sum, payment) => sum + toCents(payment.amount), 0) / 100
}

export function invoiceTipsReceived(invoice: { payments?: Array<{ tipAmount?: number }> }): number {
  return (invoice.payments ?? []).reduce((sum, payment) => sum + toCents(payment.tipAmount ?? 0), 0) / 100
}

export function invoiceFeesPaid(invoice: { payments?: Array<{ feeAmount?: number }> }): number {
  return (invoice.payments ?? []).reduce((sum, payment) => sum + toCents(payment.feeAmount ?? 0), 0) / 100
}

// What the client still owes. Nothing on a paid, void or closed invoice.
export function invoiceBalanceDue(invoice: LedgerInvoice): number {
  if (invoice.status !== "sent" && invoice.status !== "draft") return 0
  return Math.max(0, toCents(invoice.total) - toCents(invoiceAmountPaid(invoice))) / 100
}

// The most recent payment (payments are kept oldest first).
export function invoiceLatestPayment(invoice: { payments?: InvoicePayment[] }): InvoicePayment | null {
  const payments = invoice.payments ?? []
  return payments.length > 0 ? payments[payments.length - 1] : null
}

export function invoiceHasPayments(invoice: { payments?: unknown[] }): boolean {
  return (invoice.payments?.length ?? 0) > 0
}

// A deposit still waiting to be paid: asked for, not waived, and not yet
// covered by what's been paid (a full payment covers it too).
export function invoiceDepositOutstanding(invoice: LedgerInvoice): number {
  const deposit = invoice.deposit
  if (!deposit || deposit.waivedAt || (invoice.status !== "sent" && invoice.status !== "draft")) return 0
  return Math.max(0, toCents(deposit.amount) - toCents(invoiceAmountPaid(invoice))) / 100
}

export type InvoiceDueNow = { purpose: "deposit" | "balance"; amount: number; dueDate: string }

// What the client owes next, and by when: the deposit while it's
// outstanding, otherwise the balance. Null when nothing is owed. A draft
// counts (its PDF and preview show what will be asked for); callers that
// mean "owed right now" check the status is sent.
export function invoiceDueNow(invoice: LedgerInvoice & { dueDate: string }): InvoiceDueNow | null {
  if (invoice.status !== "sent" && invoice.status !== "draft") return null
  const balance = invoiceBalanceDue(invoice)
  if (balance <= 0) return null
  const deposit = invoiceDepositOutstanding(invoice)
  if (deposit > 0 && invoice.deposit) return { purpose: "deposit", amount: deposit, dueDate: invoice.deposit.dueDate }
  return { purpose: "balance", amount: balance, dueDate: invoice.dueDate }
}

export type InvoicePaymentOption = { purpose: InvoicePaymentPurpose; amount: number }

// The amounts a client can pay online. Before the deposit: the deposit or
// everything. After it (or with no deposit): the rest. Nothing while a
// payment is clearing.
export function invoicePaymentOptions(invoice: LedgerInvoice & { dueDate: string }): InvoicePaymentOption[] {
  if (invoice.status !== "sent" || invoice.pendingPayment) return []
  const balance = invoiceBalanceDue(invoice)
  if (balance <= 0) return []
  const deposit = invoiceDepositOutstanding(invoice)
  if (deposit > 0 && toCents(deposit) < toCents(balance)) {
    return [
      { purpose: "deposit", amount: deposit },
      { purpose: "full", amount: balance },
    ]
  }
  return [{ purpose: invoiceAmountPaid(invoice) > 0 ? "balance" : "full", amount: balance }]
}

// The invoice's line amounts per income category, in cents.
export function invoiceCentsByCategory(lines: Array<Pick<InvoiceLine, "amount" | "category">>): Map<IncomeCategory, number> {
  const byCategory = new Map<IncomeCategory, number>()
  for (const line of lines) byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + toCents(line.amount))
  return byCategory
}

// Splits `cents` across the invoice's categories in proportion to its
// lines, the leftover on the last category so the parts add up exactly. A
// payment of the full total gets each category's own amount back.
export function splitAcrossCategories(
  lines: Array<Pick<InvoiceLine, "amount" | "category">>,
  cents: number
): Array<[IncomeCategory, number]> {
  const byCategory = [...invoiceCentsByCategory(lines)].filter(([, part]) => part > 0)
  const totalCents = byCategory.reduce((sum, [, part]) => sum + part, 0)
  if (totalCents <= 0) return [["services", cents]]
  let allocated = 0
  return byCategory.map(([category, part], index) => {
    const share = index === byCategory.length - 1 ? cents - allocated : Math.floor((cents * part) / totalCents)
    allocated += share
    return [category, share]
  })
}

// One payment as an Entry income breakdown: `amount` spread over the
// invoice's categories, the tip on "tips".
export function invoicePaymentBreakdown(
  lines: Array<Pick<InvoiceLine, "amount" | "category">>,
  amount: number,
  tipAmount: number,
  paymentMethod: PaymentMethod
): IncomeBreakdown {
  const byCategory = new Map<IncomeCategory, number>(splitAcrossCategories(lines, toCents(amount)))
  if (toCents(tipAmount) > 0) byCategory.set("tips", (byCategory.get("tips") ?? 0) + toCents(tipAmount))
  const breakdown: IncomeBreakdown = { paymentMethod }
  for (const [category, cents] of byCategory) breakdown[category] = cents / 100
  return breakdown
}

// The same payment as named custom income, for money booked under "Other"
// (a check, a bank transfer) so it shows under the client's name.
export function invoicePaymentCustomIncome(
  lines: Array<Pick<InvoiceLine, "amount" | "category">>,
  amount: number,
  tipAmount: number,
  label: string
): Array<{ label: string; amount: number; category: IncomeCategory }> {
  const breakdown = invoicePaymentBreakdown(lines, amount, tipAmount, "other")
  return (Object.entries(breakdown) as Array<[string, unknown]>)
    .filter(([key, value]) => key !== "paymentMethod" && typeof value === "number" && value > 0)
    .map(([category, value]) => ({ label, amount: value as number, category: category as IncomeCategory }))
}

// What can still be given back on one payment: its amount and tip, less
// refunds against it and money a dispute on it is holding.
export function invoicePaymentRefundable(
  invoice: Pick<InvoiceType, "payments" | "refunds" | "dispute">,
  paymentId: string
): number {
  const payment = invoice.payments.find((p) => p.id === paymentId)
  if (!payment) return 0
  const refunded = invoice.refunds
    .filter((refund) => refund.paymentId === paymentId)
    .reduce((sum, refund) => sum + toCents(refund.amount), 0)
  const dispute = invoice.dispute
  const held = dispute && dispute.paymentId === paymentId && dispute.fundsWithdrawn && dispute.status !== "won" ? toCents(dispute.amount) : 0
  return Math.max(0, toCents(payment.amount) + toCents(payment.tipAmount) - refunded - held) / 100
}

// Everything that can still be given back, across payments.
export function invoiceRefundable(invoice: Pick<InvoiceType, "payments" | "refunds" | "dispute">): number {
  return invoice.payments.reduce((sum, payment) => sum + toCents(invoicePaymentRefundable(invoice, payment.id)), 0) / 100
}

// The payment a refund comes off when none is named: the latest one with
// anything left to give back.
export function invoiceRefundTarget(invoice: Pick<InvoiceType, "payments" | "refunds" | "dispute">): InvoicePayment | null {
  for (let i = invoice.payments.length - 1; i >= 0; i--) {
    if (invoicePaymentRefundable(invoice, invoice.payments[i].id) > 0) return invoice.payments[i]
  }
  return null
}

// A refund of `cents` on one payment, spread over the categories that
// payment was booked under (its tip included) in proportion.
export function refundCentsByCategory(
  lines: Array<Pick<InvoiceLine, "amount" | "category">>,
  payment: Pick<InvoicePayment, "amount" | "tipAmount">,
  cents: number
): Array<[IncomeCategory, number]> {
  const booked = invoicePaymentBreakdown(lines, payment.amount, payment.tipAmount, "other")
  const parts = (Object.entries(booked) as Array<[string, unknown]>)
    .filter(([key, value]) => key !== "paymentMethod" && typeof value === "number" && value > 0)
    .map(([category, value]) => [category as IncomeCategory, toCents(value as number)] as [IncomeCategory, number])
  const totalCents = parts.reduce((sum, [, part]) => sum + part, 0)
  if (totalCents <= 0) return [["services", cents]]
  let allocated = 0
  return parts.map(([category, part], index) => {
    const share = index === parts.length - 1 ? cents - allocated : Math.floor((cents * part) / totalCents)
    allocated += share
    return [category, share]
  })
}

export function invoicePaymentsReceivedIn(invoice: { payments?: InvoicePayment[] }, month: string): InvoicePayment[] {
  return (invoice.payments ?? []).filter((payment) => payment.receivedOn.slice(0, 7) === month)
}
