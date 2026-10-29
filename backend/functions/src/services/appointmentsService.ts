import { randomBytes } from "node:crypto"
import type { AppointmentEmailResult } from "./appointmentEmailService"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import { resolveInvoiceClient } from "./clientsService"
import { readInvoiceSettings } from "./invoicesService"
import { assertIndependentWorkspace, bookingSettingsDoc, readBookingSettings } from "./bookingService"
import {
  APPOINTMENT_LOOKBACK_MS,
  appointmentHoldExpiresAt,
  appointmentStatus,
  appointmentTimes,
  bookingHoursWarning,
  findAppointmentConflict,
  formatAppointmentDate,
  formatBookingTime,
  publicAppointmentUrl,
} from "@shared/appointments"
import {
  AppointmentActionSchema,
  AppointmentCreateInputSchema,
  AppointmentSchema,
  type AppointmentAction,
  type AppointmentResponse,
  type AppointmentType,
} from "@shared/schemas/appointment"
import { BOOKING_MAX_SERVICES, BookingSettingsSchema, type BookingService } from "@shared/schemas/booking"
import type { InvoiceSettings, InvoiceType } from "@shared/schemas/invoice"
import { appointmentDepositOnline, appointmentMoney, clientCanCancel, clientCancelRefunds } from "@shared/appointmentDeposits"

// ---------------------------------------------------------------------------
// Appointments — workspaces/{workspaceId}/appointments/{id}
//
// Double-booking: every write that takes time (a new appointment, confirming
// one whose hold lapsed) reads the appointments that could overlap inside
// the same transaction, so two saves at once can't both get the slot.
// ---------------------------------------------------------------------------

export function appointmentsCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("appointments")
}

// appointmentShares/{token} → { workspaceId, appointmentId }: lets the
// client's page find an appointment from its link alone. 128 random bits;
// no Firestore rule allows reading it — only publicAppointment does.
function appointmentSharesCol() {
  return db.collection("appointmentShares")
}

function newShareToken(): string {
  return randomBytes(16).toString("base64url")
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

export function parseAppointment(raw: unknown): AppointmentType | null {
  const parsed = AppointmentSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.error("appointmentsService: skipping an appointment that doesn't parse", parsed.error.issues)
  return null
}

// What the app and the client's page see: a lapsed request reads as expired.
export function asOfNow(appointment: AppointmentType, nowIso: string): AppointmentType {
  const status = appointmentStatus(appointment, nowIso)
  return status === appointment.status ? appointment : { ...appointment, status, holdExpiresAt: null }
}

// The appointments that could overlap [startAt, blockedUntil).
export function overlapQuery(workspaceId: string, startAt: string, blockedUntil: string) {
  const windowStart = new Date(Date.parse(startAt) - APPOINTMENT_LOOKBACK_MS).toISOString()
  return appointmentsCol(workspaceId).where("startAt", ">", windowStart).where("startAt", "<", blockedUntil)
}

export function conflictMessage(other: AppointmentType): string {
  return `That time overlaps with ${other.clientName}'s ${other.serviceName} on ${formatAppointmentDate(other.date)} at ${formatBookingTime(other.startTime)}.`
}

/** From 30 days ago on, soonest first. */
export async function listAppointments(workspaceId: string, uid: string): Promise<AppointmentType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const nowIso = new Date().toISOString()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const snap = await appointmentsCol(workspaceId).where("startAt", ">=", since).orderBy("startAt", "asc").limit(500).get()
  return snap.docs.flatMap((doc) => {
    const appointment = parseAppointment(doc.data())
    return appointment ? [asOfNow(appointment, nowIso)] : []
  })
}

export async function createAppointment(
  workspaceId: string,
  uid: string,
  raw: unknown
): Promise<{ appointment: AppointmentType; shareUrl: string | null; email: AppointmentEmailResult }> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const parsed = AppointmentCreateInputSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid appointment", formatIssues(parsed.error))
  }
  const input = parsed.data
  const settings = await readBookingSettings(workspaceId)
  const times = appointmentTimes({ ...input, timeZone: settings.timeZone })
  if (!times) throw new BadRequestError("That date and time don't exist in your time zone.")
  if (times.startAt <= new Date().toISOString()) throw new BadRequestError("That time has already passed.")

  // Every appointment belongs to a saved client — found by name or made here.
  const client = await resolveInvoiceClient(workspaceId, {
    clientId: input.clientId ?? null,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
  })
  const ref = appointmentsCol(workspaceId).doc(`cmid_${input.clientMutationId}`)
  const keepService = input.saveAsService && input.serviceId === null

  const created = await db.runTransaction(async (txn) => {
    // Reads first (Firestore transactions require it), then writes.
    const existingSnap = await txn.get(ref)
    if (existingSnap.exists) {
      // A retry of the same tap.
      const existing = AppointmentSchema.parse(existingSnap.data())
      return { appointment: existing, shareUrl: existing.shareToken ? publicAppointmentUrl(existing.shareToken) : null }
    }
    const nearbySnap = await txn.get(overlapQuery(workspaceId, times.startAt, times.blockedUntil))
    const bookingSnap = keepService ? await txn.get(bookingSettingsDoc(workspaceId)) : null

    const nowIso = new Date().toISOString()
    const nearby = nearbySnap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? [])
    const conflict = findAppointmentConflict(times, nearby, nowIso)
    if (conflict) throw new ConflictError(conflictMessage(conflict))

    let serviceId = input.serviceId
    if (bookingSnap) {
      const booking = BookingSettingsSchema.safeParse(bookingSnap.data() ?? {})
      const current = booking.success ? booking.data : BookingSettingsSchema.parse({})
      if (current.services.length < BOOKING_MAX_SERVICES) {
        const service: BookingService = {
          id: `svc_${randomBytes(8).toString("hex")}`,
          name: input.serviceName,
          price: input.price,
          minutes: input.minutes,
          deposit: input.deposit,
          bufferMinutes: input.bufferMinutes,
          active: true,
        }
        serviceId = service.id
        txn.set(
          bookingSettingsDoc(workspaceId),
          BookingSettingsSchema.parse({
            ...current,
            timeZone: current.timeZone || settings.timeZone,
            // Not saved yet: keep the invoice-address default it was read with.
            location: bookingSnap.data()?.location === undefined ? settings.location : current.location,
            services: [...current.services, service],
            updatedAt: nowIso,
          })
        )
      }
    }

    // Every appointment gets its client link up front, so sharing it is instant.
    const shareToken = input.shareToken ?? newShareToken()
    const appointment = AppointmentSchema.parse({
      id: ref.id,
      workspaceId,
      clientId: client.id,
      clientName: client.name,
      clientEmail: input.clientEmail || client.email || null,
      clientPhone: input.clientPhone || client.phone || null,
      serviceId,
      serviceName: input.serviceName,
      price: input.price,
      minutes: input.minutes,
      bufferMinutes: input.bufferMinutes,
      deposit: input.deposit.type === "none" ? { type: "none", value: 0 } : input.deposit,
      date: input.date,
      startTime: input.startTime,
      timeZone: settings.timeZone,
      ...times,
      status: input.askToConfirm ? "requested" : "confirmed",
      holdExpiresAt: input.askToConfirm ? appointmentHoldExpiresAt(nowIso) : null,
      shareToken,
      outsideHours: bookingHoursWarning(settings, input.date, input.startTime, input.minutes) !== null,
      location: input.location ?? settings.location,
      refundCutoffHours: settings.refundCutoffHours,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, appointment)
    txn.create(appointmentSharesCol().doc(shareToken), { workspaceId, appointmentId: ref.id, createdAt: nowIso })
    return { appointment, shareUrl: publicAppointmentUrl(shareToken) }
  })
  // Booking sends the client their link (once, even when the tap retries).
  const emails = await import("./appointmentEmailService.js")
  const { result, appointment } = await emails.emailAppointmentAutomatically(
    workspaceId,
    created.appointment,
    emails.appointmentEmailKind(created.appointment)
  )
  return { ...created, appointment, email: result }
}

type AppointmentUpdate = { appointment: AppointmentType; shareUrl: string | null }

/** The result of an action, plus the appointment's invoice (its money) when it has one. */
export async function updateAppointment(
  workspaceId: string,
  uid: string,
  appointmentId: string,
  raw: unknown
): Promise<AppointmentUpdate & { invoice: InvoiceType | null; emailedTo?: string | null }> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const parsed = AppointmentActionSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid appointment action", formatIssues(parsed.error))
  const action = parsed.data
  const ref = appointmentsCol(workspaceId).doc(appointmentId)
  const deposits = await import("./appointmentDepositsService.js")

  if (action.action === "email") {
    const stored = parseAppointment((await ref.get()).data())
    if (!stored) throw new NotFoundError("Appointment not found")
    const to = action.to ?? stored.clientEmail
    if (!to) throw new BadRequestError("Add the client's email first.")
    if (!stored.shareToken) throw new ConflictError("Share this appointment's link first.")
    const { resendAppointmentEmail } = await import("./appointmentEmailService.js")
    const appointment = await resendAppointmentEmail(workspaceId, stored, to)
    return {
      appointment: asOfNow(appointment, new Date().toISOString()),
      shareUrl: publicAppointmentUrl(appointment.shareToken!),
      invoice: await deposits.readAppointmentInvoice(workspaceId, appointment),
    }
  }

  if (action.action === "record_deposit") {
    const invoice = await deposits.recordAppointmentDeposit(workspaceId, uid, appointmentId, action)
    const appointment = parseAppointment((await ref.get()).data())
    if (!appointment) throw new NotFoundError("Appointment not found")
    return {
      appointment: asOfNow(appointment, new Date().toISOString()),
      shareUrl: appointment.shareToken ? publicAppointmentUrl(appointment.shareToken) : null,
      invoice,
    }
  }

  if (action.action === "reschedule") {
    const { rescheduleByOwner } = await import("./appointmentRescheduleService.js")
    const moved = await rescheduleByOwner(workspaceId, appointmentId, { date: action.date, startTime: action.startTime })
    const deposits = await import("./appointmentDepositsService.js")
    return {
      appointment: asOfNow(moved.appointment, new Date().toISOString()),
      shareUrl: moved.appointment.shareToken ? publicAppointmentUrl(moved.appointment.shareToken) : null,
      invoice: await deposits.readAppointmentInvoice(workspaceId, moved.appointment),
      // Where "Your appointment moved" went; null means share it instead.
      emailedTo: moved.email === "sent" ? moved.appointment.clientEmail : null,
    }
  }

  if (action.action === "finish") {
    const { finishAppointment } = await import("./appointmentCheckoutService.js")
    const finished = await finishAppointment(workspaceId, uid, appointmentId, action)
    // shareUrl is the invoice's link here: the QR code, or the link to pay later.
    return {
      appointment: asOfNow(finished.appointment, new Date().toISOString()),
      shareUrl: finished.shareUrl,
      invoice: finished.invoice,
      emailedTo: finished.emailedTo,
    }
  }

  // "Finish without charging" (complete) ends any open invoice, keeping what
  // was paid — only when it's this tap that finishes it, never an invoice a
  // finish left open to pay later.
  const wasConfirmed =
    action.action === "complete" && parseAppointment((await ref.get()).data())?.status === "confirmed"
  const result = await changeAppointment(workspaceId, ref, action)
  let { appointment } = result
  if (wasConfirmed && appointment.status === "completed") {
    await deposits.closeAppointmentInvoice(workspaceId, appointment)
  }
  // Canceling (by the owner) gives every deposit back; a no-show keeps it.
  // Both end the invoice, as nothing more is owed. Repeating a cancel
  // retries any refund that failed.
  if (action.action === "cancel" && appointment.status === "canceled" && appointment.canceledBy === "owner") {
    await deposits.expireDepositCheckout(workspaceId, appointment)
    await deposits.refundAppointmentMoney(workspaceId, appointment, { onlineOnly: false, reason: "other" })
    await deposits.closeAppointmentInvoice(workspaceId, appointment)
    // Tells the client (once), with the deposit coming back if they paid one.
    const { emailAppointmentAutomatically } = await import("./appointmentEmailService.js")
    appointment = (await emailAppointmentAutomatically(workspaceId, appointment, "canceled", { depositRefunded: true })).appointment
  }
  if (action.action === "no_show" && appointment.status === "no_show") {
    await deposits.closeAppointmentInvoice(workspaceId, appointment)
  }
  return { ...result, appointment, invoice: await deposits.readAppointmentInvoice(workspaceId, appointment) }
}

async function changeAppointment(
  workspaceId: string,
  ref: FirebaseFirestore.DocumentReference,
  action: Exclude<AppointmentAction, { action: "record_deposit" | "email" | "finish" | "reschedule" }>
): Promise<AppointmentUpdate> {
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const stored = snap.exists ? parseAppointment(snap.data()) : null
    if (!stored) throw new NotFoundError("Appointment not found")
    const nowIso = new Date().toISOString()
    const status = appointmentStatus(stored, nowIso)
    const done = (next: AppointmentType) => ({
      appointment: next,
      shareUrl: next.shareToken ? publicAppointmentUrl(next.shareToken) : null,
    })

    if (action.action === "share") {
      if (stored.shareToken) return done(asOfNow(stored, nowIso))
      const shareToken = newShareToken()
      const next = AppointmentSchema.parse({ ...stored, shareToken, updatedAt: nowIso })
      txn.create(appointmentSharesCol().doc(shareToken), { workspaceId, appointmentId: stored.id, createdAt: nowIso })
      txn.set(ref, next)
      return done(asOfNow(next, nowIso))
    }

    if (action.action === "confirm") {
      if (status === "confirmed") return done(stored)
      if (status !== "requested" && status !== "expired" && status !== "declined") {
        throw new ConflictError("Only a booking that's waiting, expired or declined can be confirmed.")
      }
      // Its hold lapsed (or it was declined), so the time may have gone to someone else.
      if (status !== "requested") {
        const nearbySnap = await txn.get(overlapQuery(workspaceId, stored.startAt, stored.blockedUntil))
        const nearby = nearbySnap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? [])
        const conflict = findAppointmentConflict(stored, nearby, nowIso, stored.id)
        if (conflict) throw new ConflictError(conflictMessage(conflict))
      }
      if (stored.startAt <= nowIso) throw new ConflictError("That time has already passed.")
      const next = AppointmentSchema.parse({ ...stored, status: "confirmed", holdExpiresAt: null, updatedAt: nowIso })
      txn.set(ref, next)
      return done(next)
    }

    if (action.action === "cancel") {
      if (status === "canceled") return done(stored)
      if (status === "completed") throw new ConflictError("A finished appointment can't be canceled.")
      if (status === "no_show") throw new ConflictError("A no-show can't be canceled.")
      const next = AppointmentSchema.parse({
        ...stored,
        status: "canceled",
        holdExpiresAt: null,
        canceledAt: nowIso,
        canceledBy: "owner",
        depositCheckout: null,
        updatedAt: nowIso,
      })
      txn.set(ref, next)
      return done(next)
    }

    if (action.action === "no_show") {
      if (status === "no_show") return done(stored)
      if (status !== "confirmed" && status !== "completed") throw new ConflictError("Only a confirmed appointment can be a no-show.")
      if (stored.startAt > nowIso) throw new ConflictError("You can mark a no-show once the appointment's time has come.")
      const next = AppointmentSchema.parse({ ...stored, status: "no_show", holdExpiresAt: null, updatedAt: nowIso })
      txn.set(ref, next)
      return done(next)
    }

    // complete
    if (status === "completed") return done(stored)
    if (status === "canceled" || status === "declined" || status === "no_show") {
      throw new ConflictError("A canceled, declined or no-show appointment can't be marked done.")
    }
    const next = AppointmentSchema.parse({
      ...stored,
      status: "completed",
      holdExpiresAt: null,
      completedAt: nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return done(next)
  })
}

// ---------------------------------------------------------------------------
// The client's side (publicAppointment): read and answer by link.
// ---------------------------------------------------------------------------

export async function findShare(token: string): Promise<{ workspaceId: string; appointmentId: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const snap = await appointmentSharesCol().doc(token).get()
  const data = snap.data()
  if (!data || typeof data.workspaceId !== "string" || typeof data.appointmentId !== "string") return null
  return { workspaceId: data.workspaceId, appointmentId: data.appointmentId }
}

export type SharedAppointment = {
  workspaceId: string
  appointment: AppointmentType
  settings: InvoiceSettings
  invoice: InvoiceType | null
  // The client pays the deposit online (the business takes cards).
  depositOnline: boolean
}

export async function findSharedAppointment(token: string): Promise<SharedAppointment | null> {
  const share = await findShare(token)
  if (!share) return null
  const snap = await appointmentsCol(share.workspaceId).doc(share.appointmentId).get()
  const appointment = snap.exists ? parseAppointment(snap.data()) : null
  if (!appointment || appointment.shareToken !== token) return null
  const deposits = await import("./appointmentDepositsService.js")
  const [settings, invoice, online] = await Promise.all([
    readInvoiceSettings(share.workspaceId),
    deposits.readAppointmentInvoice(share.workspaceId, appointment),
    deposits.onlinePaymentsOn(share.workspaceId).catch(() => false),
  ])
  return {
    workspaceId: share.workspaceId,
    appointment: asOfNow(appointment, new Date().toISOString()),
    settings,
    invoice,
    depositOnline: appointmentDepositOnline(appointment, online),
  }
}

/**
 * The client's answer. Confirm and decline only change a live request, and
 * confirming takes the deposit first when it's paid online (the Pay button,
 * not this). Cancel calls off a confirmed appointment that hasn't started:
 * paid online deposits come back before the cutoff, and are kept after it.
 * Anything else is left as it is.
 */
export async function respondToAppointment(token: string, answer: AppointmentResponse): Promise<"ok" | "not_found"> {
  const shared = await findSharedAppointment(token)
  if (!shared) return "not_found"
  const { workspaceId } = shared
  const ref = appointmentsCol(workspaceId).doc(shared.appointment.id)
  const depositDue = shared.depositOnline && appointmentMoney(shared.appointment, shared.invoice).kind === "due"
  const changed = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const stored = snap.exists ? parseAppointment(snap.data()) : null
    if (!stored || stored.shareToken !== token) return null
    const nowIso = new Date().toISOString()
    const status = appointmentStatus(stored, nowIso)
    if (answer === "cancel") {
      if (!clientCanCancel({ status, startAt: stored.startAt }, nowIso)) return null
      const next = AppointmentSchema.parse({
        ...stored,
        status: "canceled",
        canceledAt: nowIso,
        canceledBy: "client",
        depositCheckout: null,
        updatedAt: nowIso,
      })
      txn.set(ref, next)
      return { next, refunds: clientCancelRefunds(stored, nowIso) }
    }
    if (status !== "requested") return null
    if (answer === "confirm" && depositDue) return null
    const next = AppointmentSchema.parse({
      ...stored,
      status: answer === "confirm" ? "confirmed" : "declined",
      holdExpiresAt: null,
      respondedAt: nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return { next, refunds: false }
  })
  if (!changed) return "ok"
  const { next } = changed
  const deposits = await import("./appointmentDepositsService.js")
  await deposits.expireDepositCheckout(workspaceId, shared.appointment)
  if (answer === "cancel") {
    try {
      if (changed.refunds) await deposits.refundAppointmentMoney(workspaceId, next, { onlineOnly: true, reason: "requested_by_client" })
      await deposits.closeAppointmentInvoice(workspaceId, next)
    } catch (error) {
      // The appointment is canceled either way; the owner can refund from the invoice.
      console.error("appointmentsService.respondToAppointment: couldn't settle the canceled deposit", { workspaceId, id: next.id }, error)
    }
  }
  const { notifyOwnerAboutAppointment } = await import("./appointmentNotifications.js")
  await notifyOwnerAboutAppointment(
    workspaceId,
    next,
    answer === "cancel" ? "canceled" : answer === "confirm" ? "confirmed" : "declined",
    { depositRefunded: changed.refunds }
  )
  return "ok"
}
