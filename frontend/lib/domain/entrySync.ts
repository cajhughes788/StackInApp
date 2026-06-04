import type { EntryType } from "@shared/schemas/entry"

export type EntryIdentityLike = {
  id?: string | null
  clientMutationId?: string | null
  periodId?: string | null
  syncState?: "pending" | "queued" | undefined
  updatedAtLocal?: string | null
  createdAtLocal?: string | null
}

export function getEntryIdentityValues(entry: EntryIdentityLike): string[] {
  return [entry.id, entry.clientMutationId].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  )
}

export function matchesEntryIdentity(
  left: EntryIdentityLike,
  right: EntryIdentityLike
): boolean {
  const leftIds = getEntryIdentityValues(left)
  const rightIds = getEntryIdentityValues(right)

  return leftIds.some((value) => rightIds.includes(value))
}

export function isLocalOnlyOptimisticEntry(entry: EntryIdentityLike): boolean {
  return typeof entry.id === "string" && entry.id.startsWith("tmp-")
}

export function hasPendingEntryMutation(entry: EntryIdentityLike): boolean {
  return entry.syncState === "pending" || entry.syncState === "queued"
}

export function getEntryRecency(entry: EntryIdentityLike): number | null {
  for (const value of [entry.updatedAtLocal, entry.createdAtLocal]) {
    if (typeof value !== "string" || value.length === 0) {
      continue
    }

    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return null
}

export function selectPreferredRenderableEntry(
  currentEntry: EntryType,
  nextEntry: EntryType
): EntryType {
  const currentIsLocalOnly = isLocalOnlyOptimisticEntry(currentEntry)
  const nextIsLocalOnly = isLocalOnlyOptimisticEntry(nextEntry)

  if (currentIsLocalOnly && !nextIsLocalOnly) {
    return nextEntry
  }

  if (!currentIsLocalOnly && nextIsLocalOnly) {
    return currentEntry
  }

  const currentHasPendingMutation = hasPendingEntryMutation(currentEntry)
  const nextHasPendingMutation = hasPendingEntryMutation(nextEntry)
  const currentRecency = getEntryRecency(currentEntry)
  const nextRecency = getEntryRecency(nextEntry)

  if (currentHasPendingMutation && !currentIsLocalOnly) {
    if (currentRecency !== null && nextRecency !== null && currentRecency >= nextRecency) {
      return currentEntry
    }

    if (currentRecency !== null && nextRecency === null) {
      return currentEntry
    }
  }

  if (nextHasPendingMutation && !nextIsLocalOnly) {
    if (nextRecency !== null && currentRecency !== null && nextRecency >= currentRecency) {
      return nextEntry
    }

    if (nextRecency !== null && currentRecency === null) {
      return nextEntry
    }
  }

  if (currentRecency !== null || nextRecency !== null) {
    if (currentRecency === null) {
      return nextEntry
    }

    if (nextRecency === null) {
      return currentEntry
    }

    return currentRecency >= nextRecency ? currentEntry : nextEntry
  }

  return nextEntry
}

function dedupeEntries(entries: EntryType[]): EntryType[] {
  const next: EntryType[] = []

  for (const entry of entries) {
    const existingIndex = next.findIndex((candidate) =>
      matchesEntryIdentity(candidate, entry)
    )

    if (existingIndex === -1) {
      next.push(entry)
      continue
    }

    next[existingIndex] = selectPreferredRenderableEntry(
      next[existingIndex],
      entry
    )
  }

  return next
}

export function reconcileRenderableEntries(
  backendEntries: EntryType[],
  currentEntries: EntryType[],
  periodId: string
): EntryType[] {
  const relevantCurrentEntries = currentEntries.filter(
    (entry) => entry.periodId === periodId
  )

  const merged = backendEntries.map((entry) => {
    const currentMatch = relevantCurrentEntries.find((candidate) =>
      matchesEntryIdentity(candidate, entry)
    )

    return currentMatch
      ? selectPreferredRenderableEntry(currentMatch, entry)
      : entry
  })

  for (const entry of relevantCurrentEntries) {
    if (merged.some((candidate) => matchesEntryIdentity(candidate, entry))) {
      continue
    }

    if (!isLocalOnlyOptimisticEntry(entry) && !hasPendingEntryMutation(entry)) {
      continue
    }

    merged.push(entry)
  }

  return dedupeEntries(merged)
}
