import { DateTime } from "luxon"
import { db } from "../admin"
import { InvoiceSchema, type InvoiceSettings, type InvoiceType } from "@shared/schemas/invoice"
import { buildInvoiceReminderEmail } from "@shared/invoiceEmail"
import { formatInvoiceDate, formatInvoiceMoney, publicInvoiceUrl } from "@shared/invoiceDisplay"
import { invoiceReminderDue, type InvoiceReminder } from "@shared/invoiceReminders"
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
// Plenty for five steps per amount owed; older ones are for past due dates.
const MAX_REMINDER_SENDS_KEPT = 20

type ClaimResult = { claimed: InvoiceType; reminder: InvoiceReminder } | "skip" | "workspace_capped"

// Sends every reminder due today in one workspace that has reminders on.
export async function sendDueInvoiceReminders(workspaceId: string, ownerId: string, now = Date.now()): Promise<number> {
  const settings = await readInvoiceSettings(workspaceId)
  if (!settings.autoReminders) return 0
  const settingsSnap = await db.doc(`workspaces/${workspaceId}/settings/current`).get()
  const timeZone = (settingsSnap.get("common.timeZone") as string | undefined) || DEFAULT_TIME_ZONE
  const today = DateTime.fromMillis(now).setZone(timeZone).toISODate() ?? new Date(now).toISOString().slice(0, 10)

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
