// Ask 521: turns "what was asked" (shared/voiceAsk.ts) into an answer from
// the person's own data, with the same math the app's screens use:
//   - self-employed income, tips and expenses: the P&L month statements
//     (whole months use the statement's total; part of a month adds up that
//     month's dated lines), plus unreported cash when Home shows it;
//   - W-2 pay, and hours for both: the entries, through
//     computeIncomeGaugeForEntries (what the income gauge uses);
//   - invoices: balance due and what's due now (shared/invoicePayments.ts);
//   - clients: buildClientRows (the Clients list's totals).
// Nothing here talks to a server; the caller hands in the data
// (frontend/lib/voiceAskData.ts). Claude never sees any of it.

import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge"
import { sumIndependentUnreportedCash } from "@shared/allIncome"
import { appointmentStatus } from "@shared/appointments"
import { clientKey, type ClientRow } from "@shared/clients"
import { invoiceBalanceDue, invoiceDueNow } from "@shared/invoicePayments"
import type { AppointmentType } from "@shared/schemas/appointment"
import type { EntryType } from "@shared/schemas/entry"
import type { InvoiceType } from "@shared/schemas/invoice"
import type { ProfitLossStatement } from "@shared/schemas/profitLoss"
import type { VoiceAskPaymentMethod, VoiceAskPeriod, VoiceAskResult, VoiceAskTopic } from "@shared/voiceAsk"
import type { AskFocus } from "@/lib/stores/useAskFocusStore"

/* ---------------- Periods ---------------- */

export type DateRange = { start: string; end: string; label: string; kind: VoiceAskPeriod["kind"] }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (n: number) => String(n).padStart(2, "0")
const key = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}
const parts = (date: string) => date.split("-").map(Number) as [number, number, number]
export const addDays = (date: string, days: number) => {
  const [y, m, d] = parts(date)
  return key(y, m, d + days)
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const weekday = (date: string) => {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "Nov 16" or "Nov 16, 2025" when not this year. */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = parts(date)
  return `${SHORT[m - 1]} ${d}${String(y) === today.slice(0, 4) ? "" : `, ${y}`}`
}

function spanLabel(start: string, end: string, today: string): string {
  const [, sm] = parts(start)
  const [, em, ed] = parts(end)
  return sm === em ? `${shortDate(start, today)}–${ed}` : `${shortDate(start, today)} – ${shortDate(end, today)}`
}

/** The period's first and last day. Weeks run Monday–Sunday. A month or
 * quarter named without a year is the latest one that has started. */
export function resolvePeriod(period: VoiceAskPeriod, today: string): DateRange {
  const [ty, tm] = parts(today)
  const kind = period.kind
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const range = (start: string, end: string, label: string): DateRange => ({ start, end, label, kind })
  switch (kind) {
    case "today":
      return range(today, today, "today")
    case "yesterday":
      return range(addDays(today, -1), addDays(today, -1), "yesterday")
    case "this_week":
      return range(monday, addDays(monday, 6), `this week (${spanLabel(monday, addDays(monday, 6), today)})`)
    case "last_week": {
      const start = addDays(monday, -7)
      return range(start, addDays(start, 6), `last week (${spanLabel(start, addDays(start, 6), today)})`)
    }
    case "this_month":
      return range(key(ty, tm, 1), key(ty, tm, lastDay(ty, tm)), `this month (${MONTHS[tm - 1]})`)
    case "last_month": {
      const y = tm === 1 ? ty - 1 : ty
      const m = tm === 1 ? 12 : tm - 1
      return range(key(y, m, 1), key(y, m, lastDay(y, m)), `last month (${MONTHS[m - 1]})`)
    }
    case "month": {
      const m = period.month ?? tm
      const y = period.year ?? (m <= tm ? ty : ty - 1)
      return range(key(y, m, 1), key(y, m, lastDay(y, m)), `in ${MONTHS[m - 1]}${y === ty ? "" : ` ${y}`}`)
    }
    case "this_quarter":
    case "last_quarter":
    case "quarter": {
      const current = Math.ceil(tm / 3)
      let q = kind === "quarter" ? period.quarter ?? current : current
      let y = kind === "quarter" ? period.year ?? (q <= current ? ty : ty - 1) : ty
      if (kind === "last_quarter") {
        q = current === 1 ? 4 : current - 1
        y = current === 1 ? ty - 1 : ty
      }
      const sm = (q - 1) * 3 + 1
      const name = `Q${q}${y === ty ? "" : ` ${y}`}`
      const label = kind === "this_quarter" ? `this quarter (${name})` : kind === "last_quarter" ? `last quarter (${name})` : `in ${name}`
      return range(key(y, sm, 1), key(y, sm + 2, lastDay(y, sm + 2)), label)
    }
    case "this_year":
      return range(`${ty}-01-01`, `${ty}-12-31`, `this year`)
    case "last_year":
      return range(`${ty - 1}-01-01`, `${ty - 1}-12-31`, `last year (${ty - 1})`)
    case "year": {
      const y = period.year ?? ty
      return range(`${y}-01-01`, `${y}-12-31`, y === ty ? "this year" : `in ${y}`)
    }
    case "day": {
      const date = period.date ?? today
      return range(date, date, date === today ? "today" : `on ${shortDate(date, today)}`)
    }
    case "all_time":
      return range("2000-01-01", "2100-12-31", "in all")
  }
}

const DEFAULT_PERIOD: Partial<Record<VoiceAskTopic, VoiceAskPeriod["kind"]>> = {
  income: "this_month",
  tips: "this_month",
  hours: "this_month",
  expenses: "this_month",
  profit: "this_month",
  compare_income: "this_month",
  appointments: "today",
  client_paid: "this_year",
}

export function periodOrDefault(period: VoiceAskPeriod | null, topic: VoiceAskTopic): VoiceAskPeriod {
  return period ?? { kind: DEFAULT_PERIOD[topic] ?? "this_month", month: null, quarter: null, year: null, date: null }
}

/** The calendar months ("2026-11") a range touches. */
export function monthsIn(range: { start: string; end: string }, today: string): string[] {
  const end = range.end < today ? range.end : today
  if (range.start > end) return []
  const months: string[] = []
  let [y, m] = parts(range.start)
  const [ey, em] = parts(end)
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${pad(m)}`)
    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }
  return months
}

/** "Comparing" another period: the same stretch so far, so this month to
 * date isn't measured against a whole month. */
export function sameStretch(range: DateRange, other: DateRange, today: string): DateRange {
  if (range.end <= today || range.start > today) return other
  const daysIn = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000)
  const end = addDays(other.start, daysIn)
  return { ...other, end: end < other.end ? end : other.end }
}

/* ---------------- Money ---------------- */

const round2 = (n: number) => Math.round(n * 100) / 100

export function money(amount: number): string {
  const value = round2(amount)
  const whole = Math.abs(value % 1) < 0.005
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

const inRange = (date: string, range: { start: string; end: string }) => date >= range.start && date <= range.end

function statementInRange(statement: ProfitLossStatement, range: { start: string; end: string }) {
  if (statement.periodEnd < range.start || statement.periodStart > range.end) return "none"
  return statement.periodStart >= range.start && statement.periodEnd <= range.end ? "whole" : "part"
}

/** Self-employed income from the P&L month statements: total, or one category. */
export function statementIncome(
  statements: ProfitLossStatement[],
  range: { start: string; end: string },
  category: "services" | "tips" | "products" | "other" | null = null
): number {
  let total = 0
  for (const statement of statements) {
    if (statement.periodType !== "month") continue
    const fit = statementInRange(statement, range)
    if (fit === "none") continue
    if (fit === "whole") {
      total += category ? statement.income[category] : statement.income.total
      continue
    }
    for (const group of statement.income.categories) {
      if (category && group.category !== category) continue
      for (const item of group.items) if (inRange(item.date, range)) total += item.amount
    }
    if (!category) for (const item of statement.income.refundItems) if (inRange(item.date, range)) total -= item.amount
  }
  return round2(total)
}

/** Self-employed expenses from the P&L month statements, all or one category. */
export function statementExpenses(statements: ProfitLossStatement[], range: { start: string; end: string }, category: string | null = null): number {
  const wanted = category ? category.trim().toLowerCase() : null
  let total = 0
  for (const statement of statements) {
    if (statement.periodType !== "month") continue
    const fit = statementInRange(statement, range)
    if (fit === "none") continue
    for (const group of statement.expenses.byCategory) {
      if (wanted && group.category.trim().toLowerCase() !== wanted) continue
      if (fit === "whole") total += group.amount
      else for (const item of group.items) if (inRange(item.date, range)) total += item.amount
    }
  }
  return round2(total)
}

export type AskData = {
  today: string
  nowIso: string
  workspaceType: "w2" | "independent"
  includeUnreported: boolean
  // Self-employed: the month statements covering the range(s) asked about.
  statements: ProfitLossStatement[]
  // Entries covering the range(s) asked about.
  entries: EntryType[]
  invoices: InvoiceType[]
  appointments: AppointmentType[]
  clientRows: ClientRow[]
}

export function incomeFor(data: AskData, range: { start: string; end: string }): number {
  const entries = data.entries.filter((entry) => inRange(entry.date, range))
  if (data.workspaceType === "w2") {
    return round2(computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: data.includeUnreported }).incomeGauge)
  }
  const unreported = data.includeUnreported ? sumIndependentUnreportedCash(entries) : 0
  return round2(statementIncome(data.statements, range) + unreported)
}

export function tipsFor(data: AskData, range: { start: string; end: string }): number {
  if (data.workspaceType === "w2") {
    return round2(data.entries.filter((entry) => inRange(entry.date, range)).reduce((sum, entry) => sum + Number(entry.w2?.tips ?? 0), 0))
  }
  return statementIncome(data.statements, range, "tips")
}

/** "through Venmo", "in cash": how an answer says the way they were paid. */
export const PAYMENT_PHRASE: Record<VoiceAskPaymentMethod, string> = {
  cash: "in cash",
  card: "by card",
  venmo: "through Venmo",
  apple_cash: "through Apple Cash",
  zelle: "through Zelle",
  check: "by check",
  cash_app: "through Cash App",
}

/** Self-employed income paid one way: the income lines saved with that
 * payment method (refund lines are already negative), plus unreported cash
 * for "cash" when Home shows it. Tips only, when asked. */
export function incomeByMethodFor(
  data: AskData,
  range: { start: string; end: string },
  method: VoiceAskPaymentMethod,
  tipsOnly = false
): number {
  let total = 0
  for (const entry of data.entries) {
    if (!inRange(entry.date, range)) continue
    for (const line of entry.independent?.incomeBreakdowns ?? []) {
      if (line.paymentMethod !== method) continue
      total += tipsOnly
        ? Number(line.tips ?? 0)
        : Number(line.services ?? 0) + Number(line.tips ?? 0) + Number(line.products ?? 0) + Number(line.other ?? 0)
    }
    if (method === "cash" && data.includeUnreported) {
      total += Number(entry.independent?.unreportedCashTips ?? 0) + (tipsOnly ? 0 : Number(entry.independent?.unreportedCash ?? 0))
    }
  }
  return round2(total)
}

export function hoursFor(data: AskData, range: { start: string; end: string }): number {
  const entries = data.entries.filter((entry) => inRange(entry.date, range))
  return round2(computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: false }).hours)
}

/* ---------------- Answers ---------------- */

export type AskLink = { label: string; href: string }

// What "Show me" lights up on the page it opens (see useAskFocusStore).
export type AskFocusTarget = Omit<AskFocus, "path" | "nonce">
export type AskShowMe = AskLink & { focus?: AskFocusTarget }

export type AskAnswer = {
  // The answer on screen, and what's read aloud (the same, without symbols that read badly).
  text: string
  speak: string
  // Extra lines (a profit's income and expenses, a comparison's two totals).
  details: string[]
  // Invoices or appointments to tap.
  items: Array<AskLink & { sub?: string }>
  // "Show me".
  link: AskShowMe | null
}

const answer = (text: string, extra: Partial<Omit<AskAnswer, "text">> = {}): AskAnswer => ({
  text,
  speak: extra.speak ?? text,
  details: extra.details ?? [],
  items: extra.items ?? [],
  link: extra.link ?? null,
})

const SELF_EMPLOYED_ONLY = new Set<VoiceAskTopic>(["expenses", "profit", "owed", "overdue", "appointments", "next_appointment", "client_paid"])

/** P&L link for a range: its month, quarter or year when it is one. */
export function plHref(range: DateRange): string {
  const [y, m] = parts(range.start)
  if (["this_month", "last_month", "month"].includes(range.kind)) return `/app/profitloss?type=month&key=${y}-${pad(m)}`
  if (["this_quarter", "last_quarter", "quarter"].includes(range.kind)) return `/app/profitloss?type=quarter&key=${y}-Q${Math.ceil(m / 3)}`
  if (["this_year", "last_year", "year"].includes(range.kind)) return `/app/profitloss?type=year&key=${y}`
  return `/app/profitloss?type=month&key=${y}-${pad(m)}`
}

function moneyLink(data: AskData, range: DateRange): AskLink {
  return data.workspaceType === "independent" ? { label: "Show me", href: plHref(range) } : { label: "Show me", href: "/app/earnings" }
}

/* ---------------- "Show me" ---------------- */

type Lit = { lines: string[]; open: string[] }
const NOTHING_LIT: Lit = { lines: [], open: [] }

const WHOLE_STATEMENT = new Set<DateRange["kind"]>([
  "this_month", "last_month", "month", "this_quarter", "last_quarter", "quarter", "this_year", "last_year", "year",
])

function joinNotes(...notes: Array<string | null | undefined>): string | null {
  const kept = notes.filter((note): note is string => !!note)
  return kept.length ? kept.join(" ") : null
}

/** The statement lines inside a range: income (one category, or all with refunds). */
function incomeLit(statement: ProfitLossStatement | null, range: { start: string; end: string }, only: string | null = null): Lit {
  if (!statement) return NOTHING_LIT
  const lit: Lit = { lines: [], open: [] }
  for (const group of statement.income.categories) {
    if (only && group.category !== only) continue
    const hits = group.items.filter((item) => inRange(item.date, range))
    if (hits.length === 0) continue
    lit.open.push(`income-${group.category}`)
    lit.lines.push(...hits.map((item) => item.id))
  }
  if (!only) {
    const refunds = statement.income.refundItems.filter((item) => inRange(item.date, range))
    if (refunds.length) {
      lit.open.push("income-refunds")
      lit.lines.push(...refunds.map((item) => item.id))
    }
  }
  return lit
}

/** The statement lines inside a range: expenses (one category, or all). */
function expenseLit(statement: ProfitLossStatement | null, range: { start: string; end: string }, category: string | null): Lit {
  if (!statement) return NOTHING_LIT
  const wanted = category ? category.trim().toLowerCase() : null
  const lit: Lit = { lines: [], open: [] }
  for (const group of statement.expenses.byCategory) {
    if (wanted && group.category.trim().toLowerCase() !== wanted) continue
    const hits = group.items.filter((item) => inRange(item.date, range))
    if (hits.length === 0) continue
    lit.open.push(`expense-${group.category}`)
    lit.lines.push(...hits.map((item) => item.id))
  }
  return lit
}

/** The P&L row key for an expense category, spelled as the statements spell it. */
function expenseRowKey(data: AskData, category: string): string {
  const wanted = category.trim().toLowerCase()
  for (const statement of data.statements) {
    const group = statement.expenses.byCategory.find((item) => item.category.trim().toLowerCase() === wanted)
    if (group) return `expense-${group.category}`
  }
  return `expense-${category}`
}

/** Income lines saved with one payment method, by the ids the statements give them. */
function methodLit(data: AskData, range: { start: string; end: string }, method: VoiceAskPaymentMethod, tipsOnly: boolean): Lit {
  const lines: string[] = []
  const open = new Set<string>()
  for (const entry of data.entries) {
    if (!inRange(entry.date, range) || entry.kind === "refund") continue
    for (const [index, line] of (entry.independent?.incomeBreakdowns ?? []).entries()) {
      if (line.paymentMethod !== method) continue
      for (const key of tipsOnly ? (["tips"] as const) : (["services", "tips", "products", "other"] as const)) {
        if (Number(line[key] ?? 0) <= 0) continue
        lines.push(`${entry.id ?? entry.date}-${index}-${key}`)
        open.add(`income-${key}`)
      }
    }
  }
  return { lines, open: [...open] }
}

/** "Show me" for a money answer. A whole month, quarter or year opens its own
 * statement on one spot (a total or a row); anything shorter opens the month
 * it ends in (up to today) with only the lines inside the range lit, so what's
 * lit adds up to the answer. */
function plShowMe(
  data: AskData,
  range: DateRange,
  banner: string,
  how: { spot: string | null; pick: (statement: ProfitLossStatement | null) => Lit; lit?: Lit; note?: string | null }
): AskShowMe {
  if (data.workspaceType !== "independent") return { label: "Show me", href: "/app/earnings" }
  if (range.kind === "all_time") return { label: "Show me", href: "/app/profitloss" }
  if (WHOLE_STATEMENT.has(range.kind)) {
    const lit = how.lit ?? null
    return {
      label: "Show me",
      href: plHref(range),
      focus: { banner, note: how.note ?? null, spot: lit ? null : how.spot, lines: lit?.lines ?? [], open: lit?.open ?? [] },
    }
  }
  const end = range.end < data.today ? range.end : data.today
  const [y, m] = parts(end)
  const monthKey = `${y}-${pad(m)}`
  const statement = data.statements.find((item) => item.periodType === "month" && item.periodKey === monthKey) ?? null
  const lit = how.lit ?? how.pick(statement)
  const earlier = range.start < `${monthKey}-01`
    ? `Some of this is in ${MONTHS[m === 1 ? 11 : m - 2]}; this is ${MONTHS[m - 1]}'s statement.`
    : null
  return {
    label: "Show me",
    href: `/app/profitloss?type=month&key=${monthKey}`,
    focus: { banner, note: joinNotes(how.note, earlier), spot: null, lines: lit.lines, open: lit.open },
  }
}

/** Unreported cash counted in an income answer, which no statement shows. */
function unreportedNote(data: AskData, range: { start: string; end: string }): string | null {
  if (data.workspaceType !== "independent" || !data.includeUnreported) return null
  const cash = round2(sumIndependentUnreportedCash(data.entries.filter((entry) => inRange(entry.date, range))))
  return cash > 0 ? `Includes ${money(cash)} unreported cash, which isn't on the statement.` : null
}

const METHOD_NAME: Record<VoiceAskPaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  venmo: "Venmo",
  apple_cash: "Apple Cash",
  zelle: "Zelle",
  check: "Check",
  cash_app: "Cash App",
}

function clockTime(time: string): string {
  const [h, m] = time.split(":").map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`
}

const OPEN_APPOINTMENT = new Set(["requested", "confirmed"])

function clientMatches(spoken: string, name: string): boolean {
  const said = clientKey(spoken)
  const full = clientKey(name)
  return !!said && (full === said || full.includes(said) || (!said.includes(" ") && full.split(" ")[0] === said))
}

/** The answer to a question, from the person's own data. */
export function answerQuestion(result: VoiceAskResult, data: AskData): AskAnswer {
  const topic = result.topic
  if (!topic) return cantAnswer()
  if (data.workspaceType === "w2" && SELF_EMPLOYED_ONLY.has(topic)) {
    return answer("That's for self-employed workspaces. Here you can ask about your pay, tips and hours.")
  }
  const today = data.today
  const range = resolvePeriod(periodOrDefault(result.period, topic), today)

  // Narrowed by something it can't split by: say so, never a bigger number.
  if (result.unsupported) {
    return answer(`I can't narrow that down to “${result.unsupported}” yet.`, {
      speak: `I can't narrow that down to ${result.unsupported} yet.`,
    })
  }
  const method = result.paymentMethod
  if (method) {
    if (data.workspaceType === "w2") return answer("W-2 entries don't save how you were paid, so I can't split that.")
    if (topic !== "income" && topic !== "tips" && topic !== "compare_income") {
      return answer("I can only split income and tips by how you were paid.")
    }
    const how = PAYMENT_PHRASE[method]
    const showMe = (total: number, tipsOnly = false) =>
      plShowMe(data, range, `${METHOD_NAME[method]}${tipsOnly ? " tips" : ""} ${range.label} · ${money(total)}`, {
        spot: null,
        pick: () => NOTHING_LIT,
        lit: methodLit(data, range, method, tipsOnly),
        note: method === "cash" ? unreportedNote(data, range) : null,
      })
    const note = "From income lines saved with that payment. Bank deposits without one aren't counted."
    if (topic === "compare_income") {
      const fallback: VoiceAskPeriod =
        range.kind === "this_week" || range.kind === "last_week"
          ? { kind: "last_week", month: null, quarter: null, year: null, date: null }
          : range.kind === "this_year"
            ? { kind: "last_year", month: null, quarter: null, year: null, date: null }
            : { kind: "last_month", month: null, quarter: null, year: null, date: null }
      const otherFull = resolvePeriod(result.comparePeriod ?? fallback, today)
      const other = sameStretch(range, otherFull, today)
      const a = incomeByMethodFor(data, range, method)
      const b = incomeByMethodFor(data, other, method)
      const diff = round2(a - b)
      const partial = other.end !== otherFull.end ? " at this point" : ""
      const verdict = diff === 0 ? "the same as" : diff > 0 ? `${money(diff)} more than` : `${money(-diff)} less than`
      return answer(`${money(a)} ${how} ${range.label}, ${verdict} ${otherFull.label}${partial}.`, {
        details: [`${capitalize(range.label)}: ${money(a)}`, `${capitalize(otherFull.label)}${partial}: ${money(b)}`, note],
        link: showMe(a),
      })
    }
    const tipsOnly = topic === "tips"
    const total = incomeByMethodFor(data, range, method, tipsOnly)
    const link = showMe(total, tipsOnly)
    if (total === 0) {
      return answer(`Nothing came in ${how} ${range.label}${tipsOnly ? " in tips" : ""}.`, { details: [note], link })
    }
    if (tipsOnly) return answer(`${money(total)} in tips ${how} ${range.label}.`, { details: [note], link })
    const verb = range.end < today ? "You made" : "You've made"
    return answer(`${verb} ${money(total)} ${how} ${range.label}.`, { details: [note], link })
  }

  switch (topic) {
    case "income": {
      const total = incomeFor(data, range)
      const verb = range.end < today ? "You made" : "You've made"
      return answer(`${verb} ${money(total)} ${range.label}.`, {
        link: plShowMe(data, range, `Income ${range.label} · ${money(total)}`, {
          spot: "income",
          pick: (statement) => incomeLit(statement, range),
          note: unreportedNote(data, range),
        }),
      })
    }
    case "tips": {
      const total = tipsFor(data, range)
      return answer(`${money(total)} in tips ${range.label}.`, {
        link: plShowMe(data, range, `Tips ${range.label} · ${money(total)}`, {
          spot: "income-tips",
          pick: (statement) => incomeLit(statement, range, "tips"),
        }),
      })
    }
    case "hours": {
      const hours = hoursFor(data, range)
      const shown = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, "")
      return answer(`${shown} hour${hours === 1 ? "" : "s"} worked ${range.label}.`, { link: moneyLink(data, range) })
    }
    case "expenses": {
      const total = statementExpenses(data.statements, range, result.category)
      const category = result.category
      return answer(`You spent ${money(total)}${category ? ` on ${category}` : ""} ${range.label}.`, {
        link: plShowMe(data, range, `${category ? capitalize(category) : "Spending"} ${range.label} · ${money(total)}`, {
          spot: category ? expenseRowKey(data, category) : "expenses-total",
          pick: (statement) => expenseLit(statement, range, category),
        }),
      })
    }
    case "profit": {
      const income = incomeFor(data, range)
      const expenses = statementExpenses(data.statements, range)
      const profit = round2(income - expenses)
      return answer(`Your profit ${range.label} is ${money(profit)}.`, {
        details: [`Income ${money(income)}`, `Expenses ${money(expenses)}`],
        link: plShowMe(data, range, `Profit ${range.label} · ${money(profit)}`, {
          spot: "net",
          pick: (statement) => {
            const a = incomeLit(statement, range)
            const b = expenseLit(statement, range, null)
            return { lines: [...a.lines, ...b.lines], open: [...a.open, ...b.open] }
          },
          note: unreportedNote(data, range),
        }),
      })
    }
    case "compare_income": {
      const fallback: VoiceAskPeriod =
        range.kind === "this_week" || range.kind === "last_week"
          ? { kind: "last_week", month: null, quarter: null, year: null, date: null }
          : range.kind === "this_year"
            ? { kind: "last_year", month: null, quarter: null, year: null, date: null }
            : { kind: "last_month", month: null, quarter: null, year: null, date: null }
      const otherFull = resolvePeriod(result.comparePeriod ?? fallback, today)
      const other = sameStretch(range, otherFull, today)
      const a = incomeFor(data, range)
      const b = incomeFor(data, other)
      const diff = round2(a - b)
      const partial = other.end !== otherFull.end ? " at this point" : ""
      const verdict = diff === 0 ? "the same as" : diff > 0 ? `${money(diff)} more than` : `${money(-diff)} less than`
      return answer(`${money(a)} ${range.label}, ${verdict} ${otherFull.label}${partial}.`, {
        details: [`${capitalize(range.label)}: ${money(a)}`, `${capitalize(otherFull.label)}${partial}: ${money(b)}`],
        link:
          data.workspaceType === "independent"
            ? plShowMe(data, range, `Income ${range.label} · ${money(a)}`, {
                spot: "income",
                pick: (statement) => incomeLit(statement, range),
                note: `${capitalize(otherFull.label)}${partial}: ${money(b)}.`,
              })
            : moneyLink(data, range),
      })
    }
    case "owed":
    case "overdue": {
      const rows: Array<{ invoice: InvoiceType; amount: number }> = []
      for (const invoice of data.invoices) {
        if (invoice.status !== "sent" || invoice.quickCharge) continue
        if (topic === "owed") {
          const due = invoiceBalanceDue(invoice)
          if (due > 0) rows.push({ invoice, amount: due })
        } else {
          const dueNow = invoiceDueNow(invoice)
          if (dueNow && dueNow.dueDate < today && dueNow.amount > 0) rows.push({ invoice, amount: dueNow.amount })
        }
      }
      rows.sort((x, y) => y.amount - x.amount)
      const total = round2(rows.reduce((sum, row) => sum + row.amount, 0))
      const who = rows.length === 1 ? "1 invoice" : `${rows.length} invoices`
      const link: AskShowMe = {
        label: "Show me",
        href: `/app/invoices?filter=${topic === "owed" ? "open" : "overdue"}`,
        focus: rows.length
          ? {
              banner: `${topic === "owed" ? "Owed to you" : "Overdue"} · ${money(total)} on ${who}`,
              note: null,
              spot: null,
              lines: rows.map(({ invoice }) => invoice.id),
              open: [],
            }
          : undefined,
      }
      if (rows.length === 0) return answer(topic === "owed" ? "Nobody owes you right now." : "Nothing is overdue.", { link })
      return answer(topic === "owed" ? `You're owed ${money(total)} on ${who}.` : `${money(total)} is overdue on ${who}.`, {
        items: rows.slice(0, 5).map(({ invoice, amount }) => ({
          label: `${invoice.clientName} · ${money(amount)}`,
          sub: `#${invoice.number}`,
          href: `/app/invoices/view?id=${encodeURIComponent(invoice.id)}`,
        })),
        link,
      })
    }
    case "appointments": {
      const list = data.appointments
        .filter((item) => inRange(item.date, range) && OPEN_APPOINTMENT.has(appointmentStatus(item, data.nowIso)))
        .sort((x, y) => `${x.date} ${x.startTime}`.localeCompare(`${y.date} ${y.startTime}`))
      const when = range.label
      const link: AskShowMe = {
        label: "Show me",
        href: range.start === range.end ? `/app/booking?date=${range.start}` : "/app/booking",
        focus: list.length
          ? {
              banner: `${list.length} appointment${list.length === 1 ? "" : "s"} ${when}`,
              note: null,
              spot: null,
              lines: list.map((item) => item.id),
              open: [],
            }
          : undefined,
      }
      if (list.length === 0) return answer(`Nothing booked ${when}.`, { link })
      const first = list[0]
      const items = list.slice(0, 6).map((item) => ({
        label: `${clockTime(item.startTime)} · ${item.clientName}`,
        sub: `${item.serviceName}${range.start === range.end ? "" : ` · ${shortDate(item.date, today)}`}`,
        href: `/app/booking/view?id=${encodeURIComponent(item.id)}`,
      }))
      return answer(
        `${list.length} appointment${list.length === 1 ? "" : "s"} ${when}, starting ${clockTime(first.startTime)} with ${first.clientName}.`,
        { items, link }
      )
    }
    case "next_appointment": {
      const next = data.appointments
        .filter((item) => item.startAt > data.nowIso && OPEN_APPOINTMENT.has(appointmentStatus(item, data.nowIso)))
        .filter((item) => !result.client || clientMatches(result.client, item.clientName))
        .sort((x, y) => x.startAt.localeCompare(y.startAt))
      if (next.length === 0) {
        return answer(result.client ? `${result.client} has nothing booked.` : "Nothing coming up.", { link: { label: "Show me", href: "/app/booking" } })
      }
      const item = next[0]
      const day = item.date === today ? "today" : item.date === addDays(today, 1) ? "tomorrow" : `on ${weekdayName(item.date)}, ${shortDate(item.date, today)}`
      return answer(`${item.clientName}, ${day} at ${clockTime(item.startTime)} — ${item.serviceName}.`, {
        link: { label: "Open it", href: `/app/booking/view?id=${encodeURIComponent(item.id)}` },
      })
    }
    case "client_paid": {
      if (!result.client) return cantAnswer()
      const rows = data.clientRows.filter((row) => clientMatches(result.client as string, row.name))
      if (rows.length === 0) return answer(`Couldn't find ${result.client} in your clients.`, { link: { label: "Show me", href: "/app/invoices?view=clients" } })
      if (rows.length > 1) {
        return answer(`Which ${result.client}?`, {
          items: rows.slice(0, 4).map((row) => ({ label: row.name, href: clientHref(row) })),
        })
      }
      const row = rows[0]
      const allTime = range.kind === "all_time"
      const note = !allTime && range.kind !== "this_year" ? " (client totals are kept for this year and all time)" : ""
      const amount = allTime ? row.lifetime : row.thisYear
      return answer(`${row.name} has paid you ${money(amount)} ${allTime ? "in all" : "this year"}${note}.`, {
        speak: `${row.name} has paid you ${money(amount)} ${allTime ? "in all" : "this year"}.`,
        link: { label: "Show me", href: clientHref(row) },
      })
    }
  }
}

function clientHref(row: ClientRow): string {
  return row.client ? `/app/invoices/client?id=${encodeURIComponent(row.client.id)}` : `/app/invoices/client?name=${encodeURIComponent(row.name)}`
}

function weekdayName(date: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(date)]
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const EXAMPLE_QUESTIONS = ["How much did I make this week?", "Who owes me?", "What's on tomorrow?"]

export function cantAnswer(): AskAnswer {
  return answer(`I can't answer that yet. Try "${EXAMPLE_QUESTIONS.join('", "')}"`, {
    speak: "I can't answer that yet.",
  })
}

/* ---------------- Pages ---------------- */

/** Where "open" goes; null when the page needs something it doesn't have. */
export function pageHref(result: VoiceAskResult, ctx: { today: string; workspaceType: "w2" | "independent"; clientRows: ClientRow[] }): AskLink | null {
  const period = result.period
  const independent = ctx.workspaceType === "independent"
  switch (result.page) {
    case "home":
      return { label: "Home", href: "/app/home" }
    case "pl":
      if (!independent) return { label: "Earnings", href: "/app/earnings" }
      return { label: "Profit & loss", href: period ? plHref(resolvePeriod(period, ctx.today)) : "/app/profitloss" }
    case "earnings":
      return { label: "Earnings", href: "/app/earnings" }
    case "expenses":
      return independent ? { label: "Expenses", href: "/app/home?mode=expenses" } : null
    case "invoices":
      return independent ? { label: "Invoices", href: "/app/invoices" } : null
    case "overdue":
      return independent ? { label: "Overdue invoices", href: "/app/invoices?filter=overdue" } : null
    case "unpaid":
      return independent ? { label: "Open invoices", href: "/app/invoices?filter=open" } : null
    case "quotes":
      return independent ? { label: "Quotes", href: "/app/invoices?filter=quotes" } : null
    case "clients":
      return independent ? { label: "Clients", href: "/app/invoices?view=clients" } : null
    case "client": {
      if (!independent || !result.client) return null
      const row = ctx.clientRows.find((item) => clientMatches(result.client as string, item.name))
      return row ? { label: row.name, href: clientHref(row) } : null
    }
    case "booking": {
      if (!independent) return null
      const date = period ? resolvePeriod(period, ctx.today) : null
      return { label: "Booking", href: date && date.start === date.end ? `/app/booking?date=${date.start}` : "/app/booking" }
    }
    case "receipts":
      return independent ? { label: "Receipts", href: "/app/receipts" } : null
    default:
      return null
  }
}

/** The forms a "log" can go to in this workspace. */
export function logTargetAllowed(form: VoiceAskResult["form"], workspaceType: "w2" | "independent"): boolean {
  if (!form) return false
  return workspaceType === "independent" || form === "entry"
}
