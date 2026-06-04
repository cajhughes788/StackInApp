import type { SettingsPatchType, SettingsType } from "../schemas/settings"

export type SettingsSyncState =
  | "synced"
  | "saving"
  | "offline_pending"
  | "retrying"
  | "failed"

export interface SettingsDocumentMeta {
  updatedAt: string
  version: number
}

export interface SettingsGetResponse {
  ok: boolean
  settings: SettingsType | null
  meta: SettingsDocumentMeta | null
}

export interface SettingsSaveRequest {
  patch: SettingsPatchType
  expectedVersion?: number | null
}

export interface SettingsSaveResponse {
  ok: boolean
  settings: SettingsType
  meta: SettingsDocumentMeta
}

export interface SettingsConflictDetails {
  currentSettings: SettingsType | null
  currentMeta: SettingsDocumentMeta | null
}
