// storage/metadata.ts
// ------------------------------------------------------------
// Typed metadata wrapper around low-level raw storage.
// This layer:
//   • Adds MetaRecord typing
//   • Adds TTL handling
//   • Exposes getWithMeta, setWithMeta, clearWithMeta
//   • Knows NOTHING about entries, settings, tax profile, etc.
// ------------------------------------------------------------
import { readRaw, writeRaw, removeRaw, listKeysRaw } from "./base";
// ------------------------------------------------------------
// MetaRecord — the universal wrapper stored in storage
// ------------------------------------------------------------
export interface MetaRecord<T = any> {
    data: T;
    ts: number; // timestamp when stored
    ttl?: number; // ms TTL (optional — undefined means infinite)
    version: number; // reserved for future migrations
    updatedAt: string; // ISO timestamp for debugging
}
type MetaOptions = {
    ttlMs?: number;
    version?: number;
};
type GetMetaOptions = {
    expectedVersion?: number;
};
// ------------------------------------------------------------
// setWithMeta
// Writes an object wrapped inside a MetaRecord.
//
// Arguments:
//   key:     string
//   data:    arbitrary JSON-serializable object
//   ttlMs:   optional TTL in milliseconds
//
// Behavior:
//   • Serializes as { data, ts, ttl, version, updatedAt }
//   • If ttlMs is undefined or Infinity → TTL is effectively infinite.
// ------------------------------------------------------------
export async function setWithMeta<T>(key: string, data: T, ttlOrOptions?: number | MetaOptions): Promise<void> {
    const options: MetaOptions = typeof ttlOrOptions === "number" || typeof ttlOrOptions === "undefined"
        ? { ttlMs: ttlOrOptions }
        : ttlOrOptions;
    const record: MetaRecord<T> = {
        data,
        ts: Date.now(),
        ttl: options.ttlMs, // undefined or Infinity means infinite TTL
        version: options.version ?? 1,
        updatedAt: new Date().toISOString(),
    };
    await writeRaw(key, JSON.stringify(record));
}
// ------------------------------------------------------------
// getWithMeta
// Reads and parses a MetaRecord.
//
// Behavior:
//   • If no record exists → returns null
//   • If TTL is defined AND expired → removes record → returns null
//   • Otherwise returns the MetaRecord<T>
// ------------------------------------------------------------
export async function getWithMeta<T = any>(key: string, options: GetMetaOptions = {}): Promise<MetaRecord<T> | null> {
    const raw = await readRaw(key);
    if (!raw)
        return null;
    let parsed: MetaRecord<T>;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        // corrupted → delete and return null
        await removeRaw(key);
        return null;
    }
    if (typeof options.expectedVersion === "number" &&
        parsed.version !== options.expectedVersion) {
        ;
        await removeRaw(key);
        return null;
    }
    // TTL logic
    if (typeof parsed.ttl === "number") {
        // TTL defined AND not infinite
        if (parsed.ttl !== Infinity &&
            Date.now() - parsed.ts > parsed.ttl) {
            // TTL expired → remove it
            await removeRaw(key);
            return null;
        }
    }
    return parsed;
}
// ------------------------------------------------------------
// clearWithMeta
// Removes the entire MetaRecord associated with the key.
// ------------------------------------------------------------
export async function clearWithMeta(key: string): Promise<void> {
    await removeRaw(key);
}
export async function listKeysWithMeta(): Promise<string[]> {
    return await listKeysRaw();
}
export async function clearKeysWithMeta(matcher: (key: string) => boolean): Promise<void> {
    const keys = await listKeysWithMeta();
    for (const key of keys) {
        if (matcher(key)) {
            await clearWithMeta(key);
        }
    }
}
