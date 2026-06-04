export type PersistedCachePayload<T, K extends string> = {
  [P in K]: T;
} & {
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt?: number | null;
};

export function isPersistedCachePayload<T, K extends string>(
  value: unknown,
  dataKey: K
): value is PersistedCachePayload<T, K> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return dataKey in (value as Record<string, unknown>);
}
