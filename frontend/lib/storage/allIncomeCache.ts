import { getWithMeta, setWithMeta, clearKeysWithMeta } from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import { CACHE_VERSIONS } from "./cacheVersions"
import type { AllIncomeSummary } from "@shared/allIncome"
import { z } from "zod"

// The last "All income" figures from the server, per month, so Home's card
// shows at once on the next launch while a fresh copy loads. Only the most
// recently viewed months are kept.

const MAX_MONTHS = 6

const AllIncomeRowSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  type: z.enum(["w2", "independent"]),
  income: z.number(),
  expenses: z.number().nullable(),
  activityCount: z.number().optional(),
  net: z.number().nullable(),
  previousIncome: z.number(),
})

const AllIncomeSummarySchema = z.object({
  month: z.string(),
  previousMonth: z.string(),
  total: z.number(),
  previousTotal: z.number(),
  change: z.number(),
  workspaces: z.array(AllIncomeRowSchema),
})

const PersistedAllIncomeSchema = z.record(
  z.string(),
  z.object({ savedAt: z.number(), summary: AllIncomeSummarySchema })
)

type PersistedAllIncome = z.infer<typeof PersistedAllIncomeSchema>

function allIncomeKey(uid: string): string {
  return `users::${uid}::allIncome`
}

async function readAll(uid: string): Promise<PersistedAllIncome> {
  const rec = await getWithMeta<PersistedAllIncome>(allIncomeKey(uid), { expectedVersion: CACHE_VERSIONS.allIncome })
  if (!rec?.data) return {}
  const parsed = safeSchemaParse(PersistedAllIncomeSchema, rec.data)
  return parsed.success ? parsed.data : {}
}

export async function readAllIncomeCache(uid: string, month: string): Promise<AllIncomeSummary | null> {
  const all = await readAll(uid)
  return (all[month]?.summary as AllIncomeSummary | undefined) ?? null
}

export async function saveAllIncomeCache(uid: string, summary: AllIncomeSummary): Promise<void> {
  const all = await readAll(uid)
  all[summary.month] = { savedAt: Date.now(), summary }
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_MONTHS)
  await setWithMeta<PersistedAllIncome>(allIncomeKey(uid), Object.fromEntries(kept), { version: CACHE_VERSIONS.allIncome })
}

export async function clearAllIncomeCache(): Promise<void> {
  await clearKeysWithMeta((key) => key.endsWith("::allIncome"))
}
