import { DateTime } from "luxon"
import { db } from "../admin"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import { appointmentsCol, parseAppointment } from "./appointmentsService"
import { counterDoc, formatInvoiceNumber, invoicesCol, shareInvoice } from "./invoicesService"
import { onlinePaymentsOn } from "./appointmentDepositsService"
import { appointmentInvoiceFields, appointmentInvoiceId } from "@shared/appointmentDeposits"
import { appointmentFinishLines, appointmentFinishSummary } from "@shared/appointmentCheckout"
import { appointmentStatus } from "@shared/appointments"
import { invoiceBalanceDue, invoicePaymentPurposeFor } from "@shared/invoicePayments"
import { AppointmentSchema, type AppointmentAction, type AppointmentType } from "@shared/schemas/appointment"
import { InvoiceSchema, type InvoiceType } from "@shared/schemas/invoice"

// ---------------------------------------------------------------------------
// Finish & get paid — step 5 of booking (shared/appointmentCheckout.ts).
//
// Puts what's left (the service, extras, less a discount and what's already
// paid) on the appointment's invoice, marks the appointment done, then takes
// the money the owner picked:
// - qr: the invoice becomes a quick-charge pay screen (cards and wallets, the
//   owner's tip choice) that the client opens from a QR code.
// - paid: recorded as paid another way, with any tip.
// - later: a regular invoice due today, emailed to the client when there's an
//   address, with the usual automatic reminders.
// Repeating it while the invoice is unpaid switches how it's paid.
// ---------------------------------------------------------------------------

type FinishAction = Extract<AppointmentAction, { action: "finish" }>

export type FinishResult = {
  appointment: AppointmentType
  invoice: InvoiceType
  // The invoice's public link: the QR code, or the link to share.
  shareUrl: string
  emailedTo: string | null
}

function businessToday(timeZone: string): string {
  return DateTime.now().setZone(timeZone).toISODate() ?? new Date().toISOString().slice(0, 10)
}

export async function finishAppointment(workspaceId: string, uid: string, appointmentId: string, action: FinishAction): Promise<FinishResult> {
  if (action.way === "paid" && !action.paymentMethod) throw new BadRequestError("Pick how they paid.")
  if (action.way === "qr" && !(await onlinePaymentsOn(workspaceId))) {
    throw new ConflictError("Turn on online payments in Invoice settings to take card payments.")
  }

  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  const invoiceRef = invoicesCol(workspaceId).doc(appointmentInvoiceId(appointmentId))
  let staleSessions: string[] = []
  const prepared = await db.runTransaction(async (txn) => {
    const [appointmentSnap, invoiceSnap, counterSnap] = await txn.getAll(ref, invoiceRef, counterDoc(workspaceId))
    const appointment = appointmentSnap.exists ? parseAppointment(appointmentSnap.data()) : null
    if (!appointment) throw new NotFoundError("Appointment not found")
    const existing = invoiceSnap.exists ? InvoiceSchema.parse(invoiceSnap.data()) : null
    const nowIso = new Date().toISOString()
    const status = appointmentStatus(appointment, nowIso)

    // A retry of the same tap, or already paid in full: nothing to change.
    if (existing?.payments.some((payment) => payment.id === `manual_${action.clientMutationId}`)) return { appointment, invoice: existing }
    if (status === "completed" && existing?.status === "paid") return { appointment, invoice: existing }
    if (status !== "confirmed" && status !== "completed") {
      throw new ConflictError("Only a confirmed appointment can be finished.")
    }
    if (existing && existing.status !== "sent" && existing.status !== "draft") {
      throw new ConflictError("This appointment's invoice is closed.")
    }
    if (existing?.pendingPayment) throw new ConflictError("A payment on this appointment is still clearing.")

    const summary = appointmentFinishSummary(appointment, existing, action.extras, action.discount)
    if (!summary.ok) throw new BadRequestError(summary.error)
    const built = appointmentFinishLines(appointment, action.extras, action.discount)
    if ("error" in built) throw new BadRequestError(built.error)

    const today = businessToday(appointment.timeZone)
    const base = existing ?? (() => {
      const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0)
      txn.set(counterDoc(workspaceId), { lastNumber: lastNumber + 1, updatedAt: nowIso }, { merge: true })
      return {
        id: invoiceRef.id,
        workspaceId,
        number: formatInvoiceNumber(lastNumber + 1),
        clientName: appointment.clientName,
        clientId: appointment.clientId,
        clientEmail: appointment.clientEmail,
        clientPhone: appointment.clientPhone,
        ...appointmentInvoiceFields(appointment, today),
        note: "",
        appointmentId: appointment.id,
        createdAt: nowIso,
      }
    })()
    staleSessions = [existing?.openCheckout?.sessionId, appointment.depositCheckout?.sessionId].filter((id): id is string => !!id)
    const invoice = InvoiceSchema.parse({
      ...base,
      lines: built.lines,
      total: built.total,
      dueDate: today,
      // An unpaid deposit is folded into today's charge.
      deposit: existing && existing.payments.length > 0 ? existing.deposit : null,
      // The QR pay screen; a regular invoice otherwise.
      quickCharge: action.way === "qr" ? { askForTip: action.askForTip } : null,
      // Only an invoice to pay later is chased by email.
      remindersPaused: action.way !== "later",
      openCheckout: null,
      status: "sent",
      updatedAt: nowIso,
    })
    txn.set(invoiceRef, invoice)
    const next = AppointmentSchema.parse({
      ...appointment,
      status: "completed",
      holdExpiresAt: null,
      invoiceId: invoice.id,
      depositCheckout: null,
      completedAt: appointment.completedAt ?? nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return { appointment: next, invoice }
  })

  if (staleSessions.length > 0) {
    const { expireCheckoutSession } = await import("./invoicesService.js")
    for (const sessionId of staleSessions) await expireCheckoutSession(workspaceId, sessionId).catch(() => null)
  }
  // Sharing makes the public link (the QR code, or the link to pay later).
  let { invoice, shareUrl } = await shareInvoice(workspaceId, invoiceRef)

  if (action.way === "paid" && invoice.status === "sent") {
    const amount = invoiceBalanceDue(invoice)
    const { applyInvoicePayment } = await import("./invoicePaymentEngine.js")
    invoice = (
      await applyInvoicePayment(
        workspaceId,
        uid,
        {
          invoiceId: invoice.id,
          payment: {
            id: `manual_${action.clientMutationId}`,
            purpose: invoicePaymentPurposeFor(invoice, amount),
            amount,
            tipAmount: action.tipAmount,
            receivedOn: businessToday(prepared.appointment.timeZone),
            via: "manual",
            method: action.paymentMethod!,
            plaidTransactionId: null,
            stripePaymentIntentId: null,
            checkoutSessionId: null,
            feeAmount: 0,
          },
        },
        { notes: [action.paymentMethod === "check" ? "Paid by check" : null, "Appointment"] }
      )
    ).invoice
  }

  let emailedTo: string | null = null
  if (action.way === "later" && invoice.status === "sent" && invoice.clientEmail) {
    try {
      const { updateInvoiceStatus } = await import("./invoicesService.js")
      invoice = (await updateInvoiceStatus(workspaceId, uid, invoice.id, { action: "email", to: invoice.clientEmail })).invoice
      emailedTo = invoice.clientEmail
    } catch (error) {
      // The owner shares the link instead.
      console.error("appointmentCheckout: pay-later email failed", { workspaceId, id: appointmentId }, error)
    }
  }
  return { appointment: prepared.appointment, invoice, shareUrl, emailedTo }
}
