// storage/offlineQueue.ts
// ------------------------------------------------------------
// Offline Mutation Queue (domain-agnostic)
// ------------------------------------------------------------
// This module provides a tiny, self-contained queue system
// for storing pending mutations while offline.
//
// It does NOT:
// - compute entries
// - know schemas
// - know settings/tax/profile
// - handle replay logic
//
// Replay is done by the domain layer (entriesService, settingsService, etc.)
//
// This file only serializes/deserializes a list of mutations.
//
// ------------------------------------------------------------

import { writeRaw, readRaw, removeRaw } from "./base"

// Storage key used for the queue
const QUEUE_KEY = "offline.queue"

// Serializes all read-modify-write operations so concurrent calls cannot
// interleave their reads and writes (CR-E).
let _queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _queueLock.then(fn, fn);
  _queueLock = next.catch(() => {});
  return next;
}

// Shape of a single queued mutation
export type OfflineMutation = {
  id: string                // clientMutationId (idempotency key)
  ts: number               // timestamp (when queued)
  workspaceId?: string     // optional explicit workspace context
  endpoint: string         // REST endpoint URL
  method: "POST" | "PATCH" | "DELETE"
  body: any                // raw payload to send
}

// Helper to read the entire queue (internal)
async function readQueue(): Promise<OfflineMutation[]> {
  const raw = await readRaw(QUEUE_KEY)
  if (!raw) return []
  
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    // If corrupted, clear it for safety
    await removeRaw(QUEUE_KEY)
    return []
  }
}

/**
 * enqueue(mutation)
 * ------------------------------------------------------------
 * Add one mutation to the queue.
 * This is called when:
 * - device is offline
 * - API request fails
 */
export function enqueue(mutation: OfflineMutation): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue()
    queue.push(mutation)
    await writeRaw(QUEUE_KEY, JSON.stringify(queue))
  })
}

/**
 * drain()
 * ------------------------------------------------------------
 * Load and clear the queue.
 * Domain layer uses this at reconnect time.
 * Endpoints are already expected to be fully scoped
 * (for example, include workspace context when required):
 *
 * const mutations = await offlineQueue.drain()
 * for each mutation → try sending again
 *
 * Clearing ensures no duplicates.
 */
export function drain(): Promise<OfflineMutation[]> {
  return withQueueLock(async () => {
    const queue = await readQueue()
    await removeRaw(QUEUE_KEY)
    return queue
  })
}

/**
 * replaceAll(queue)
 * ------------------------------------------------------------
 * After replay attempts, some mutations may fail.
 * This writes back only the ones that failed.
 */
export async function replaceAll(queue: OfflineMutation[]): Promise<void> {
  if (!queue.length) {
    await removeRaw(QUEUE_KEY)
    return
  }
  await writeRaw(QUEUE_KEY, JSON.stringify(queue))
}

export async function peek(): Promise<OfflineMutation[]> {
  return readQueue()
}

export function removeMatching(
  matcher: (mutation: OfflineMutation) => boolean
): Promise<number> {
  return withQueueLock(async () => {
    const queue = await readQueue()
    const remaining = queue.filter((mutation) => !matcher(mutation))
    const removedCount = queue.length - remaining.length
    if (removedCount === 0) {
      return 0
    }
    await replaceAll(remaining)
    return removedCount
  })
}

function mutationMatchesWorkspace(
  mutation: OfflineMutation,
  workspaceId: string
): boolean {
  if (mutation.workspaceId === workspaceId) {
    return true
  }

  if (typeof mutation.endpoint === "string") {
    if (
      mutation.endpoint.includes(`workspaceId=${encodeURIComponent(workspaceId)}`) ||
      mutation.endpoint.includes(`workspaceId=${workspaceId}`) ||
      mutation.endpoint.includes(`/workspaces/${encodeURIComponent(workspaceId)}/`) ||
      mutation.endpoint.includes(`/workspaces/${workspaceId}/`)
    ) {
      return true
    }
  }

  return false
}

export async function clearWorkspaceQueue(workspaceId: string): Promise<void> {
  const queue = await readQueue()
  const remaining = queue.filter(
    (mutation) => !mutationMatchesWorkspace(mutation, workspaceId)
  )
  await replaceAll(remaining)
}

/**
 * clearQueue()
 * ------------------------------------------------------------
 * Completely wipe the queue.
 * Used on logout or major app reset.
 */
export async function clearQueue(): Promise<void> {
  await removeRaw(QUEUE_KEY)
}
