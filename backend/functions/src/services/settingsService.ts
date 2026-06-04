// /backend/settingsService.ts
import type { SettingsConflictDetails, SettingsDocumentMeta } from "@shared/contracts/settingsSync"
import { findExpenseCategoryGuideEntry, normalizeExpenseCategory, sanitizeExpenseCategoryName } from "@shared/expenseCategories"
import {
  SettingsDocSchema,
  SettingsPatch,
  type SettingsPatchType,
  type SettingsType,
} from "@shared/schemas/settings"

import { db } from "../admin"
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../lib/httpErrors"
import {
  withBackendProfileStep,
  type BackendProfileTrace,
} from "../lib/profileTrace"
import { settingsCache, SETTINGS_TTL_MS } from "./settingsCache"

const noopTrace: BackendProfileTrace = {
  traceId: "settings-save-no-trace",
  flow: "settings_save",
  mark: () => {},
  start: () => {},
  end: () => {},
  error: () => {},
}

export type SettingsDocumentSnapshot = {
  settings: SettingsType | null
  meta: SettingsDocumentMeta | null
}

async function assertWorkspaceMembership(
  workspaceId: string,
  uid: string
): Promise<void> {
  const memberRef = db.doc(`users/${uid}/memberships/${workspaceId}`)
  const snap = await memberRef.get()
  if (!snap.exists) {
    throw new ForbiddenError("Forbidden")
  }
}

function mergeSettingsDocs(
  current: SettingsType | null,
  patch: Partial<SettingsType>
): SettingsType {
  return {
    ...(current ?? {}),
    common: {
      ...(current?.common ?? {}),
      ...(patch.common ?? {}),
    },
    w2: {
      ...(current?.w2 ?? {}),
      ...(patch.w2 ?? {}),
    },
    independent: {
      ...(current?.independent ?? {}),
      ...(patch.independent ?? {}),
    },
  }
}

function normalizeCustomExpenseCategories(
  categories: string[] | undefined
): string[] | undefined {
  if (!categories) {
    return categories
  }

  const normalizedCategories: string[] = []
  const seen = new Map<string, string>()

  for (const rawCategory of categories) {
    const sanitized = sanitizeExpenseCategoryName(rawCategory)
    if (!sanitized) {
      throw new BadRequestError("Custom expense categories cannot be blank.")
    }

    const builtInCategory = findExpenseCategoryGuideEntry(sanitized)
    if (builtInCategory) {
      throw new BadRequestError(
        `"${sanitized}" already exists as a built-in expense category.`
      )
    }

    const normalized = normalizeExpenseCategory(sanitized)
    const existing = seen.get(normalized)
    if (existing) {
      throw new BadRequestError(
        `"${sanitized}" duplicates "${existing}". Custom expense categories must be unique.`
      )
    }

    seen.set(normalized, sanitized)
    normalizedCategories.push(sanitized)
  }

  return normalizedCategories.length > 0 ? normalizedCategories : undefined
}

function normalizeSettingsDoc(settings: SettingsType): SettingsType {
  return {
    ...settings,
    independent: settings.independent
      ? {
          ...settings.independent,
          customExpenseCategories: normalizeCustomExpenseCategories(
            settings.independent.customExpenseCategories
          ),
        }
      : settings.independent,
  }
}

function parseSettingsOnly(raw: unknown): SettingsType | null {
  const parsed = SettingsDocSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

function extractSettingsMeta(raw: unknown): SettingsDocumentMeta | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const record = raw as Record<string, unknown>
  const version = record.version
  const updatedAt = record.updatedAt

  if (typeof version !== "number" || !Number.isFinite(version) || version < 1) {
    return null
  }

  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    return null
  }

  return {
    version,
    updatedAt,
  }
}

function buildConflictDetails(
  settings: SettingsType | null,
  meta: SettingsDocumentMeta | null
): SettingsConflictDetails {
  return {
    currentSettings: settings,
    currentMeta: meta,
  }
}

function getCurrentVersion(meta: SettingsDocumentMeta | null): number {
  return meta?.version ?? 0
}

function getSettingsDocRef(workspaceId: string) {
  return db.doc(`workspaces/${workspaceId}/settings/current`)
}

function getWorkspaceDocRef(workspaceId: string) {
  return db.doc(`workspaces/${workspaceId}`)
}

// Strip keys whose value is `undefined` before handing the document to
// Firestore. Firestore rejects `undefined` values with a hard 500 — this
// happens when normalizeCustomExpenseCategories returns `undefined` for an
// absent or empty categories list and the key is still present in the spread.
// JSON round-trip is the simplest way to deep-strip all undefined values
// without pulling in a dependency.
function stripUndefined(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj))
}

function serializeSettingsDocument(
  settings: SettingsType,
  meta: SettingsDocumentMeta
): Record<string, unknown> {
  return stripUndefined({
    ...settings,
    version: meta.version,
    updatedAt: meta.updatedAt,
  }) as Record<string, unknown>
}

async function readSettingsSnapshot(
  workspaceId: string
): Promise<SettingsDocumentSnapshot> {
  const ref = getSettingsDocRef(workspaceId)
  const snap = await ref.get()
  if (!snap.exists) {
    return {
      settings: null,
      meta: null,
    }
  }

  const raw = snap.data()
  return {
    settings: parseSettingsOnly(raw),
    meta: extractSettingsMeta(raw),
  }
}

export async function getSettings(
  workspaceId: string,
  uid: string
): Promise<SettingsDocumentSnapshot> {
  await assertWorkspaceMembership(workspaceId, uid)

  const cached = settingsCache[workspaceId]
  if (cached && Date.now() - cached.ts <= SETTINGS_TTL_MS) {
    return {
      settings: cached.data,
      meta: cached.meta ?? null,
    }
  }

  const snapshot = await readSettingsSnapshot(workspaceId)
  if (!snapshot.settings || !snapshot.meta) {
    return {
      settings: snapshot.settings,
      meta: snapshot.meta,
    }
  }

  settingsCache[workspaceId] = {
    data: snapshot.settings,
    meta: snapshot.meta,
    ts: Date.now(),
  }

  return snapshot
}

export async function patchSettings(
  workspaceId: string,
  uid: string,
  patch: unknown,
  options: {
    expectedVersion?: number | null
  } = {},
  trace?: BackendProfileTrace
): Promise<SettingsDocumentSnapshot> {
  const activeTrace = trace ?? noopTrace

  await withBackendProfileStep(
    activeTrace,
    "settings_save.membership_check",
    () => assertWorkspaceMembership(workspaceId, uid),
    { workspaceId, uid }
  )

  const patchValidated = SettingsPatch.parse(patch)
  let transactionAttempt = 0

  const committed = await withBackendProfileStep(
    activeTrace,
    "settings_save.firestore_write",
    () =>
      db.runTransaction(async (tx): Promise<SettingsDocumentSnapshot> => {
        transactionAttempt += 1
        const settingsRef = getSettingsDocRef(workspaceId)

        activeTrace.mark("settings_save.current_settings_fetch", {
          workspaceId,
          transactionAttempt,
          source: "settings_doc",
        })
        const currentSnap = await tx.get(settingsRef)
        const currentRaw = currentSnap.exists ? currentSnap.data() : null
        const currentSettings = parseSettingsOnly(currentRaw)
        const currentMeta = extractSettingsMeta(currentRaw)
        const currentVersion = getCurrentVersion(currentMeta)

        if (
          typeof options.expectedVersion === "number" &&
          options.expectedVersion !== currentVersion
        ) {
          throw new ConflictError(
            "Settings were updated somewhere else. Please reconcile with the latest version.",
            buildConflictDetails(currentSettings, currentMeta)
          )
        }

        const merged = normalizeSettingsDoc(
          mergeSettingsDocs(currentSettings, patchValidated)
        )
        const parsed = SettingsDocSchema.safeParse(merged)
        if (!parsed.success) {
          throw new Error("[patchSettings] Updated Firestore settings invalid")
        }

        const nextMeta: SettingsDocumentMeta = {
          version: currentVersion + 1,
          updatedAt: new Date().toISOString(),
        }

        tx.set(settingsRef, serializeSettingsDocument(parsed.data, nextMeta))

        // Embed settings snapshot in workspace doc so bootstrap can skip the
        // separate settings subcollection read when the snapshot is fresh.
        tx.update(getWorkspaceDocRef(workspaceId), {
          settingsSnapshot: {
            data: parsed.data,
            version: nextMeta.version,
            at: Date.now(),
          },
        })

        return {
          settings: parsed.data,
          meta: nextMeta,
        }
      }),
    {
      workspaceId,
      expectedVersion:
        typeof options.expectedVersion === "number" ? options.expectedVersion : null,
    }
  )

  if (!committed.settings || !committed.meta) {
    throw new Error("[patchSettings] Transaction committed without settings snapshot")
  }

  settingsCache[workspaceId] = {
    data: committed.settings,
    meta: committed.meta,
    ts: Date.now(),
  }

  return committed
}
