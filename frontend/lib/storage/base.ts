// ------------------------------------------------------------
// storage/base.ts  (UPDATED WITH ALL REQUESTED LOGS)
// ------------------------------------------------------------
// LOW-LEVEL STORAGE BACKEND
// Added ONLY the surgical logs requested.
// No logic changed. No existing logs removed.
// ------------------------------------------------------------
import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection, } from "@capacitor-community/sqlite";
import localforage from "localforage";
import { Preferences } from "@capacitor/preferences";
// ------------------------------------------------------------
// Platform Detection
// ------------------------------------------------------------
const isNative = Capacitor.isNativePlatform();
const webStore = localforage.createInstance({ name: "stackin-cache" });
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db: SQLiteDBConnection | null = null;
let dbInitPromise: Promise<SQLiteDBConnection> | null = null;
let encryptionReadyPromise: Promise<void> | null = null;
// ------------------------------------------------------------
// Logging Helper
// ------------------------------------------------------------
function trace(msg: string, ...rest: any[]) {
    ;
}
// ------------------------------------------------------------
// Encryption Key
// ------------------------------------------------------------
async function getEncryptionKey(): Promise<string> {
    trace("Retrieving encryption key...");
    const { value } = await Preferences.get({ key: "db_key" });
    if (value)
        return value;
    const newKey = crypto.randomUUID();
    await Preferences.set({ key: "db_key", value: newKey });
    trace("Created new encryption key");
    return newKey;
}
async function ensureEncryptionSecret(): Promise<void> {
    if (encryptionReadyPromise) {
        return encryptionReadyPromise;
    }
    encryptionReadyPromise = (async () => {
        const key = await getEncryptionKey();
        try {
            const secretState = await sqlite.isSecretStored();
            if (secretState.result) {
                trace("Encryption secret already stored");
                return;
            }
        }
        catch (err) {
            trace("Unable to check encryption secret state, proceeding to set it");
        }
        try {
            await sqlite.setEncryptionSecret(key);
            trace("Encryption secret initialized");
        }
        catch (err: any) {
            const message = err?.message ?? String(err ?? "");
            if (message.toLowerCase().includes("already") ||
                message.toLowerCase().includes("passphrase")) {
                trace("Encryption secret already configured");
                return;
            }
            throw err;
        }
    })().finally(() => {
        encryptionReadyPromise = null;
    });
    return encryptionReadyPromise;
}
// ------------------------------------------------------------
// SQLite Connection
// ------------------------------------------------------------
async function isDbOpen(conn: SQLiteDBConnection | null): Promise<boolean> {
    if (!conn)
        return false;
    try {
        if (typeof (conn as any).isDBOpen === "function") {
            const status = await (conn as any).isDBOpen();
            if (typeof status === "boolean")
                return status;
            if (status && typeof status === "object" && "result" in status) {
                return Boolean((status as {
                    result?: unknown;
                }).result);
            }
            return false;
        }
        await conn.query("SELECT 1");
        return true;
    }
    catch {
        return false;
    }
}
async function openConnection(): Promise<SQLiteDBConnection> {
    trace("Opening SQLite connection...");
    await ensureEncryptionSecret();
    let conn: SQLiteDBConnection;
    try {
        conn = await sqlite.createConnection("stackin_cache", true, "secret", 1, false);
    }
    catch (err: any) {
        const message = err?.message ?? err?.errorMessage ?? String(err ?? "");
        if (!message.includes("already exists")) {
            throw err;
        }
        trace("Reusing existing SQLite connection");
        conn = await sqlite.retrieveConnection("stackin_cache", false);
    }
    if (!(await isDbOpen(conn))) {
        trace("SQLite connection closed, opening now");
        await conn.open();
    }
    await conn.execute(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
    trace("SQLite connection ready");
    return conn;
}
async function ensureDb(): Promise<SQLiteDBConnection> {
    if (!isNative) {
        throw new Error("ensureDb() should not be called on web");
    }
    if (await isDbOpen(db))
        return db!;
    if (!dbInitPromise) {
        dbInitPromise = openConnection()
            .then((conn) => {
            db = conn;
            return conn;
        })
            .finally(() => {
            dbInitPromise = null;
        });
    }
    db = await dbInitPromise;
    return db;
}
// ------------------------------------------------------------
// Compression Helpers
// ------------------------------------------------------------
async function compress(s: string): Promise<string> {
    try {
        const mod = await import("lz-string");
        return mod.compressToUTF16(s);
    }
    catch {
        trace("Compression unavailable, storing raw");
        return s;
    }
}
async function decompress(s: string): Promise<string> {
    try {
        const mod = await import("lz-string");
        const out = mod.decompressFromUTF16(s);
        return typeof out === "string" ? out : s;
    }
    catch {
        trace("Decompression unavailable, using raw");
        return s;
    }
}
// ------------------------------------------------------------
// readRaw / writeRaw / removeRaw / listKeysRaw (UPDATED)
// ------------------------------------------------------------
export async function readRaw(key: string): Promise<string | null> {
    trace("readRaw:", key, "platform:", isNative ? "sqlite" : "indexeddb");
    try {
        if (isNative) {
            const conn = await ensureDb();
            const res = await conn.query("SELECT value FROM kv WHERE key = ?", [key]);
            const raw = res.values?.[0]?.value ?? null;
            const out = raw ? await decompress(raw) : null;
            // ------------------------------------------------------------
            // ADDED LOG: RESULT
            // ------------------------------------------------------------
            trace("readRaw:RESULT", key, out ? `(${out.length} chars)` : null);
            return out;
        }
        const raw = (await webStore.getItem<string>(key)) ?? null;
        const out = raw ? await decompress(raw) : null;
        // ------------------------------------------------------------
        // ADDED LOG: RESULT
        // ------------------------------------------------------------
        trace("readRaw:RESULT", key, out ? `(${out.length} chars)` : null);
        return out;
    }
    catch (err) {
        ;
        return null;
    }
}
export async function writeRaw(key: string, value: string): Promise<void> {
    trace("writeRaw:", key);
    try {
        const encoded = await compress(value);
        // ------------------------------------------------------------
        // ADDED LOG: COMPRESSED SIZE
        // ------------------------------------------------------------
        trace("writeRaw:COMPRESSED", key, `(${encoded.length} chars)`);
        if (isNative) {
            const conn = await ensureDb();
            await conn.run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [
                key,
                encoded,
            ]);
        }
        else {
            await webStore.setItem(key, encoded);
        }
    }
    catch (err) {
        ;
    }
}
export async function removeRaw(key: string): Promise<void> {
    trace("removeRaw:", key);
    try {
        if (isNative) {
            const conn = await ensureDb();
            await conn.run("DELETE FROM kv WHERE key = ?", [key]);
        }
        else {
            await webStore.removeItem(key);
        }
        // ------------------------------------------------------------
        // ADDED LOG: SUCCESS CONFIRMATION
        // ------------------------------------------------------------
        trace("removeRaw:SUCCESS", key);
    }
    catch (err) {
        ;
    }
}
export async function listKeysRaw(): Promise<string[]> {
    trace("listKeysRaw()");
    try {
        if (isNative) {
            const conn = await ensureDb();
            const res = await conn.query("SELECT key FROM kv");
            const keys = res.values?.map((r: any) => r.key) ?? [];
            // ------------------------------------------------------------
            // ADDED LOG: FULL KEYSPACE
            // ------------------------------------------------------------
            trace("listKeysRaw:RESULT", keys);
            return keys;
        }
        const keys: string[] = [];
        await webStore.iterate((_, key) => keys.push(key));
        // ------------------------------------------------------------
        // ADDED LOG: FULL KEYSPACE
        // ------------------------------------------------------------
        trace("listKeysRaw:RESULT", keys);
        return keys;
    }
    catch (err) {
        ;
        return [];
    }
}
