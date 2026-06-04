# Entry Synchronization Audit

## Current Flow Before Fix

1. `createEntry()` wrote an optimistic entry into the period cache and Zustand store immediately.
2. `removeEntry()` removed the row locally, but if the row was still optimistic it still targeted the temporary id for deletion.
3. `reconcileOptimisticEntry()` later replaced the temporary entry with the backend canonical entry when the create request returned.
4. `useEntriesStore.refreshFromBackend()` merged backend rows with whatever was already in memory instead of treating the backend snapshot as authoritative.
5. IndexedDB cache writes reused the metadata timestamp from the cache write itself, so a locally mutated cache could later be mistaken for a recent backend sync on the next app launch.

## Exact Root Causes

### 1. Delete-after-create race

If a user created an entry and deleted it before the create request finished:

- the frontend removed the temporary row locally
- the delete request used the temporary id
- the backend delete became a no-op because the canonical row did not exist yet
- the late create response wrote the canonical row back into cache and store

That was the most direct reason deleted entries could reappear.

### 2. Backend refresh was not authoritative

`useEntriesStore` appended unmatched current entries back into the visible list during hydration and refresh. That meant a backend payload could omit an entry, but the client would still keep the older local copy alive.

### 3. No persistent deletion tombstone

There was no persisted guard telling:

- cache hydration
- offline replay
- backend refresh reconciliation
- late create reconciliation

that a given entry had already been deleted by the user.

### 4. Cached write time was treated as backend sync time

Entry cache metadata only stored the generic cache write timestamp. Local optimistic writes could therefore make stale local data look like a fresh backend snapshot after a restart.

## Where Stale Data Entered

- Late create reconciliation in `frontend/lib/domain/entriesService.ts`
- Store merge logic in `frontend/lib/stores/useEntriesStore.ts`
- Offline replay success handling in `frontend/lib/api/core/offlineReplay.ts`
- Cache hydration metadata in `frontend/lib/storage/domainEntries.ts` and `frontend/lib/domain/entriesRepository.ts`

## Refactor Plan Applied

### Store

- replaced union-style merge behavior with a deterministic reconciliation step
- preserved only true in-flight optimistic entries that still have pending local mutations
- filtered deleted identities before backend data is rendered

### Cache

- added persistent entry deletion guards in IndexedDB-backed metadata storage
- persisted `lastBackendSync` separately from cache write time
- bumped the entries cache version to migrate the old shape safely

### Backend refresh cycle

- treated backend payloads as the canonical source unless a still-pending local mutation exists
- auto-issued cleanup deletes when a guarded/deleted entry still came back from the backend

### Backend create path

- added `clientMutationId` idempotency lookup for entries, matching the stronger expense flow

## Final Implementation

- `frontend/lib/storage/entryDeletionGuards.ts`
  Persistent tombstones keyed by workspace so deleted entries stay suppressed across hydration, replay, and refresh.

- `frontend/lib/domain/entrySync.ts`
  Canonical reconciliation helpers for entry identity, optimistic state, and backend-vs-local merge rules.

- `frontend/lib/domain/entriesService.ts`
  Deletes now register guards first, cancel queued creates for optimistic rows, and ignore late create responses by deleting the canonical row if it arrives after the user already deleted it.

- `frontend/lib/stores/useEntriesStore.ts`
  Refresh and hydration now filter guarded entries and stop re-appending stale unmatched rows.

- `frontend/lib/api/core/offlineReplay.ts`
  Replay now respects deletion guards and clears them when queued deletes succeed.

- `frontend/lib/storage/domainEntries.ts`
  Cache records now persist `lastBackendSync` explicitly instead of inferring it from local cache write time.

- `backend/functions/src/services/entriesService.ts`
  Create is now idempotent on `clientMutationId`, preventing duplicate canonical rows during retries.

## Expected Outcome

- deleted entries cannot rehydrate from IndexedDB after deletion
- a late create response cannot resurrect a row the user already deleted
- backend refreshes stop union-merging stale rows back into the homepage
- homepage refreshes should remain visually stable because the visible list now follows a single reconciliation strategy
