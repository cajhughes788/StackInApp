import { TaxProfile } from "@shared/schemas"

import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

type TaxProfileResponse = { taxProfile?: TaxProfile.Type; profile?: TaxProfile.Type }

export async function getTaxProfile(
  workspaceId: string
): Promise<TaxProfile.Type | null> {
  const data = await apiFetch<TaxProfileResponse>(
    `${API_ENDPOINTS.taxProfile.get}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" }
  )

  return data.taxProfile ?? data.profile ?? null
}

export async function saveTaxProfile(
  workspaceId: string,
  profile: TaxProfile.Type
) {
  const data = await tryWrite(
    `${API_ENDPOINTS.taxProfile.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    profile
  )

  return (data as any).taxProfile ?? (data as any).profile ?? null
}
