import { invoiceDueNow } from "./invoicePayments"
import type { InvoiceType } from "./schemas/invoice"

// ---------------------------------------------------------------------------
// Automatic invoice reminders — which reminder an invoice is owed today.
//
// With InvoiceSettings.autoReminders on, the sendInvoiceRemindersDaily job
// emails the client before and after what they owe next is due: the deposit
// while it's outstanding, then the balance. Each step is sent once
// (InvoiceType.reminderSends), keyed by what was owed and its due date, so
// paying the deposit or moving the due date starts the steps over.
// ---------------------------------------------------------------------------

export const INVOICE_REMINDER_STEPS = [
  { step: "before_3", days: -3 },
  { step: "due", days: 0 },
  { step: "overdue_3", days: 3 },
  { step: "overdue_7", days: 7 },
  { step: "overdue_14", days: 14 },
] as const

export type InvoiceReminderStep = (typeof INVOICE_REMINDER_STEPS)[number]["step"]

export type InvoiceReminder = {
  key: string
  step: InvoiceReminderStep
  purpose: "deposit" | "balance"
  amount: number
  dueDate: string
  // The day (YYYY-MM-DD, business time) this step goes out.
  sendOn: string
}

// A missed daily run still sends the next day; anything older is skipped,
// so turning reminders on never emails a backlog of old steps.
const GRACE_DAYS = 1
// An invoice the user emailed this recently gets no reminder on top.
const MANUAL_EMAIL_QUIET_MS = 2 * 86_400_000

type ReminderInvoice = Pick<
  InvoiceType,
  | "status"
  | "quickCharge"
  | "total"
  | "payments"
  | "deposit"
  | "dueDate"
  | "pendingPayment"
  | "dispute"
  | "clientEmail"
  | "sharedAt"
  | "remindersPaused"
  | "reminderSends"
  | "lastEmailedAt"
>

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

// Whether reminders go to this client at all, timing aside: open, emailed
// or shared (the client has seen it), something owed, no payment clearing,
// no chargeback being decided, and not stopped by the user.
export function invoiceRemindersApply(invoice: ReminderInvoice): boolean {
  // A quick charge is paid at the counter or not at all; one the customer
  // will pay later is turned into a regular invoice first (convert_to_invoice).
  if (invoice.quickCharge) return false
  if (invoice.status !== "sent" || !invoice.clientEmail || !invoice.sharedAt) return false
  if (invoice.remindersPaused || invoice.pendingPayment) return false
  if (invoice.dispute?.status === "open" || invoice.dispute?.status === "inquiry") return false
  return invoiceDueNow(invoice) !== null
}

// The steps for what's owed next. Steps on or before the day the invoice
// was shared are dropped — the client just got it.
export function invoiceReminderSchedule(invoice: ReminderInvoice): InvoiceReminder[] {
  const dueNow = invoiceDueNow(invoice)
  if (!dueNow) return []
  const sharedOn = invoice.sharedAt?.slice(0, 10) ?? ""
  return INVOICE_REMINDER_STEPS.map(({ step, days }) => ({
    key: `${dueNow.purpose}:${dueNow.dueDate}:${step}`,
    step,
    purpose: dueNow.purpose,
    amount: dueNow.amount,
    dueDate: dueNow.dueDate,
    sendOn: addDays(dueNow.dueDate, days),
  })).filter((reminder) => reminder.sendOn > sharedOn)
}

// The reminder to send today, if any: the latest step whose day has come
// (within the grace day) and that hasn't gone out. `today` is YYYY-MM-DD in
// the business's time zone; `now` is epoch ms.
export function invoiceReminderDue(invoice: ReminderInvoice, today: string, now: number): InvoiceReminder | null {
  if (!invoiceRemindersApply(invoice)) return null
  if (invoice.lastEmailedAt && now - Date.parse(invoice.lastEmailedAt) < MANUAL_EMAIL_QUIET_MS) return null
  const sent = new Set(invoice.reminderSends.map((send) => send.key))
  const earliest = addDays(today, -GRACE_DAYS)
  const due = invoiceReminderSchedule(invoice).filter(
    (reminder) => reminder.sendOn <= today && reminder.sendOn >= earliest && !sent.has(reminder.key)
  )
  return due.length > 0 ? due[due.length - 1] : null
}

// The next reminder still to go out, for the invoice screen ("Next reminder
// Nov 4"). Today's counts until it's sent.
export function invoiceNextReminder(invoice: ReminderInvoice, today: string): InvoiceReminder | null {
  if (!invoiceRemindersApply(invoice)) return null
  const sent = new Set(invoice.reminderSends.map((send) => send.key))
  return invoiceReminderSchedule(invoice).find((reminder) => reminder.sendOn >= today && !sent.has(reminder.key)) ?? null
}
