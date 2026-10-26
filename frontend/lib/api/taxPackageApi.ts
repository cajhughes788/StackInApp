import type { TaxPackageData } from "@shared/taxPackage"

import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function getTaxPackageSummary(workspaceId: string, year: number): Promise<TaxPackageData> {
  const data = await apiFetch<{ summary: TaxPackageData }>(
    `${API_ENDPOINTS.taxPackage.url}?workspaceId=${encodeURIComponent(workspaceId)}&year=${year}`,
    { method: "GET", timeout: 30000 }
  )
  return data.summary
}

export type TaxPackageResult = {
  url: string
  fileName: string
  sizeBytes: number
  receiptsIncluded: number
  receiptsLeftOut: number
}

export async function buildTaxPackage(workspaceId: string, year: number): Promise<TaxPackageResult> {
  // Reads every receipt for the year, so it can take a while.
  return apiFetch<TaxPackageResult>(API_ENDPOINTS.taxPackage.url, {
    method: "POST",
    body: JSON.stringify({ workspaceId, year }),
    timeout: 300000,
  })
}
