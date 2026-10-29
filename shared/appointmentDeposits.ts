import { formatAppointmentDate, formatBookingTime } from "./appointments"
import type { AppointmentType } from "./schemas/appointment"
import { invoiceRefundedTotal, type InvoiceType } from "./schemas/invoice"

/* ------------------------------------------------------------
 * APPOINTMENT DEPOSITS — pure rules shared by the server, the app and
 * tests (step 3 of booking).
 *
 * An appointment's money lives on an ordinary invoice, made the first time
 * a deposit arrives (paid through Stripe from the client's link, or
 * recorded by the owner) with the id appointmentInvoiceId(appointment.id).
 * One line for the service at its booked price, and the deposit as the
 * invoice's deposit, so the rest can be charged on the same invoice at the
 * appointment. Income, Stripe fees, refunds and disputes are the invoice
 * flow's.
 *
 * Canceling: the owner canceling always refunds the deposit in full. The
 * client canceling from their link gets it back up to refundCutoffHours
 * before the start; later (or a no-show), it's kept.
 * ------------------------------------------------------------ */

// Stripe's smallest card charge. A smaller deposit can only be recorded.
export const MIN_ONLINE_DEPOSIT = 0.5

export function appointmentInvoiceId(appointmentId: string): string {
  return `appt_${appointmentId}`
}

/** The deposit in dollars (a percent is of the booked price, to the cent). */
export function appointmentDepositAmount(appointment: Pick<AppointmentType, "price" | "deposit">): number {
  if (appointment.deposit.type === "fixed") return appointment.deposit.value
  if (appointment.deposit.type === "percent") return Math.round(appointment.price * appointment.deposit.value) / 100
  return 0
}

/**
 * Whether the client pays the deposit online to confirm: the business takes
 * online payments and the deposit is big enough for a card charge.
 * Otherwise the link confirms as before and the deposit is paid directly.
 */
export function appointmentDepositOnline(appointment: Pick<AppointmentType, "price" | "deposit">, onlinePayments: boolean): boolean {
  return onlinePayments && appointment.price > 0 && appointmentDepositAmount(appointment) >= MIN_ONLINE_DEPOSIT
}

export type AppointmentMoney =
  // No deposit asked, and nothing paid.
  | { kind: "none" }
  | { kind: "due"; amount: number }
  // Paid and not all given back: `amount` is what's held now.
  | { kind: "paid"; amount: number; paidOn: string }
  | { kind: "refunded"; amount: number }

/** Where the appointment's money stands, from its invoice (null until one exists). */
export function appointmentMoney(
  appointment: Pick<AppointmentType, "price" | "deposit">,
  invoice: Pick<InvoiceType, "payments" | "refunds"> | null
): AppointmentMoney {
  const paidCents = (invoice?.payments ?? []).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
  if (paidCents <= 0) {
    const amount = appointmentDepositAmount(appointment)
    return amount > 0 ? { kind: "due", amount } : { kind: "none" }
  }
  const refundedCents = Math.round(invoiceRefundedTotal(invoice ?? {}) * 100)
  if (refundedCents >= paidCents) return { kind: "refunded", amount: refundedCents / 100 }
  const latest = invoice!.payments[invoice!.payments.length - 1]
  return { kind: "paid", amount: (paidCents - refundedCents) / 100, paidOn: latest.receivedOn }
}

/** The last moment the client can cancel and get the deposit back, or null if never. */
export function appointmentRefundCutoffAt(appointment: Pick<AppointmentType, "startAt" | "refundCutoffHours">): string | null {
  if (appointment.refundCutoffHours === null) return null
  return new Date(Date.parse(appointment.startAt) - appointment.refundCutoffHours * 3_600_000).toISOString()
}

/** Whether the client canceling now gets their deposit back. */
export function clientCancelRefunds(appointment: Pick<AppointmentType, "startAt" | "refundCutoffHours">, nowIso: string): boolean {
  const cutoff = appointmentRefundCutoffAt(appointment)
  return cutoff !== null && nowIso < cutoff
}

/** Whether the client can still cancel from their link: confirmed and not yet started. */
export function clientCanCancel(appointment: Pick<AppointmentType, "status" | "startAt">, nowIso: string): boolean {
  return appointment.status === "confirmed" && nowIso < appointment.startAt
}

/** "24 hours", "3 days", "1 week". */
export function refundCutoffLabel(hours: number): string {
  if (hours === 168) return "1 week"
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} days`
  return hours === 1 ? "1 hour" : `${hours} hours`
}

/** The cancellation rule in a sentence, for the client's page and the invoice's policies. */
export function cancellationPolicyText(refundCutoffHours: number | null): string {
  if (refundCutoffHours === null) return "Deposits aren't refunded if you cancel."
  return `Free to cancel up to ${refundCutoffLabel(refundCutoffHours)} before your appointment. After that, the deposit is kept.`
}

/**
 * The invoice made for an appointment when its first deposit arrives.
 * Issued `today` (the business's date) and due on the appointment's date;
 * the deposit is due at once, since it's being paid now. A deposit of the
 * whole price is no deposit: that payment pays the invoice in full.
 */
export function appointmentInvoiceFields(
  appointment: Pick<AppointmentType, "serviceName" | "date" | "startTime" | "price" | "deposit" | "refundCutoffHours">,
  today: string
) {
  const description = `${appointment.serviceName} — ${formatAppointmentDate(appointment.date, appointment.date.slice(0, 4))} at ${formatBookingTime(appointment.startTime)}`
  const priceCents = Math.round(appointment.price * 100)
  const depositCents = Math.round(appointmentDepositAmount(appointment) * 100)
  const dueDate = appointment.date > today ? appointment.date : today
  return {
    lines: [
      {
        description: description.slice(0, 200),
        quantity: 1,
        rate: appointment.price,
        amount: appointment.price,
        category: "services" as const,
      },
    ],
    total: appointment.price,
    issueDate: today,
    dueDate,
    deposit: depositCents > 0 && depositCents < priceCents ? { amount: depositCents / 100, dueDate: today, waivedAt: null } : null,
    policies: cancellationPolicyText(appointment.refundCutoffHours),
  }
}

// Stripe keeps a Checkout session open at least this long (and at most 24 h).
export const MIN_CHECKOUT_MINUTES = 30

/**
 * When a client starts paying a waiting request's deposit: how long their
 * Checkout stays open, and the hold to save. The session closes with the
 * hold, but never sooner than Stripe allows — so a hold that would run out
 * mid-payment is stretched to the session's end (holdExpiresAt is then the
 * new hold, else null), keeping the time theirs while they pay.
 */
export function depositCheckoutWindow(holdExpiresAt: string, nowMs: number): { expiresAtSeconds: number; holdExpiresAt: string | null } {
  const nowSeconds = Math.floor(nowMs / 1000)
  const holdSeconds = Math.floor(Date.parse(holdExpiresAt) / 1000)
  // A minute's slack so Stripe's own clock doesn't see it as too soon.
  const earliest = nowSeconds + (MIN_CHECKOUT_MINUTES + 1) * 60
  const latest = nowSeconds + 23 * 3600
  const expiresAtSeconds = Math.max(earliest, Math.min(holdSeconds, latest))
  return {
    expiresAtSeconds,
    holdExpiresAt: expiresAtSeconds > holdSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : null,
  }
}
