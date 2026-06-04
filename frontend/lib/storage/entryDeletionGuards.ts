import type { EntryType } from "@shared/schemas/entry"

import { matchesEntryIdentity, type EntryIdentityLike } from "@/lib/domain/entrySync"
import {
  clearWithMeta,
  getWithMeta,
  setWithMeta,
} from "@/lib/storage/metadata"

const ENTRY_DELETION_GUARDS_VERSION = 1
const GUARD_PREFIX = "entry-deletion-guards"
const STALE_GUARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type EntryDeletionGuard = {
  workspaceId: string
  periodId: string | null
  identities: Array<{
    id?: string
    clientMutationId?: string
  }>
  createdAt: number
  updatedAt: number
}

function makeGuardKey(workspaceId: string): string {
  return `${GUARD_PREFIX}:${workspaceId}`
}

function normalizeGuard(
  workspaceId: string,
  guard: EntryDeletionGuard
): EntryDeletionGuard {
  const identities = dedupeIdentities(guard.identities)

  return {
    workspaceId,
    periodId: guard.periodId ?? null,
    identities,
    createdAt: guard.createdAt,
    updatedAt: guard.updatedAt,
  }
}

function dedupeIdentities(
  identities: Array<{ id?: string; clientMutationId?: string }>
): Array<{ id?: string; clientMutationId?: string }> {
  const next: Array<{ id?: string; clientMutationId?: string }> = []

  for (const identity of identities) {
    const normalized = {
      ...(typeof identity.id === "string" && identity.id.length > 0
        ? { id: identity.id }
        : {}),
      ...(typeof identity.clientMutationId === "string" &&
      identity.clientMutationId.length > 0
        ? { clientMutationId: identity.clientMutationId }
        : {}),
    }

    if (!normalized.id && !normalized.clientMutationId) {
      continue
    }

    if (
      next.some(
        (candidate) =>
          candidate.id === normalized.id &&
          candidate.clientMutationId === normalized.clientMutationId
      )
    ) {
      continue
    }

    next.push(normalized)
  }

  return next
}

function pruneGuards(guards: EntryDeletionGuard[]): EntryDeletionGuard[] {
  const cutoff = Date.now() - STALE_GUARD_MAX_AGE_MS

  return guards.filter((guard) => guard.updatedAt >= cutoff)
}

function buildIdentity(entry: EntryIdentityLike): {
  id?: string
  clientMutationId?: string
} {
  return {
    ...(typeof entry.id === "string" && entry.id.length > 0 ? { id: entry.id } : {}),
    ...(typeof entry.clientMutationId === "string" && entry.clientMutationId.length > 0
      ? { clientMutationId: entry.clientMutationId }
      : {}),
  }
}

function matchesGuard(
  guard: EntryDeletionGuard,
  entry: EntryIdentityLike
): boolean {
  return guard.identities.some((identity) => matchesEntryIdentity(identity, entry))
}

async function persistGuards(
  workspaceId: string,
  guards: EntryDeletionGuard[]
): Promise<void> {
  const normalized = pruneGuards(
    guards
      .map((guard) => normalizeGuard(workspaceId, guard))
      .filter((guard) => guard.identities.length > 0)
  )

  const key = makeGuardKey(workspaceId)

  if (normalized.length === 0) {
    await clearWithMeta(key)
    return
  }

  await setWithMeta(key, normalized, {
    ttlMs: Infinity,
    version: ENTRY_DELETION_GUARDS_VERSION,
  })
}

export async function getDeletedEntryGuards(
  workspaceId: string
): Promise<EntryDeletionGuard[]> {
  const record = await getWithMeta<EntryDeletionGuard[]>(makeGuardKey(workspaceId), {
    expectedVersion: ENTRY_DELETION_GUARDS_VERSION,
  })

  const guards = pruneGuards(
    Array.isArray(record?.data) ? record.data.map((guard) => normalizeGuard(workspaceId, guard)) : []
  )

  if ((record?.data?.length ?? 0) !== guards.length) {
    await persistGuards(workspaceId, guards)
  }

  return guards
}

export async function rememberDeletedEntry(
  workspaceId: string,
  entry: EntryIdentityLike
): Promise<void> {
  const identity = buildIdentity(entry)
  if (!identity.id && !identity.clientMutationId) {
    return
  }

  const guards = await getDeletedEntryGuards(workspaceId)
  const now = Date.now()
  const existingIndex = guards.findIndex((guard) => matchesGuard(guard, entry))

  if (existingIndex === -1) {
    guards.push({
      workspaceId,
      periodId: entry.periodId ?? null,
      identities: [identity],
      createdAt: now,
      updatedAt: now,
    })
  } else {
    const existing = guards[existingIndex]
    guards[existingIndex] = {
      ...existing,
      periodId: entry.periodId ?? existing.periodId ?? null,
      identities: dedupeIdentities([...existing.identities, identity]),
      updatedAt: now,
    }
  }

  await persistGuards(workspaceId, guards)
}

export async function clearDeletedEntryGuard(
  workspaceId: string,
  entry: EntryIdentityLike
): Promise<void> {
  const guards = await getDeletedEntryGuards(workspaceId)
  const next = guards.filter((guard) => !matchesGuard(guard, entry))
  await persistGuards(workspaceId, next)
}

export async function clearWorkspaceDeletedEntryGuards(
  workspaceId: string
): Promise<void> {
  await clearWithMeta(makeGuardKey(workspaceId))
}

export async function hasDeletedEntryGuard(
  workspaceId: string,
  entry: EntryIdentityLike
): Promise<boolean> {
  const guards = await getDeletedEntryGuards(workspaceId)
  return guards.some((guard) => matchesGuard(guard, entry))
}

export async function splitDeletedEntries(
  workspaceId: string,
  entries: EntryType[]
): Promise<{
  visibleEntries: EntryType[]
  guardedEntries: EntryType[]
  guards: EntryDeletionGuard[]
}> {
  const guards = await getDeletedEntryGuards(workspaceId)
  const visibleEntries: EntryType[] = []
  const guardedEntries: EntryType[] = []

  for (const entry of entries) {
    if (guards.some((guard) => matchesGuard(guard, entry))) {
      guardedEntries.push(entry)
      continue
    }

    visibleEntries.push(entry)
  }

  return {
    visibleEntries,
    guardedEntries,
    guards,
  }
}
