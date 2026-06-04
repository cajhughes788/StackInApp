"use client"

import { ApiError, isAbortError } from "../api/core/errors"
import type {
  SettingsConflictDetails,
  SettingsSyncState,
} from "../../../shared/contracts/settingsSync"
import {
  type SettingsPatchType,
  type SettingsType,
} from "../../../shared/schemas/settings"

export type SettingsSyncFailureKind =
  | "transient"
  | "validation"
  | "auth"
  | "forbidden"
  | "conflict"
  | "unknown"

// --------------------------------------------------------------
// Patch utilities
// --------------------------------------------------------------

export function hasSettingsPatch(
  patch?: SettingsPatchType | null
): patch is SettingsPatchType {
  return Boolean(
    patch &&
      ["common", "w2", "independent"].some(
        (section) => Object.keys((patch as Record<string, unknown>)[section] ?? {}).length > 0
      )
  )
}

export function normalizeSettingsPatch(
  patch?: SettingsPatchType | null
): SettingsPatchType | null {
  if (!patch) {
    return null
  }

  const normalized: SettingsPatchType = { ...patch }
  for (const key of ["common", "w2", "independent"] as const) {
    if (Object.keys(normalized[key] ?? {}).length === 0) {
      delete normalized[key]
    }
  }

  return hasSettingsPatch(normalized) ? normalized : null
}

export function mergeSettingsPatch(
  left?: SettingsPatchType | null,
  right?: SettingsPatchType | null
): SettingsPatchType | null {
  const merged: SettingsPatchType = {
    common: {
      ...(left?.common ?? {}),
      ...(right?.common ?? {}),
    },
    w2: {
      ...(left?.w2 ?? {}),
      ...(right?.w2 ?? {}),
    },
    independent: {
      ...(left?.independent ?? {}),
      ...(right?.independent ?? {}),
    },
  }

  return normalizeSettingsPatch(merged)
}

export function mergeSettings(
  base: SettingsType | null,
  patch?: SettingsPatchType | null
): SettingsType | null {
  const normalizedPatch = normalizeSettingsPatch(patch)
  if (!base) {
    return null
  }

  if (!normalizedPatch) {
    return base
  }

  return {
    common: {
      ...(base.common ?? {}),
      ...(normalizedPatch.common ?? {}),
    },
    w2: {
      ...(base.w2 ?? {}),
      ...(normalizedPatch.w2 ?? {}),
    },
    independent: {
      ...(base.independent ?? {}),
      ...(normalizedPatch.independent ?? {}),
    },
  }
}

// --------------------------------------------------------------
// Error classification
// --------------------------------------------------------------

export function classifySettingsSyncError(
  error: unknown,
  online: boolean
): {
  failureKind: SettingsSyncFailureKind
  retryable: boolean
  nextState: SettingsSyncState
} {
  if (isAbortError(error)) {
    return {
      failureKind: "unknown",
      retryable: false,
      nextState: "failed",
    }
  }

  if (error instanceof ApiError) {
    if (error.status === 400) {
      return {
        failureKind: "validation",
        retryable: false,
        nextState: "failed",
      }
    }

    if (error.status === 401) {
      return {
        failureKind: "auth",
        retryable: false,
        nextState: "failed",
      }
    }

    if (error.status === 403) {
      return {
        failureKind: "forbidden",
        retryable: false,
        nextState: "failed",
      }
    }

    if (error.status === 409) {
      return {
        failureKind: "conflict",
        retryable: false,
        nextState: "failed",
      }
    }
  }

  return {
    failureKind: "transient",
    retryable: true,
    nextState: online ? "retrying" : "offline_pending",
  }
}

export function getSettingsConflictDetails(
  error: unknown
): SettingsConflictDetails | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.details) {
    return null
  }

  const details = error.details as Partial<SettingsConflictDetails>
  return {
    currentSettings: details.currentSettings ?? null,
    currentMeta: details.currentMeta ?? null,
  }
}

// --------------------------------------------------------------
// Save-state status copy (used by settings/page.tsx)
// --------------------------------------------------------------

export function getSettingsSaveStatusCopy(
  state: import("@/lib/stores/useSettingsSaveStore").SettingsSaveState
): {
  label: string
  tone: "neutral" | "saving" | "success" | "error"
} {
  switch (state.status) {
    case "saving":
      return { label: "Saving…", tone: "saving" }
    case "synced":
      return { label: "Saved", tone: "success" }
    case "pending":
      return { label: "Pending Sync", tone: "neutral" }
    case "error":
      return { label: "Needs Attention", tone: "error" }
    case "idle":
    default:
      return { label: "Saved", tone: "neutral" }
  }
}
