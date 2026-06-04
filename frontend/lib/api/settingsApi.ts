import type {
  SettingsGetResponse,
  SettingsSaveRequest,
  SettingsSaveResponse,
} from "@shared/contracts/settingsSync"
import { SettingsType, SettingsPatchType } from "@shared/schemas/settings"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"

export async function getSettings(workspaceId: string) {
  return apiFetch<SettingsGetResponse>(
    API_ENDPOINTS.settings.get(workspaceId),
    { method: "GET" }
  )
}

export async function patchSettings(
  workspaceId: string,
  request: SettingsSaveRequest | SettingsPatchType
) {
  return apiFetch<SettingsSaveResponse>(
    API_ENDPOINTS.settings.post(workspaceId),
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  )
}
