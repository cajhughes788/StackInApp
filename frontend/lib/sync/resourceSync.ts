"use client";

export type ResourceSyncState =
  | "idle"
  | "hydrating"
  | "ready"
  | "revalidating"
  | "error";

export type ResourceSyncSource =
  | "bootstrap"
  | "cache"
  | "hint"
  | "backend"
  | "optimistic"
  | "unknown";

export type ResourceSyncMeta = {
  syncState: ResourceSyncState;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncSource | null;
};

export type ResourceSyncInput = Partial<ResourceSyncMeta>;

export function createResourceSyncMeta(
  overrides: ResourceSyncInput = {}
): ResourceSyncMeta {
  return {
    syncState: overrides.syncState ?? "idle",
    lastSuccessfulSyncAt: overrides.lastSuccessfulSyncAt ?? null,
    localUpdatedAt: overrides.localUpdatedAt ?? null,
    lastSyncSource: overrides.lastSyncSource ?? null,
  };
}

export function beginHydrationSync(
  current: ResourceSyncMeta,
  options: { hasRenderableData: boolean }
): ResourceSyncMeta {
  if (options.hasRenderableData) {
    return beginRevalidationSync(current, { source: "cache" });
  }

  return {
    ...current,
    syncState: "hydrating",
    lastSyncSource: "cache",
  };
}

export function beginRevalidationSync(
  current: ResourceSyncMeta,
  options: { source?: ResourceSyncSource } = {}
): ResourceSyncMeta {
  return {
    ...current,
    syncState: "revalidating",
    lastSyncSource: options.source ?? current.lastSyncSource ?? "unknown",
  };
}

export function completeSync(
  current: ResourceSyncMeta,
  options: {
    source: ResourceSyncSource;
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
  }
): ResourceSyncMeta {
  return {
    syncState: "ready",
    lastSuccessfulSyncAt:
      options.lastSuccessfulSyncAt ?? current.lastSuccessfulSyncAt,
    localUpdatedAt: options.localUpdatedAt ?? current.localUpdatedAt,
    lastSyncSource: options.source,
  };
}

export function failSync(
  current: ResourceSyncMeta,
  options: { hasRenderableData: boolean }
): ResourceSyncMeta {
  return {
    ...current,
    syncState: options.hasRenderableData ? "ready" : "error",
  };
}

export function markLocalUpdate(
  current: ResourceSyncMeta,
  options: { at?: number; source?: ResourceSyncSource } = {}
): ResourceSyncMeta {
  return {
    ...current,
    localUpdatedAt: options.at ?? Date.now(),
    lastSyncSource: options.source ?? "optimistic",
  };
}

export function isHydratingState(syncState: ResourceSyncState): boolean {
  return syncState === "hydrating";
}

export function isRevalidatingState(syncState: ResourceSyncState): boolean {
  return syncState === "revalidating";
}

export function shouldRevalidateByTtl(
  lastSuccessfulSyncAt: number | null,
  ttlMs: number,
  now = Date.now()
): boolean {
  if (lastSuccessfulSyncAt === null) {
    return true;
  }

  return now - lastSuccessfulSyncAt > ttlMs;
}

export function shouldForegroundRefresh(
  lastSuccessfulSyncAt: number | null,
  minAgeMs: number,
  now = Date.now()
): boolean {
  if (lastSuccessfulSyncAt === null) {
    return true;
  }

  return now - lastSuccessfulSyncAt >= minAgeMs;
}

export function preserveStableReference<T>(
  current: T,
  next: T,
  areEqual: (left: T, right: T) => boolean = areSerializedEqual
): T {
  return areEqual(current, next) ? current : next;
}

export function areSerializedEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
