import { DateTime } from "luxon"

import { appointmentInvoiceFields } from "./appointmentDeposits"
import { formatInvoiceMoney } from "./invoiceDisplay"
import { invoiceAmountPaid, invoiceBalanceDue } from "./invoicePayments"
import type { AppointmentExtra, AppointmentType } from "./schemas/appointment"
import { invoiceTotalFromLines, type InvoiceType } from "./schemas/invoice"

/* ------------------------------------------------------------
 * FINISH & GET PAID — step 5 of booking: pure rules shared by the server,
 * the app and tests.
 *
 * At the appointment the owner charges what's left: the service price, plus
 * any extras, minus a discount, minus what's already paid (the deposit).
 * It all goes on the appointment's invoice (appt_{id}), made then if no
 * deposit made it earlier, so the money books itself as income like any
 * paid invoice.
 * ------------------------------------------------------------ */

type FinishAppointment = Pick<
  AppointmentType,
  "serviceName" | "date" | "startTime" | "price" | "deposit" | "refundCutoffHours"
>
type LineInvoice = Pick<InvoiceType, "payments" | "refunds" | "status" | "total"> | null

const toCents = (amount: number) => Math.round(amount * 100)

/**
 * The invoice lines for finishing: the service (less the discount), then
 * each extra. An error when the discount is more than the service, or
 * nothing is left to charge.
 */
export function appointmentFinishLines(
  appointment: FinishAppointment,
  extras: AppointmentExtra[],
  discount: number
): { lines: InvoiceType["lines"]; total: number } | { error: string } {
  const [service] = appointmentInvoiceFields(appointment, appointment.date).lines
  const serviceCents = toCents(appointment.price) - toCents(discount)
  if (serviceCents < 0) return { error: `The discount can't be more than the ${formatInvoiceMoney(appointment.price)} service.` }
  const lines: InvoiceType["lines"] = []
  if (serviceCents > 0) {
    const amount = serviceCents / 100
    const description = discount > 0 ? `${service.description} (${formatInvoiceMoney(discount)} off)` : service.description
    lines.push({ ...service, description: description.slice(0, 200), rate: amount, amount })
  }
  for (const extra of extras) {
    const amount = toCents(extra.amount) / 100
    lines.push({ description: extra.description.trim().slice(0, 200), quantity: 1, rate: amount, amount, category: "services" })
  }
  if (lines.length === 0) return { error: "That leaves nothing to charge. Use Finish without charging instead." }
  return { lines, total: invoiceTotalFromLines(lines) }
}

export type AppointmentFinishSummary =
  | { ok: true; total: number; paid: number; due: number }
  | { ok: false; error: string; total: number; paid: number }

/** What the client owes today, after extras, the discount and what's already paid. */
export function appointmentFinishSummary(
  appointment: FinishAppointment,
  invoice: LineInvoice,
  extras: AppointmentExtra[],
  discount: number
): AppointmentFinishSummary {
  const paid = invoice ? invoiceAmountPaid(invoice) : 0
  const built = appointmentFinishLines(appointment, extras, discount)
  if ("error" in built) return { ok: false, error: built.error, total: Math.max(0, appointment.price - discount), paid }
  const due = (toCents(built.total) - toCents(paid)) / 100
  if (due <= 0) {
    return {
      ok: false,
      error: `That's no more than the ${formatInvoiceMoney(paid)} already paid. Use Finish without charging instead.`,
      total: built.total,
      paid,
    }
  }
  return { ok: true, total: built.total, paid, due }
}

/** What's left to collect before any extras or discount: the price less what's paid. */
export function appointmentLeftToPay(appointment: Pick<AppointmentType, "price">, invoice: LineInvoice): number {
  const paid = invoice ? invoiceAmountPaid(invoice) : 0
  return Math.max(0, toCents(appointment.price) - toCents(paid)) / 100
}

/**
 * Whether "Finish & get paid" shows: a confirmed appointment from its day
 * on (in the business's time zone), or one already finished whose money is
 * still open (to switch how it's paid).
 */
export function appointmentCanFinish(
  appointment: Pick<AppointmentType, "status" | "date" | "timeZone">,
  invoice: Pick<InvoiceType, "payments" | "refunds" | "status" | "total"> | null,
  nowIso: string
): boolean {
  if (appointment.status === "completed") return !!invoice && invoice.status === "sent" && invoiceBalanceDue(invoice) > 0
  if (appointment.status !== "confirmed") return false
  const today = DateTime.fromISO(nowIso, { zone: appointment.timeZone || "UTC" }).toISODate() ?? nowIso.slice(0, 10)
  return appointment.date <= today
}

/**
 * For Needs you: an appointment whose time is over but nobody finished it,
 * or one finished by QR code that the client never paid.
 */
export function appointmentNeedsPayment(
  appointment: Pick<AppointmentType, "status" | "endAt">,
  invoice: Pick<InvoiceType, "payments" | "refunds" | "status" | "total" | "quickCharge"> | null,
  nowIso: string
): boolean {
  if (appointment.status === "confirmed") return appointment.endAt <= nowIso
  if (appointment.status === "completed") {
    return !!invoice?.quickCharge && invoice.status === "sent" && invoiceBalanceDue(invoice) > 0
  }
  return false
}

/**
 * The extras and discount an earlier finish put on the invoice, so the
 * screen opens with them when the owner comes back to switch how it's paid.
 */
export function appointmentFinishFromInvoice(
  appointment: FinishAppointment,
  invoice: Pick<InvoiceType, "lines"> | null
): { extras: AppointmentExtra[]; discount: number } {
  if (!invoice) return { extras: [], discount: 0 }
  const [service] = appointmentInvoiceFields(appointment, appointment.date).lines
  const first = invoice.lines[0]
  const hasService = !!first && first.description.startsWith(service.description)
  const discount = (toCents(appointment.price) - (hasService ? toCents(first.amount) : 0)) / 100
  const extras = invoice.lines.slice(hasService ? 1 : 0).map((line) => ({ description: line.description, amount: line.amount }))
  return { extras, discount: Math.max(0, discount) }
}
