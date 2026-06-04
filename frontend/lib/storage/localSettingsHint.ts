/**
 * localSettingsHint.ts
 *
 * Stores a full settings snapshot in localStorage so the settings store can
 * be seeded synchronously at startup — before any IndexedDB or network reads
 * complete. This eliminates the async gap between workspace being available
 * and settingsLoading becoming false, allowing entries/expenses to begin
 * hydrating before the first paint.
 *
 * The hint is a fast-path initialiser only. It is always overwritten by the
 * authoritative IndexedDB/backend load, which arrives within ~100–200ms.
 * Stale hint data (wrong period, old settings) will be corrected by the real
 * load without any user action required.
 *
 * TTL: 24 hours. Settings change infrequently so a long TTL is safe.
 */

import { SettingsDocSchema, type SettingsType } from "@shared/schemas/settings"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"

const KEY_PREFIX = "stackin-settings-hint"
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type SettingsHint = {
  data: SettingsType
  writtenAt: number
}

function key(workspaceId: string): string {
  return `${KEY_PREFIX}-${workspaceId}`
}

export function writeSettingsHint(
  workspaceId: string,
  settings: SettingsType
): void {
  if (typeof window === "undefined") return
  try {
    const hint: SettingsHint = { data: settings, writtenAt: Date.now() }
    window.localStorage.setItem(key(workspaceId), JSON.stringify(hint))
  } catch {
    // Ignore quota errors — hint is best-effort
  }
}

export function readSettingsHint(workspaceId: string): SettingsType | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key(workspaceId))
    if (!raw) return null

    const hint = JSON.parse(raw) as Partial<SettingsHint>
    if (!hint.data || typeof hint.writtenAt !== "number") return null
    if (typeof hint.data !== "object" || Array.isArray(hint.data)) return null
    if (Date.now() - hint.writtenAt > TTL_MS) {
      window.localStorage.removeItem(key(workspaceId))
      return null
    }

    const parsed = safeSchemaParse(SettingsDocSchema, hint.data)
    if (!parsed.success) {
      window.localStorage.removeItem(key(workspaceId))
      return null
    }

    return parsed.data
  } catch {
    return null
  }
}

export function clearSettingsHint(workspaceId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key(workspaceId))
  } catch {}
}

export function clearAllSettingsHints(): void {
  if (typeof window === "undefined") return
  try {
    const keysToRemove = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(KEY_PREFIX)
    )
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k)
    }
  } catch {}
}
