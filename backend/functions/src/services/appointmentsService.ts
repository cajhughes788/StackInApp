import { randomBytes } from "node:crypto"
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
  type AppointmentResponse,
  type AppointmentType,
} from "@shared/schemas/appointment"
import { BOOKING_MAX_SERVICES, BookingSettingsSchema, type BookingService } from "@shared/schemas/booking"
import type { InvoiceSettings } from "@shared/schemas/invoice"

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

function parseAppointment(raw: unknown): AppointmentType | null {
  const parsed = AppointmentSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.error("appointmentsService: skipping an appointment that doesn't parse", parsed.error.issues)
  return null
}

// What the app and the client's page see: a lapsed request reads as expired.
function asOfNow(appointment: AppointmentType, nowIso: string): AppointmentType {
  const status = appointmentStatus(appointment, nowIso)
  return status === appointment.status ? appointment : { ...appointment, status, holdExpiresAt: null }
}

// The appointments that could overlap [startAt, blockedUntil).
function overlapQuery(workspaceId: string, startAt: string, blockedUntil: string) {
  const windowStart = new Date(Date.parse(startAt) - APPOINTMENT_LOOKBACK_MS).toISOString()
  return appointmentsCol(workspaceId).where("startAt", ">", windowStart).where("startAt", "<", blockedUntil)
}

function conflictMessage(other: AppointmentType): string {
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
): Promise<{ appointment: AppointmentType; shareUrl: string | null }> {
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

  return db.runTransaction(async (txn) => {
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

    const shareToken = input.askToConfirm ? newShareToken() : null
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
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.set(ref, appointment)
    if (shareToken) {
      txn.create(appointmentSharesCol().doc(shareToken), { workspaceId, appointmentId: ref.id, createdAt: nowIso })
    }
    return { appointment, shareUrl: shareToken ? publicAppointmentUrl(shareToken) : null }
  })
}

export async function updateAppointment(
  workspaceId: string,
  uid: string,
  appointmentId: string,
  raw: unknown
): Promise<{ appointment: AppointmentType; shareUrl: string | null }> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const parsed = AppointmentActionSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid appointment action", formatIssues(parsed.error))
  const action = parsed.data
  const ref = appointmentsCol(workspaceId).doc(appointmentId)

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
      const next = AppointmentSchema.parse({
        ...stored,
        status: "canceled",
        holdExpiresAt: null,
        canceledAt: nowIso,
        updatedAt: nowIso,
      })
      txn.set(ref, next)
      return done(next)
    }

    // complete
    if (status === "completed") return done(stored)
    if (status === "canceled" || status === "declined") {
      throw new ConflictError("A canceled or declined appointment can't be marked done.")
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

async function findShare(token: string): Promise<{ workspaceId: string; appointmentId: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const snap = await appointmentSharesCol().doc(token).get()
  const data = snap.data()
  if (!data || typeof data.workspaceId !== "string" || typeof data.appointmentId !== "string") return null
  return { workspaceId: data.workspaceId, appointmentId: data.appointmentId }
}

export async function findSharedAppointment(
  token: string
): Promise<{ appointment: AppointmentType; settings: InvoiceSettings } | null> {
  const share = await findShare(token)
  if (!share) return null
  const snap = await appointmentsCol(share.workspaceId).doc(share.appointmentId).get()
  const appointment = snap.exists ? parseAppointment(snap.data()) : null
  if (!appointment || appointment.shareToken !== token) return null
  const settings = await readInvoiceSettings(share.workspaceId)
  return { appointment: asOfNow(appointment, new Date().toISOString()), settings }
}

/** The client's answer. Only a live request changes; anything else is left as it is. */
export async function respondToAppointment(token: string, answer: AppointmentResponse): Promise<"ok" | "not_found"> {
  const share = await findShare(token)
  if (!share) return "not_found"
  const ref = appointmentsCol(share.workspaceId).doc(share.appointmentId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const stored = snap.exists ? parseAppointment(snap.data()) : null
    if (!stored || stored.shareToken !== token) return "not_found"
    const nowIso = new Date().toISOString()
    if (appointmentStatus(stored, nowIso) !== "requested") return "ok"
    txn.set(
      ref,
      AppointmentSchema.parse({
        ...stored,
        status: answer === "confirm" ? "confirmed" : "declined",
        holdExpiresAt: null,
        respondedAt: nowIso,
        updatedAt: nowIso,
      })
    )
    return "ok"
  })
}
