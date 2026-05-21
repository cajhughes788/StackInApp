import type {
  ProfitLossPeriodType,
  ProfitLossStatement,
} from "@shared/schemas/profitLoss"

import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

type ProfitLossResponse = { statements: ProfitLossStatement[] }

export async function getProfitLossStatements(
  workspaceId: string,
  periodType: ProfitLossPeriodType,
  ensureFresh = false
): Promise<ProfitLossStatement[]> {
  const data = await apiFetch<ProfitLossResponse>(
    `${API_ENDPOINTS.profitLoss.get}?workspaceId=${encodeURIComponent(workspaceId)}&periodType=${encodeURIComponent(periodType)}&ensureFresh=${ensureFresh ? "true" : "false"}`,
    { method: "GET" }
  )
  return data.statements ?? []
}

export async function generateProfitLossStatement(
  workspaceId: string,
  periodType: ProfitLossPeriodType,
  periodKey: string,
  force = true
): Promise<ProfitLossStatement> {
  const data = await tryWrite(
    `${API_ENDPOINTS.profitLoss.generate}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    { periodType, periodKey, force }
  )
  return (data as any).statement
}
