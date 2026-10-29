import type Stripe from "stripe"
import { DateTime } from "luxon"
import { db } from "../admin"
import { ConflictError, NotFoundError } from "../lib/httpErrors"
import { appointmentsCol, findShare, overlapQuery, parseAppointment } from "./appointmentsService"
import { counterDoc, formatInvoiceNumber, invoicesCol, readInvoiceSettings } from "./invoicesService"
import { getStripe, readPaymentAccount } from "./paymentAccountsService"
import {
  appointmentDepositAmount,
  appointmentDepositOnline,
  appointmentInvoiceFields,
  appointmentInvoiceId,
  appointmentMoney,
  depositCheckoutWindow,
} from "@shared/appointmentDeposits"
import { appointmentStatus, findAppointmentConflict, formatAppointmentDate, formatBookingTime, publicAppointmentUrl } from "@shared/appointments"
import { invoicePaymentPurposeFor, invoicePaymentRefundable } from "@shared/invoicePayments"
import { AppointmentSchema, type AppointmentAction, type AppointmentType } from "@shared/schemas/appointment"
import { InvoiceSchema, type InvoicePaymentPurpose, type InvoiceType } from "@shared/schemas/invoice"

// ---------------------------------------------------------------------------
// Appointment deposits — step 3 of booking (shared/appointmentDeposits.ts).
//
// The client pays from their link through Stripe Checkout on the owner's
// account (card only: a bank transfer takes days, longer than the 48-hour
// hold). checkout.session.completed makes the appointment's invoice and
// confirms the appointment in one transaction (prepareAppointmentDeposit),
// then the invoice flow books the payment like any other. A payment that
// arrives for a time that's gone (the hold lapsed and someone else booked
// it, or the appointment was canceled) is refunded instead.
// ---------------------------------------------------------------------------

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

function businessToday(timeZone: string): string {
  return DateTime.now().setZone(timeZone).toISODate() ?? new Date().toISOString().slice(0, 10)
}

async function workspaceOwnerUid(workspaceId: string): Promise<string> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  const ownerUid = snap.data()?.ownerId as string | undefined
  if (!ownerUid) throw new Error(`Workspace ${workspaceId} has no owner`)
  return ownerUid
}

/** Whether this business takes card payments online right now. */
export async function onlinePaymentsOn(workspaceId: string): Promise<boolean> {
  const account = await readPaymentAccount(workspaceId)
  return !!account && account.chargesEnabled && account.acceptOnline
}

export async function readAppointmentInvoice(workspaceId: string, appointment: Pick<AppointmentType, "invoiceId">): Promise<InvoiceType | null> {
  if (!appointment.invoiceId) return null
  const snap = await invoicesCol(workspaceId).doc(appointment.invoiceId).get()
  if (!snap.exists) return null
  const parsed = InvoiceSchema.safeParse(snap.data())
  return parsed.success ? parsed.data : null
}

// The payment the deposit is: "deposit" against the invoice's deposit, or
// "full" when the deposit is the whole price.
function depositPurpose(appointment: AppointmentType): InvoicePaymentPurpose {
  return appointmentInvoiceFields(appointment, appointment.date).deposit ? "deposit" : "full"
}

// Inside a transaction, after its reads: makes the appointment's invoice
// unless it's there already. `counterSnap` must have been read in the same
// transaction (the invoice number).
function createAppointmentInvoice(
  txn: FirebaseFirestore.Transaction,
  workspaceId: string,
  appointment: AppointmentType,
  counterSnap: FirebaseFirestore.DocumentSnapshot,
  issueDate: string,
  nowIso: string
): InvoiceType {
  const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0)
  const invoice = InvoiceSchema.parse({
    id: appointmentInvoiceId(appointment.id),
    workspaceId,
    number: formatInvoiceNumber(lastNumber + 1),
    clientName: appointment.clientName,
    clientId: appointment.clientId,
    clientEmail: appointment.clientEmail,
    clientPhone: appointment.clientPhone,
    ...appointmentInvoiceFields(appointment, issueDate),
    note: "",
    appointmentId: appointment.id,
    // The client hears about the appointment through its own link; the rest
    // is charged at the appointment, not chased by email.
    remindersPaused: true,
    status: "sent",
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  txn.create(invoicesCol(workspaceId).doc(invoice.id), invoice)
  txn.set(counterDoc(workspaceId), { lastNumber: lastNumber + 1, updatedAt: nowIso }, { merge: true })
  return invoice
}

// ---------------------------------------------------------------------------
// Checkout (public, from the client's link)
// ---------------------------------------------------------------------------

export type DepositCheckoutStart = { kind: "redirect"; url: string } | { kind: "not_payable" } | { kind: "not_found" }

export async function startAppointmentCheckout(token: string): Promise<DepositCheckoutStart> {
  const share = await findShare(token)
  if (!share) return { kind: "not_found" }
  const { workspaceId, appointmentId } = share
  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  const snap = await ref.get()
  const appointment = snap.exists ? parseAppointment(snap.data()) : null
  if (!appointment || appointment.shareToken !== token) return { kind: "not_found" }

  const nowIso = new Date().toISOString()
  const status = appointmentStatus(appointment, nowIso)
  const account = await readPaymentAccount(workspaceId)
  const online = !!account && account.chargesEnabled && account.acceptOnline
  const invoice = await readAppointmentInvoice(workspaceId, appointment)
  const payable =
    (status === "requested" || status === "confirmed") &&
    appointment.startAt > nowIso &&
    appointmentDepositOnline(appointment, online) &&
    appointmentMoney(appointment, invoice).kind === "due"
  if (!payable || !account) return { kind: "not_payable" }

  const stripe = getStripe()
  const stripeAccount = account.stripeAccountId
  const amountCents = toCents(appointmentDepositAmount(appointment))
  const pageUrl = publicAppointmentUrl(token)

  // A second tap (or the back button) reuses the open session, so one
  // deposit isn't paid twice.
  if (appointment.depositCheckout) {
    const existing = await stripe.checkout.sessions
      .retrieve(appointment.depositCheckout.sessionId, {}, { stripeAccount })
      .catch(() => null)
    if (existing?.status === "complete") return { kind: "redirect", url: `${pageUrl}?paid=1` }
    if (existing?.status === "open" && existing.amount_total === amountCents && existing.url) {
      return { kind: "redirect", url: existing.url }
    }
    if (existing?.status === "open") await stripe.checkout.sessions.expire(existing.id, {}, { stripeAccount }).catch(() => null)
  }

  const settings = await readInvoiceSettings(workspaceId)
  const business = settings.businessName || ""
  const when = `${formatAppointmentDate(appointment.date, appointment.date.slice(0, 4))} at ${formatBookingTime(appointment.startTime)}`
  const metadata = {
    workspaceId,
    invoiceId: appointmentInvoiceId(appointment.id),
    appointmentId: appointment.id,
    purpose: depositPurpose(appointment),
    amountCents: String(amountCents),
    tipCents: "0",
  }
  // A waiting request's session closes with its hold. Stripe keeps one
  // open at least 30 minutes, so a hold about to run out is stretched to
  // match first: the time stays the client's while they pay, and no one
  // can book over it.
  let expiresAt: number | undefined
  if (status === "requested" && appointment.holdExpiresAt) {
    const window = depositCheckoutWindow(appointment.holdExpiresAt, Date.now())
    expiresAt = window.expiresAtSeconds
    const extendedHold = window.holdExpiresAt
    if (extendedHold) {
      const stillWaiting = await db.runTransaction(async (txn) => {
        const fresh = parseAppointment((await txn.get(ref)).data())
        if (!fresh || appointmentStatus(fresh, new Date().toISOString()) !== "requested") return false
        if (!fresh.holdExpiresAt || fresh.holdExpiresAt < extendedHold) txn.update(ref, { holdExpiresAt: extendedHold })
        return true
      })
      if (!stillWaiting) return { kind: "not_payable" }
    }
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: `Deposit — ${appointment.serviceName}, ${when}`.slice(0, 250) },
          },
        },
      ],
      client_reference_id: metadata.invoiceId,
      ...(appointment.clientEmail ? { customer_email: appointment.clientEmail } : {}),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      metadata,
      payment_intent_data: {
        description: `Deposit for ${appointment.serviceName}${business ? ` with ${business}` : ""}`,
        metadata,
      },
      success_url: `${pageUrl}?paid=1`,
      cancel_url: pageUrl,
    },
    { stripeAccount, idempotencyKey: `appt-deposit-${appointment.id}-${amountCents}-${appointment.updatedAt}` }
  )
  await ref.set({ depositCheckout: { sessionId: session.id, amountCents } }, { merge: true })
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL")
  return { kind: "redirect", url: session.url }
}

// ---------------------------------------------------------------------------
// Webhook: a deposit was paid (before the invoice flow books it)
// ---------------------------------------------------------------------------

/**
 * Called for a completed Checkout session carrying an appointmentId. Makes
 * the appointment's invoice and confirms the appointment, then returns
 * "book" so the invoice flow records the payment. If the time can't be
 * kept (canceled, started, or the hold lapsed and someone else has it), the
 * payment is refunded and "skip" returned.
 */
export async function prepareAppointmentDeposit(
  stripeAccountId: string,
  workspaceId: string,
  session: Stripe.Checkout.Session
): Promise<"book" | "skip"> {
  const appointmentId = session.metadata?.appointmentId ?? ""
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  const invoiceRef = invoicesCol(workspaceId).doc(appointmentInvoiceId(appointmentId))

  // Set when this payment confirms the booking: one made on the public page,
  // or the owner's request the client confirmed by paying.
  let confirmed: AppointmentType | null = null
  const outcome = await db.runTransaction(async (txn) => {
    confirmed = null
    const [appointmentSnap, invoiceSnap, counterSnap] = await txn.getAll(ref, invoiceRef, counterDoc(workspaceId))
    const appointment = appointmentSnap.exists ? parseAppointment(appointmentSnap.data()) : null
    if (!appointment) return "refund" as const
    // A retry of a payment already booked: let the invoice flow finish it.
    if (invoiceSnap.exists && (invoiceSnap.data()?.payments ?? []).some((p: { id?: string }) => p.id === `stripe_${paymentIntentId}`)) {
      return "book" as const
    }
    const nowIso = new Date().toISOString()
    const status = appointmentStatus(appointment, nowIso)
    if (status === "canceled") return "refund" as const
    const reopening = status === "expired" || status === "declined"
    if (reopening) {
      if (appointment.startAt <= nowIso) return "refund" as const
      const nearbySnap = await txn.get(overlapQuery(workspaceId, appointment.startAt, appointment.blockedUntil))
      const nearby = nearbySnap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? [])
      if (findAppointmentConflict(appointment, nearby, nowIso, appointment.id)) return "refund" as const
    }
    if (!invoiceSnap.exists) {
      createAppointmentInvoice(txn, workspaceId, appointment, counterSnap, businessToday(appointment.timeZone), nowIso)
    }
    const confirming = status === "requested" || reopening
    const next = AppointmentSchema.parse({
      ...appointment,
      status: confirming ? "confirmed" : appointment.status,
      holdExpiresAt: confirming ? null : appointment.holdExpiresAt,
      respondedAt: confirming ? nowIso : appointment.respondedAt,
      invoiceId: invoiceRef.id,
      depositCheckout: null,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    if (confirming) confirmed = next
    return "book" as const
  })

  if (outcome === "book") {
    const booked = confirmed as AppointmentType | null
    if (booked) {
      const { notifyOwnerAboutAppointment } = await import("./appointmentNotifications.js")
      await notifyOwnerAboutAppointment(workspaceId, booked, booked.source === "online" ? "booked" : "confirmed")
      // A customer who booked online gets a "you're booked" email to find it again.
      if (booked.source === "online") {
        const { emailAppointmentAutomatically } = await import("./appointmentEmailService.js")
        await emailAppointmentAutomatically(workspaceId, booked, "booked")
      }
    }
    return "book"
  }
  if (!paymentIntentId) throw new Error(`Checkout session ${session.id} has no PaymentIntent`)
  // Same key the invoice flow uses for a payment it can't take, so the
  // money goes back once.
  await getStripe().refunds.create(
    { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { workspaceId, appointmentId } },
    { stripeAccount: stripeAccountId, idempotencyKey: `refund-${paymentIntentId}` }
  )
  await ref.set({ depositCheckout: null }, { merge: true }).catch(() => null)
  console.warn("appointmentDeposits: refunded a deposit for a time that couldn't be kept", { workspaceId, appointmentId })
  return "skip"
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

/** "Record deposit": paid another way (cash, Zelle). Confirms a waiting request. */
export async function recordAppointmentDeposit(
  workspaceId: string,
  uid: string,
  appointmentId: string,
  action: Extract<AppointmentAction, { action: "record_deposit" }>
): Promise<InvoiceType> {
  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  const invoiceRef = invoicesCol(workspaceId).doc(appointmentInvoiceId(appointmentId))
  let staleSessionId: string | null = null
  const prepared = await db.runTransaction(async (txn) => {
    const [appointmentSnap, invoiceSnap, counterSnap] = await txn.getAll(ref, invoiceRef, counterDoc(workspaceId))
    const appointment = appointmentSnap.exists ? parseAppointment(appointmentSnap.data()) : null
    if (!appointment) throw new NotFoundError("Appointment not found")
    const existing = invoiceSnap.exists ? InvoiceSchema.parse(invoiceSnap.data()) : null
    // A retry of the same tap.
    if (existing?.payments.some((payment) => payment.id === `manual_${action.clientMutationId}`)) {
      return { appointment, invoice: existing }
    }
    const nowIso = new Date().toISOString()
    const status = appointmentStatus(appointment, nowIso)
    if (status !== "requested" && status !== "confirmed") {
      throw new ConflictError("A deposit can only be recorded on a waiting or confirmed appointment.")
    }
    const money = appointmentMoney(appointment, existing)
    if (money.kind !== "due") throw new ConflictError(money.kind === "none" ? "This appointment has no deposit." : "The deposit is already paid.")
    const today = businessToday(appointment.timeZone)
    if (action.paidDate > today) throw new ConflictError("The payment date can't be in the future.")
    const invoice =
      existing ?? createAppointmentInvoice(txn, workspaceId, appointment, counterSnap, action.paidDate < today ? action.paidDate : today, nowIso)
    if (action.paidDate < invoice.issueDate) throw new ConflictError("The payment date can't be before the deposit was asked for.")
    staleSessionId = appointment.depositCheckout?.sessionId ?? null
    txn.set(
      ref,
      AppointmentSchema.parse({
        ...appointment,
        status: "confirmed",
        holdExpiresAt: null,
        invoiceId: invoice.id,
        depositCheckout: null,
        updatedAt: nowIso,
      })
    )
    return { appointment, invoice }
  })
  if (staleSessionId) {
    const { expireCheckoutSession } = await import("./invoicesService.js")
    await expireCheckoutSession(workspaceId, staleSessionId)
  }

  const amount = appointmentDepositAmount(prepared.appointment)
  const { applyInvoicePayment } = await import("./invoicePaymentEngine.js")
  const { invoice } = await applyInvoicePayment(
    workspaceId,
    uid,
    {
      invoiceId: prepared.invoice.id,
      payment: {
        id: `manual_${action.clientMutationId}`,
        purpose: invoicePaymentPurposeFor(prepared.invoice, amount),
        amount,
        tipAmount: 0,
        receivedOn: action.paidDate,
        via: "manual",
        method: action.paymentMethod,
        plaidTransactionId: null,
        stripePaymentIntentId: null,
        checkoutSessionId: null,
        feeAmount: 0,
      },
    },
    { notes: [action.paymentMethod === "check" ? "Paid by check" : null, "Booking deposit"] }
  )
  return invoice
}

/**
 * Gives back an appointment's money: every payment, or only those paid
 * through Stripe (`onlineOnly` — a client canceling can't get cash back
 * from 521; the owner hands that back and records it). Safe to repeat: each
 * refund is keyed by its payment.
 */
export async function refundAppointmentMoney(
  workspaceId: string,
  appointment: Pick<AppointmentType, "id" | "invoiceId">,
  options: { onlineOnly: boolean; reason: "requested_by_client" | "other" }
): Promise<void> {
  const invoice = await readAppointmentInvoice(workspaceId, appointment)
  if (!invoice) return
  const uid = await workspaceOwnerUid(workspaceId)
  const { refundInvoice } = await import("./refundsService.js")
  for (const payment of invoice.payments) {
    if (options.onlineOnly && !(payment.via === "online" && payment.stripePaymentIntentId)) continue
    const refundable = invoicePaymentRefundable(invoice, payment.id)
    if (toCents(refundable) <= 0) continue
    await refundInvoice(workspaceId, uid, invoice.id, {
      paymentId: payment.id,
      amount: refundable,
      reason: options.reason,
      clientMutationId: `apptcancel_${payment.id}`.slice(0, 128),
    })
  }
}

/** Ends the appointment's invoice once nothing more is owed (canceled, no-show), keeping what's still paid. */
export async function closeAppointmentInvoice(workspaceId: string, appointment: Pick<AppointmentType, "invoiceId">): Promise<void> {
  const invoice = await readAppointmentInvoice(workspaceId, appointment)
  if (!invoice || invoice.status !== "sent" || invoice.payments.length === 0) return
  const uid = await workspaceOwnerUid(workspaceId)
  const { updateInvoiceStatus } = await import("./invoicesService.js")
  await updateInvoiceStatus(workspaceId, uid, invoice.id, { action: "close" })
}

export async function expireDepositCheckout(workspaceId: string, appointment: Pick<AppointmentType, "depositCheckout">): Promise<void> {
  if (!appointment.depositCheckout) return
  const { expireCheckoutSession } = await import("./invoicesService.js")
  await expireCheckoutSession(workspaceId, appointment.depositCheckout.sessionId)
}
