import { SettingsType, SettingsPatchType } from "@shared/schemas/settings"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"

export async function getSettings(workspaceId: string) {
  return apiFetch<{ ok: boolean; settings: SettingsType | null }>(
    API_ENDPOINTS.settings.get(workspaceId),
    { method: "GET" }
  )
}

export async function patchSettings(
  workspaceId: string,
  patch: SettingsPatchType
) {
  return apiFetch<{ ok: boolean; settings: SettingsType }>(
    API_ENDPOINTS.settings.post(workspaceId),
    {
      method: "POST",
      body: JSON.stringify(patch),
    }
  )
}
