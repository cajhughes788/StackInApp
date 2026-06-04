// settingsCache.ts
import type { SettingsDocumentMeta } from "@shared/contracts/settingsSync"
import type { SettingsType } from "@shared/schemas/settings"

export interface SettingsCacheEntry {
  data: SettingsType
  meta?: SettingsDocumentMeta | null
  ts: number
}

export const settingsCache: Record<string, SettingsCacheEntry> = {}
export const SETTINGS_TTL_MS = 5 * 60 * 1000
