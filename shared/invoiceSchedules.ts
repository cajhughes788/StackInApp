import type { InvoiceScheduleEnd, InvoiceScheduleFrequency, InvoiceScheduleType } from "./schemas/invoiceSchedule"

// ---------------------------------------------------------------------------
// Date rules for repeating invoices (shared/schemas/invoiceSchedule.ts),
// used by the hourly job and the app alike. Dates are YYYY-MM-DD; noon UTC
// anchors the math so a time zone or DST change never moves a day (as
// recurringSchedule.ts).
//
// Monthly and longer repeats keep the first invoice's day of the month,
// clamped to shorter months: started on the 31st → Feb 28 → Mar 31.
// ---------------------------------------------------------------------------

export const INVOICE_SCHEDULE_FREQUENCIES: InvoiceScheduleFrequency[] = ["weekly", "biweekly", "monthly", "quarterly", "yearly"]

export const INVOICE_SCHEDULE_FREQUENCY_LABELS: Record<InvoiceScheduleFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
}

const MONTHS: Partial<Record<InvoiceScheduleFrequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 }

function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00Z`)
}

export function addScheduleDays(date: string, days: number): string {
  const d = parseDay(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from one date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000)
}

/** The invoice date after `date`, keeping the anchor's day of the month. */
export function nextScheduleDate(date: string, frequency: InvoiceScheduleFrequency, anchorDate: string): string {
  if (frequency === "weekly") return addScheduleDays(date, 7)
  if (frequency === "biweekly") return addScheduleDays(date, 14)
  const current = parseDay(date)
  const months = current.getUTCMonth() + MONTHS[frequency]!
  const year = current.getUTCFullYear() + Math.floor(months / 12)
  const month = months % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(parseDay(anchorDate).getUTCDate(), lastDay)
  return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10)
}

/** The first invoice date on the schedule that's on or after `onOrAfter`. */
export function firstScheduleDateFrom(anchorDate: string, frequency: InvoiceScheduleFrequency, onOrAfter: string): string {
  let date = anchorDate
  for (let i = 0; date < onOrAfter && i < 10_000; i += 1) date = nextScheduleDate(date, frequency, anchorDate)
  return date
}

/** Whether a schedule that has made `invoicesMade` invoices is done before `nextDate`. */
export function scheduleEndReached(end: InvoiceScheduleEnd, invoicesMade: number, nextDate: string): boolean {
  if (end.type === "count") return invoicesMade >= end.count
  if (end.type === "date") return nextDate > end.date
  return false
}

export type ScheduleRun =
  | { kind: "wait" }
  // Make the invoice dated `date`; afterwards the schedule moves to `nextDate`
  // (or ends). Missed dates before `date` are skipped, never made late.
  | { kind: "make"; date: string; nextDate: string; endsAfter: boolean }
  // Its end came before another invoice was due.
  | { kind: "end" }

/** What the job does with a schedule today (the business's date). */
export function planScheduleRun(
  schedule: Pick<InvoiceScheduleType, "status" | "nextDate" | "frequency" | "anchorDate" | "end" | "invoicesMade">,
  today: string
): ScheduleRun {
  if (schedule.status !== "active" || schedule.nextDate > today) return { kind: "wait" }
  // After a gap, only the latest date that's due.
  let date = schedule.nextDate
  for (let next = nextScheduleDate(date, schedule.frequency, schedule.anchorDate); next <= today; ) {
    date = next
    next = nextScheduleDate(date, schedule.frequency, schedule.anchorDate)
  }
  if (scheduleEndReached(schedule.end, schedule.invoicesMade, date)) return { kind: "end" }
  const nextDate = nextScheduleDate(date, schedule.frequency, schedule.anchorDate)
  return { kind: "make", date, nextDate, endsAfter: scheduleEndReached(schedule.end, schedule.invoicesMade + 1, nextDate) }
}

/**
 * Where a schedule picks up from `today`: on resume (the dates it was paused
 * for are skipped), or when it's started from an invoice dated `anchorDate`
 * (its next one comes after both that invoice and today).
 */
export function scheduleNextDateFrom(anchorDate: string, frequency: InvoiceScheduleFrequency, today: string, options: { includeToday: boolean }): string {
  const after = options.includeToday ? today : addScheduleDays(today, 1)
  const first = firstScheduleDateFrom(anchorDate, frequency, after > anchorDate ? after : addScheduleDays(anchorDate, 1))
  return first
}

/** The invoice a schedule makes for `date`: what's billed, the client and its terms. */
export function invoiceFieldsForSchedule(schedule: InvoiceScheduleType, date: string) {
  return {
    clientName: schedule.clientName,
    clientId: schedule.clientId,
    clientEmail: schedule.clientEmail,
    clientPhone: schedule.clientPhone,
    clientAddress: schedule.clientAddress,
    lines: schedule.lines,
    total: schedule.total,
    note: schedule.note,
    policies: schedule.policies,
    issueDate: date,
    dueDate: addScheduleDays(date, schedule.dueInDays),
  }
}

/** "Monthly · next Dec 5" / "Paused" / "Ended" — the line under a schedule in lists. */
export function scheduleStatusLine(schedule: InvoiceScheduleType, formatDate: (date: string) => string): string {
  if (schedule.status === "ended") return "Ended"
  if (schedule.status === "paused") return `${INVOICE_SCHEDULE_FREQUENCY_LABELS[schedule.frequency]} · paused`
  return `${INVOICE_SCHEDULE_FREQUENCY_LABELS[schedule.frequency]} · next ${formatDate(schedule.nextDate)}`
}

/** "Never ends" / "6 invoices in all" / "Until Jun 30, 2027" */
export function scheduleEndLabel(end: InvoiceScheduleEnd, formatDate: (date: string) => string): string {
  if (end.type === "count") return `${end.count} invoices in all`
  if (end.type === "date") return `Until ${formatDate(end.date)}`
  return "Never ends"
}
