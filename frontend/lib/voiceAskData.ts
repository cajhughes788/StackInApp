// Ask 521: gathers what an answer needs (frontend/lib/voiceAskAnswer.ts)
// from the app's own stores and the same endpoints its screens use. Only
// what the question needs is loaded: a "who owes me" never fetches the P&L.

import { getEntriesForPeriod } from "@/lib/api/entriesApi"
import { generateProfitLossStatement, getProfitLossStatements } from "@/lib/api/profitLossApi"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { buildClientRows } from "@shared/clients"
import { EntrySchema, type EntryType } from "@shared/schemas/entry"
import type { ProfitLossStatement } from "@shared/schemas/profitLoss"
import type { VoiceAskResult } from "@shared/voiceAsk"
import { monthsIn, periodOrDefault, resolvePeriod, sameStretch, type AskData, type DateRange } from "@/lib/voiceAskAnswer"

const MONEY_TOPICS = new Set(["income", "tips", "hours", "expenses", "profit", "compare_income"])

/** The date ranges a question's numbers come from. */
export function rangesFor(result: VoiceAskResult, today: string): DateRange[] {
  if (!result.topic || !MONEY_TOPICS.has(result.topic)) return []
  const main = resolvePeriod(periodOrDefault(result.period, result.topic), today)
  if (result.topic !== "compare_income") return [main]
  const fallbackKind = main.kind === "this_week" || main.kind === "last_week" ? "last_week" : main.kind === "this_year" ? "last_year" : "last_month"
  const other = resolvePeriod(result.comparePeriod ?? { kind: fallbackKind, month: null, quarter: null, year: null, date: null }, today)
  return [main, sameStretch(main, other, today)]
}

export async function loadAskData(
  result: VoiceAskResult,
  ctx: { workspaceId: string; workspaceType: "w2" | "independent"; includeUnreported: boolean; today: string }
): Promise<AskData> {
  const { workspaceId, workspaceType, today } = ctx
  const topic = result.topic
  const ranges = rangesFor(result, today)
  const wantsInvoices = topic === "owed" || topic === "overdue" || topic === "client_paid" || result.page === "client"
  const wantsAppointments = topic === "appointments" || topic === "next_appointment"
  const wantsClients = topic === "client_paid" || result.page === "client"

  // Entries: W-2 money and hours for both. Self-employed income comes from
  // the P&L, plus unreported cash when Home shows it.
  const wantsEntries =
    ranges.length > 0 &&
    (workspaceType === "w2" || topic === "hours" || !!result.paymentMethod || (ctx.includeUnreported && topic !== "expenses"))
  const wantsStatements = ranges.length > 0 && workspaceType === "independent" && topic !== "hours"

  const start = ranges.reduce((min, range) => (range.start < min ? range.start : min), "9999-12-31")
  const endCap = ranges.reduce((max, range) => (range.end > max ? range.end : max), "0000-01-01")
  const end = endCap < today ? endCap : today

  const [entries, statements] = await Promise.all([
    wantsEntries && start <= end ? loadEntries(workspaceId, start, end) : Promise.resolve([] as EntryType[]),
    wantsStatements ? loadMonthStatements(workspaceId, ranges, today) : Promise.resolve([] as ProfitLossStatement[]),
    wantsInvoices ? useInvoicesStore.getState().load(workspaceId).catch(() => {}) : Promise.resolve(),
    wantsAppointments ? useAppointmentsStore.getState().load(workspaceId, { force: true }).catch(() => {}) : Promise.resolve(),
    wantsClients ? useClientsStore.getState().load(workspaceId).catch(() => {}) : Promise.resolve(),
  ])

  const invoices = useInvoicesStore.getState().byWorkspaceId[workspaceId]?.invoices ?? []
  const clientsEntry = useClientsStore.getState().byWorkspaceId[workspaceId]
  return {
    today,
    nowIso: new Date().toISOString(),
    workspaceType,
    includeUnreported: ctx.includeUnreported,
    statements,
    entries,
    invoices,
    appointments: useAppointmentsStore.getState().byWorkspaceId[workspaceId]?.appointments ?? [],
    clientRows: wantsClients ? buildClientRows(clientsEntry?.clients ?? [], clientsEntry?.payments ?? {}, invoices, today) : [],
  }
}

async function loadEntries(workspaceId: string, start: string, end: string): Promise<EntryType[]> {
  const raw = await getEntriesForPeriod(workspaceId, `${start}_${end}`)
  return (raw ?? []).flatMap((entry: unknown) => {
    const parsed = EntrySchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** The month statements for every month the ranges touch, made fresh when one's missing. */
async function loadMonthStatements(workspaceId: string, ranges: DateRange[], today: string): Promise<ProfitLossStatement[]> {
  const months = [...new Set(ranges.flatMap((range) => monthsIn(range, today)))]
  if (months.length === 0) return []
  const saved = await getProfitLossStatements(workspaceId, "month", true).catch(() => [] as ProfitLossStatement[])
  const byKey = new Map(saved.filter((statement) => statement.periodType === "month").map((statement) => [statement.periodKey, statement]))
  const missing = months.filter((month) => !byKey.has(month))
  const made = await Promise.all(missing.map((month) => generateProfitLossStatement(workspaceId, "month", month, false).catch(() => null)))
  for (const statement of made) if (statement) byKey.set(statement.periodKey, statement)
  return months.flatMap((month) => (byKey.get(month) ? [byKey.get(month) as ProfitLossStatement] : []))
}
