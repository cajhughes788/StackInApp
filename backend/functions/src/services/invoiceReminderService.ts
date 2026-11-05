import { DateTime } from "luxon"
import { db } from "../admin"
import { InvoiceSchema, type InvoiceSettings, type InvoiceType } from "@shared/schemas/invoice"
import { buildInvoiceReminderEmail } from "@shared/invoiceEmail"
import { formatInvoiceDate, formatInvoiceMoney, publicInvoiceUrl } from "@shared/invoiceDisplay"
import { invoiceDueNow } from "@shared/invoicePayments"
import { MAX_REMINDER_SENDS_KEPT, invoiceReminderDue, type InvoiceReminder } from "@shared/invoiceReminders"
import {
  DAY_MS,
  MAX_SENDS_PER_INVOICE_PER_DAY,
  MAX_SENDS_PER_WORKSPACE_PER_DAY,
  emailCounterDoc,
  sendInvoiceEmailMessage,
} from "./invoiceEmailService"
import { invoicesCol, readInvoiceSettings } from "./invoicesService"

// ---------------------------------------------------------------------------
// Automatic invoice reminders (sendInvoiceRemindersDaily).
//
// Which step is due is worked out in shared/invoiceReminders.ts. Each send
// is claimed on the invoice before the email goes out, so a retried run
// never sends a step twice; a failed send gives the claim back for the next
// run. Reminders count toward the same per-invoice and per-workspace caps as
// emails the user sends.
// ---------------------------------------------------------------------------

const DEFAULT_TIME_ZONE = "America/Los_Angeles"

type ClaimResult = { claimed: InvoiceType; reminder: InvoiceReminder } | "skip" | "workspace_capped"

// Today in the business's time zone (YYYY-MM-DD).
async function businessToday(workspaceId: string, now: number): Promise<string> {
  const settingsSnap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  const timeZone = (settingsSnap.get("common.timeZone") as string | undefined) || DEFAULT_TIME_ZONE
  return DateTime.fromMillis(now).setZone(timeZone).toISODate() ?? new Date(now).toISOString().slice(0, 10)
}

// Sends every reminder due today in one workspace that has reminders on.
export async function sendDueInvoiceReminders(workspaceId: string, ownerId: string, now = Date.now()): Promise<number> {
  const settings = await readInvoiceSettings(workspaceId)
  if (!settings.autoReminders) return 0
  const today = await businessToday(workspaceId, now)

  const openSnap = await invoicesCol(workspaceId).where("status", "==", "sent").get()
  let sent = 0
  for (const doc of openSnap.docs) {
    const parsed = InvoiceSchema.safeParse(doc.data())
    if (!parsed.success || !invoiceReminderDue(parsed.data, today, now)) continue
    try {
      const result = await sendInvoiceReminder(workspaceId, ownerId, doc.ref, settings, today, now)
      if (result === "workspace_capped") break
      if (result === "sent") sent += 1
    } catch (error) {
      console.error("invoiceReminders: reminder failed", { workspaceId, invoiceId: doc.id, error })
    }
  }
  return sent
}

async function sendInvoiceReminder(
  workspaceId: string,
  ownerId: string,
  ref: FirebaseFirestore.DocumentReference,
  settings: InvoiceSettings,
  today: string,
  now: number
): Promise<"sent" | "skip" | "workspace_capped"> {
  const sentAt = new Date(now).toISOString()
  const dayKey = sentAt.slice(0, 10)

  const claim: ClaimResult = await db.runTransaction(async (txn): Promise<ClaimResult> => {
    const [snap, counter] = await Promise.all([txn.get(ref), txn.get(emailCounterDoc(workspaceId))])
    const current = InvoiceSchema.safeParse(snap.data())
    if (!current.success) return "skip"
    const reminder = invoiceReminderDue(current.data, today, now)
    if (!reminder) return "skip"
    const recent = current.data.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS)
    if (recent.length >= MAX_SENDS_PER_INVOICE_PER_DAY) return "skip"
    const count = counter.data()?.date === dayKey ? Number(counter.data()?.count ?? 0) : 0
    if (count >= MAX_SENDS_PER_WORKSPACE_PER_DAY) return "workspace_capped"
    txn.set(emailCounterDoc(workspaceId), { date: dayKey, count: count + 1 }, { merge: true })
    const claimed = InvoiceSchema.parse({
      ...current.data,
      reminderSends: [...current.data.reminderSends, { key: reminder.key, sentAt }].slice(-MAX_REMINDER_SENDS_KEPT),
      recentEmailSends: [...recent, sentAt].slice(-10),
      updatedAt: sentAt,
    })
    txn.set(ref, claimed)
    return { claimed, reminder }
  })
  if (claim === "skip" || claim === "workspace_capped") return claim
  const { claimed: invoice, reminder } = claim

  try {
    const { invoiceOnlinePayment } = await import("./invoicePaymentsService.js")
    const online = await invoiceOnlinePayment(workspaceId, invoice).catch(() => ({ payable: false, bankTransfer: false }))
    const email = buildInvoiceReminderEmail({
      invoice,
      settings,
      link: publicInvoiceUrl(invoice.shareToken!),
      payableOnline: online.payable,
      step: reminder.step,
    })
    await sendInvoiceEmailMessage(invoice.clientEmail!, settings, email, "invoice_reminder")
  } catch (error) {
    await releaseClaim(ref, reminder.key, sentAt).catch((releaseError) =>
      console.error("invoiceReminders: couldn't release a failed claim", { invoiceId: invoice.id, releaseError })
    )
    throw error
  }

  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  const owed = `${formatInvoiceMoney(reminder.amount)}${reminder.purpose === "deposit" ? " deposit" : ""}`
  const when = reminder.step === "before_3" ? `due ${formatInvoiceDate(reminder.dueDate)}` : reminder.step === "due" ? "due today" : `was due ${formatInvoiceDate(reminder.dueDate)}`
  await sendTransactionNotification(ownerId, {
    title: `Reminder sent to ${invoice.clientName}`,
    body: `Invoice #${invoice.number}: ${owed} ${when}.`,
    data: { deepLink: `stackin://invoices/${invoice.id}`, workspaceId },
  }).catch((error) => console.error("invoiceReminders: owner notification failed", error))
  return "sent"
}

// Only invoices that went overdue in the last few days: older ones (say,
// everything already late when this shipped) don't all ping at once.
const OVERDUE_NOTICE_WINDOW_DAYS = 3

/**
 * Tells the owner, once, that an invoice went overdue — whether or not
 * automatic reminders are on, so a late invoice is never only found by
 * opening the app. The push opens the invoice (Send reminder, Text, Call);
 * several on one day become one push that opens the Overdue list.
 */
export async function notifyOverdueInvoices(workspaceId: string, ownerId: string, now = Date.now()): Promise<number> {
  const today = await businessToday(workspaceId, now)
  const earliest = DateTime.fromISO(today).minus({ days: OVERDUE_NOTICE_WINDOW_DAYS }).toISODate() ?? today

  const openSnap = await invoicesCol(workspaceId).where("status", "==", "sent").get()
  const newlyOverdue: { invoice: InvoiceType; amount: number }[] = []
  for (const doc of openSnap.docs) {
    const parsed = InvoiceSchema.safeParse(doc.data())
    if (!parsed.success || parsed.data.pendingPayment) continue
    const dueNow = invoiceDueNow(parsed.data)
    if (!dueNow || dueNow.dueDate >= today || dueNow.dueDate < earliest) continue
    const key = `${dueNow.purpose}:${dueNow.dueDate}`
    if (parsed.data.overdueNoticeKey === key) continue
    // Claimed first, so a retried run never pings twice.
    const claimed = await db.runTransaction(async (txn) => {
      const current = InvoiceSchema.safeParse((await txn.get(doc.ref)).data())
      if (!current.success || current.data.status !== "sent" || current.data.overdueNoticeKey === key) return false
      txn.set(doc.ref, InvoiceSchema.parse({ ...current.data, overdueNoticeKey: key }))
      return true
    })
    if (claimed) newlyOverdue.push({ invoice: parsed.data, amount: dueNow.amount })
  }
  if (newlyOverdue.length === 0) return 0

  // With automatic reminders off, nothing else follows up: say so. The
  // invoice screen links to the setting.
  const { autoReminders } = await readInvoiceSettings(workspaceId)
  const tail = autoReminders ? "" : " Or turn on automatic reminders so 521 follows up for you."
  const { sendTransactionNotification } = await import("./pushNotificationService.js")
  const [first] = newlyOverdue
  const payload =
    newlyOverdue.length === 1
      ? {
          title: `${first.invoice.clientName}'s invoice is overdue`,
          body: `Invoice #${first.invoice.number}: ${formatInvoiceMoney(first.amount)} was due ${formatInvoiceDate(invoiceDueNow(first.invoice)!.dueDate)}. Tap to send a reminder.${tail}`,
          data: { deepLink: `stackin://invoices/${first.invoice.id}`, workspaceId },
        }
      : {
          title: `${newlyOverdue.length} invoices are overdue`,
          body: `${formatInvoiceMoney(newlyOverdue.reduce((sum, item) => sum + item.amount, 0))} in all. Tap to see them and send reminders.${tail}`,
          data: { deepLink: "stackin://invoices/?filter=overdue", workspaceId },
        }
  await sendTransactionNotification(ownerId, payload).catch((error) =>
    console.error("invoiceReminders: overdue notification failed", { workspaceId, error })
  )
  return newlyOverdue.length
}

// The email didn't go out: the step can be tried again on the next run.
async function releaseClaim(ref: FirebaseFirestore.DocumentReference, key: string, sentAt: string): Promise<void> {
  await db.runTransaction(async (txn) => {
    const current = InvoiceSchema.safeParse((await txn.get(ref)).data())
    if (!current.success) return
    txn.set(
      ref,
      InvoiceSchema.parse({
        ...current.data,
        reminderSends: current.data.reminderSends.filter((send) => !(send.key === key && send.sentAt === sentAt)),
        recentEmailSends: current.data.recentEmailSends.filter((at) => at !== sentAt),
      })
    )
  })
}
