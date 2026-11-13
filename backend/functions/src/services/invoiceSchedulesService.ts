import { DateTime } from "luxon"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import { resolveInvoiceClient } from "./clientsService"
import { counterDoc, formatInvoiceNumber, invoicesCol } from "./invoicesService"
import { InvoiceSchema, invoiceTotalFromLines, type InvoiceType } from "@shared/schemas/invoice"
import {
  InvoiceScheduleCreateInputSchema,
  InvoiceSchedulePatchSchema,
  InvoiceScheduleSchema,
  type InvoiceScheduleType,
} from "@shared/schemas/invoiceSchedule"
import {
  addScheduleDays,
  daysBetween,
  firstScheduleDateFrom,
  invoiceFieldsForSchedule,
  planScheduleRun,
  scheduleEndReached,
  scheduleNextDateFrom,
} from "@shared/invoiceSchedules"

// ---------------------------------------------------------------------------
// Repeating invoices (shared/schemas/invoiceSchedule.ts). A schedule is
// started from an invoice, which counts as its first; the hourly job
// (makeScheduledInvoicesHourly) makes the rest on their dates in the
// business's time zone, then emails each one or leaves it as a draft.
//
// Each invoice's id is the schedule's id plus its date, made in the same
// transaction that moves the schedule on — so one schedule can never make two
// invoices for the same date, however often the job runs.
// ---------------------------------------------------------------------------

const DEFAULT_TIME_ZONE = "America/Los_Angeles"
// Invoices are made from this hour of the business's morning on.
export const SCHEDULED_INVOICE_HOUR = 6

export function invoiceSchedulesCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("invoiceSchedules")
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

function readSchedule(data: unknown): InvoiceScheduleType {
  const parsed = InvoiceScheduleSchema.safeParse(data)
  if (!parsed.success) throw new NotFoundError("Repeating invoice not found")
  return parsed.data
}

/** The business's date and hour now. */
export async function businessNow(workspaceId: string, now = Date.now()): Promise<{ today: string; hour: number }> {
  const settingsSnap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  const timeZone = (settingsSnap.get("common.timeZone") as string | undefined) || DEFAULT_TIME_ZONE
  const local = DateTime.fromMillis(now).setZone(timeZone)
  return local.isValid
    ? { today: local.toISODate()!, hour: local.hour }
    : { today: new Date(now).toISOString().slice(0, 10), hour: new Date(now).getUTCHours() }
}

export async function listInvoiceSchedules(workspaceId: string, uid: string): Promise<InvoiceScheduleType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await invoiceSchedulesCol(workspaceId).get()
  const schedules: InvoiceScheduleType[] = []
  for (const doc of snap.docs) {
    const parsed = InvoiceScheduleSchema.safeParse(doc.data())
    if (parsed.success) schedules.push(parsed.data)
    else console.error("invoiceSchedulesService: skipping unparseable schedule", doc.id, parsed.error.issues)
  }
  return schedules.sort((a, b) => a.status.localeCompare(b.status) || a.nextDate.localeCompare(b.nextDate))
}

// From an invoice (just made, or one sent earlier): it's the first, and the
// next comes one period after it — never today or earlier.
export async function createInvoiceSchedule(workspaceId: string, uid: string, raw: unknown): Promise<InvoiceScheduleType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoiceScheduleCreateInputSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid repeating invoice", formatIssues(parsed.error))
  const input = parsed.data
  const ref = invoiceSchedulesCol(workspaceId).doc(`cmid_${input.clientMutationId}`)
  const { today } = await businessNow(workspaceId)
  return db.runTransaction(async (txn) => {
    const [existingSnap, invoiceSnap] = await txn.getAll(ref, invoicesCol(workspaceId).doc(input.invoiceId))
    if (existingSnap.exists) return readSchedule(existingSnap.data())
    const parsedInvoice = InvoiceSchema.safeParse(invoiceSnap.data())
    if (!parsedInvoice.success) throw new NotFoundError("Invoice not found")
    const invoice = parsedInvoice.data
    if (invoice.status === "void") throw new ConflictError("A void invoice can't be repeated.")
    if (invoice.quickCharge) throw new ConflictError("A quick charge can't be repeated.")
    const nextDate = scheduleNextDateFrom(invoice.issueDate, input.frequency, today, { includeToday: false })
    if (scheduleEndReached(input.end, 1, nextDate)) throw new BadRequestError("It would end before the next invoice — pick a later end.")
    const nowIso = new Date().toISOString()
    const schedule = InvoiceScheduleSchema.parse({
      id: ref.id,
      workspaceId,
      clientName: invoice.clientName,
      clientId: invoice.clientId,
      clientEmail: invoice.clientEmail,
      clientPhone: invoice.clientPhone,
      clientAddress: invoice.clientAddress,
      lines: invoice.lines,
      total: invoice.total,
      note: invoice.note,
      policies: invoice.policies,
      dueInDays: Math.min(365, Math.max(0, daysBetween(invoice.issueDate, invoice.dueDate))),
      frequency: input.frequency,
      anchorDate: invoice.issueDate,
      nextDate,
      end: input.end,
      sendMode: input.sendMode,
      status: "active",
      invoicesMade: 1,
      lastInvoiceId: invoice.id,
      lastMadeOn: invoice.issueDate,
      sourceInvoiceId: invoice.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.create(ref, schedule)
    return schedule
  })
}

export async function updateInvoiceSchedule(workspaceId: string, uid: string, scheduleId: string, raw: unknown): Promise<InvoiceScheduleType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoiceSchedulePatchSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid repeating invoice changes", formatIssues(parsed.error))
  const patch = parsed.data
  const ref = invoiceSchedulesCol(workspaceId).doc(scheduleId)
  const { today } = await businessNow(workspaceId)
  // A renamed client is found or saved like an invoice's (before the transaction).
  const clientId =
    patch.action === "edit" && patch.clientName !== undefined
      ? (
          await resolveInvoiceClient(workspaceId, {
            clientName: patch.clientName,
            clientEmail: patch.clientEmail,
            clientPhone: patch.clientPhone,
            clientAddress: patch.clientAddress,
          })
        ).id
      : undefined

  return db.runTransaction(async (txn) => {
    const current = readSchedule((await txn.get(ref)).data())
    const nowIso = new Date().toISOString()
    let next: InvoiceScheduleType
    if (patch.action === "stop") {
      if (current.status === "ended") return current
      next = { ...current, status: "ended", endedAt: nowIso }
    } else if (current.status === "ended") {
      throw new ConflictError("This repeating invoice has ended — start a new one from an invoice.")
    } else if (patch.action === "pause") {
      next = { ...current, status: "paused" }
    } else if (patch.action === "resume") {
      if (current.status === "active") return current
      // The dates it was paused for are skipped; today's still counts.
      const nextDate = scheduleNextDateFrom(current.anchorDate, current.frequency, afterLastMade(current, today), { includeToday: true })
      next = scheduleEndReached(current.end, current.invoicesMade, nextDate)
        ? { ...current, nextDate, status: "ended", endedAt: nowIso }
        : { ...current, nextDate, status: "active" }
    } else {
      const { action: _action, ...changes } = patch
      const lines = changes.lines ?? current.lines
      const frequency = changes.frequency ?? current.frequency
      const end = changes.end ?? current.end
      // A new frequency starts from the next date on its own schedule.
      const nextDate =
        frequency === current.frequency
          ? current.nextDate
          : firstScheduleDateFrom(current.anchorDate, frequency, afterLastMade(current, today))
      next = {
        ...current,
        ...changes,
        clientId: clientId ?? current.clientId,
        clientEmail: changes.clientEmail === undefined ? current.clientEmail : changes.clientEmail || null,
        clientPhone: changes.clientPhone === undefined ? current.clientPhone : changes.clientPhone || null,
        clientAddress: changes.clientAddress === undefined ? current.clientAddress : changes.clientAddress || null,
        lines,
        total: invoiceTotalFromLines(lines),
        frequency,
        end,
        nextDate,
      }
      if (scheduleEndReached(end, current.invoicesMade, nextDate)) {
        throw new BadRequestError("That end has already passed — pick a later one, or stop it instead.")
      }
    }
    const saved = InvoiceScheduleSchema.parse({ ...next, updatedAt: nowIso })
    txn.set(ref, saved)
    return saved
  })
}

// The earliest a schedule's next invoice can be: tomorrow if one was already
// made today, else today.
function afterLastMade(schedule: InvoiceScheduleType, today: string): string {
  return schedule.lastMadeOn && schedule.lastMadeOn >= today ? addScheduleDays(schedule.lastMadeOn, 1) : today
}

// ---------------------------------------------------------------------------
// The hourly job
// ---------------------------------------------------------------------------

/** Makes a schedule's invoice if one is due today; returns it when it was made just now. */
export async function runInvoiceSchedule(
  workspaceId: string,
  ownerId: string,
  scheduleRef: FirebaseFirestore.DocumentReference,
  today: string
): Promise<{ invoice: InvoiceType; schedule: InvoiceScheduleType } | null> {
  const made = await db.runTransaction(async (txn) => {
    const schedule = readSchedule((await txn.get(scheduleRef)).data())
    const plan = planScheduleRun(schedule, today)
    if (plan.kind === "wait") return null
    const nowIso = new Date().toISOString()
    if (plan.kind === "end") {
      txn.set(scheduleRef, InvoiceScheduleSchema.parse({ ...schedule, status: "ended", endedAt: nowIso, updatedAt: nowIso }))
      return null
    }
    const invoiceRef = invoicesCol(workspaceId).doc(`sched_${schedule.id}_${plan.date}`)
    const [invoiceSnap, counterSnap] = await txn.getAll(invoiceRef, counterDoc(workspaceId))
    const nextSchedule = InvoiceScheduleSchema.parse({
      ...schedule,
      nextDate: plan.nextDate,
      invoicesMade: invoiceSnap.exists ? schedule.invoicesMade : schedule.invoicesMade + 1,
      lastInvoiceId: invoiceRef.id,
      lastMadeOn: plan.date,
      status: plan.endsAfter ? "ended" : schedule.status,
      endedAt: plan.endsAfter ? nowIso : schedule.endedAt,
      updatedAt: nowIso,
    })
    txn.set(scheduleRef, nextSchedule)
    // Already made (a retried run): just move the schedule on.
    if (invoiceSnap.exists) return null
    const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0)
    const invoice = InvoiceSchema.parse({
      id: invoiceRef.id,
      workspaceId,
      number: formatInvoiceNumber(lastNumber + 1),
      ...invoiceFieldsForSchedule(schedule, plan.date),
      status: "draft",
      scheduleId: schedule.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.create(invoiceRef, invoice)
    txn.set(counterDoc(workspaceId), { lastNumber: lastNumber + 1, updatedAt: nowIso }, { merge: true })
    return { invoice, schedule: nextSchedule, ref: invoiceRef }
  })
  if (!made) return null

  // Emailed when that's the schedule's choice and the client has an email;
  // otherwise (or if the email can't go out) it waits as a draft.
  let emailed = false
  if (made.schedule.sendMode === "email" && made.invoice.clientEmail) {
    try {
      const { emailInvoice } = await import("./invoiceEmailService.js")
      await emailInvoice(workspaceId, made.ref, { to: made.invoice.clientEmail })
      emailed = true
    } catch (error) {
      console.warn("invoiceSchedules: email failed, left as a draft", { workspaceId, invoiceId: made.invoice.id }, error)
    }
  }
  await notifyOwner(workspaceId, ownerId, made.invoice, made.schedule, emailed)
  return { invoice: made.invoice, schedule: made.schedule }
}

async function notifyOwner(
  workspaceId: string,
  ownerId: string,
  invoice: InvoiceType,
  schedule: InvoiceScheduleType,
  emailed: boolean
): Promise<void> {
  const wantedEmail = schedule.sendMode === "email"
  const title = emailed
    ? `Invoice #${invoice.number} sent to ${invoice.clientName}`
    : wantedEmail
      ? `Invoice #${invoice.number} for ${invoice.clientName} wasn't emailed`
      : `Invoice #${invoice.number} for ${invoice.clientName} is ready to send`
  const body = emailed
    ? `Your repeating invoice went out automatically.`
    : wantedEmail
      ? invoice.clientEmail
        ? "It couldn't be emailed just now — it's saved as a draft for you to send."
        : `${invoice.clientName} has no email on file — it's saved as a draft for you to send.`
      : "Your repeating invoice is saved as a draft — check it and send it."
  try {
    const { sendTransactionNotification } = await import("./pushNotificationService.js")
    await sendTransactionNotification(ownerId, { title, body, data: { deepLink: `stackin://invoices/${invoice.id}`, workspaceId } })
  } catch (error) {
    console.error("invoiceSchedules: push failed", { workspaceId, invoiceId: invoice.id }, error)
  }
}
