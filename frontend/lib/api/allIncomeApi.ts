import type { AllIncomeSummary } from "@shared/allIncome"

import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function getAllIncomeSummary(month: string): Promise<AllIncomeSummary> {
  const data = await apiFetch<{ summary: AllIncomeSummary }>(
    `${API_ENDPOINTS.allIncome.get}?month=${encodeURIComponent(month)}`,
    { method: "GET" }
  )
  return data.summary
}
