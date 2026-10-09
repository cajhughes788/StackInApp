"use client"

import {
  clearKeysWithMeta,
  clearWithMeta,
  getWithMeta,
  listKeysWithMeta,
  setWithMeta,
} from "./metadata"
import { CACHE_VERSIONS } from "./cacheVersions"

export type ReceiptMediaVariant = "preview" | "thumbnail"
export type ReceiptUrlVariant = "preview" | "thumbnail" | "original"

export type CachedReceiptMediaRecord = {
  workspaceId: string
  receiptAssetId: string
  variant: ReceiptMediaVariant
  version: number
  mimeType: string
  dataUrl: string
  cachedAt: string
}

const PREFIX = "receipt-media"

// Each cached preview is a ~2MB data URL in on-device storage, so only the
// most recent ones are kept (thumbnails are small and kept indefinitely).
// Older previews still load from Storage like any other receipt.
const MAX_CACHED_PREVIEWS = 20
// Save times per preview key, so pruning never has to read the large
// records themselves to find the oldest.
const PREVIEW_INDEX_KEY = "receipt-media-index:preview"
type PreviewIndex = Record<string, number>

function makeReceiptMediaKey(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant
): string {
  return `${PREFIX}:${workspaceId}:${receiptAssetId}:${variant}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Unable to cache receipt media."))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string" || result.length === 0) {
        reject(new Error("Unable to cache receipt media."))
        return
      }
      resolve(result)
    }
    reader.readAsDataURL(blob)
  })
}

async function saveReceiptMediaFromBlob(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant,
  version: number,
  blob: Blob,
  mimeType?: string
): Promise<CachedReceiptMediaRecord> {
  const dataUrl = await blobToDataUrl(blob)
  const record: CachedReceiptMediaRecord = {
    workspaceId,
    receiptAssetId,
    variant,
    version,
    mimeType: mimeType || blob.type || "image/jpeg",
    dataUrl,
    cachedAt: new Date().toISOString(),
  }

  const key = makeReceiptMediaKey(workspaceId, receiptAssetId, variant)
  await setWithMeta(key, record, {
    ttlMs: Infinity,
    version: CACHE_VERSIONS.receiptMedia,
  })

  if (variant === "preview") {
    // Not awaited: pruning shouldn't delay the capture that triggered it.
    void recordPreviewAndPrune(key)
  }

  return record
}

// Serializes index read-modify-writes when several previews save at once.
let previewIndexQueue: Promise<void> = Promise.resolve()

function recordPreviewAndPrune(savedKey: string): Promise<void> {
  const run = previewIndexQueue.then(async () => {
    const indexRecord = await getWithMeta<PreviewIndex>(PREVIEW_INDEX_KEY, {
      expectedVersion: CACHE_VERSIONS.receiptMedia,
    })
    const savedAt = { ...(indexRecord?.data ?? {}), [savedKey]: Date.now() }

    // Membership comes from the stored keys themselves, so entries removed
    // elsewhere (asset/workspace cache clears) drop out of the index, and
    // previews saved before this index existed count as oldest.
    const previewKeys = (await listKeysWithMeta()).filter(
      (key) => key.startsWith(`${PREFIX}:`) && key.endsWith(":preview")
    )
    previewKeys.sort((left, right) => (savedAt[right] ?? 0) - (savedAt[left] ?? 0))

    const kept = previewKeys.slice(0, MAX_CACHED_PREVIEWS)
    for (const key of previewKeys.slice(MAX_CACHED_PREVIEWS)) {
      await clearWithMeta(key)
    }

    const nextIndex: PreviewIndex = {}
    for (const key of kept) nextIndex[key] = savedAt[key] ?? 0
    await setWithMeta(PREVIEW_INDEX_KEY, nextIndex, {
      ttlMs: Infinity,
      version: CACHE_VERSIONS.receiptMedia,
    })
  })
  // Pruning is best-effort; never fail (or block later saves on) a capture.
  previewIndexQueue = run.catch(() => {})
  return previewIndexQueue
}

export async function saveReceiptMediaFromFile(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant,
  version: number,
  file: File
): Promise<CachedReceiptMediaRecord> {
  return saveReceiptMediaFromBlob(
    workspaceId,
    receiptAssetId,
    variant,
    version,
    file,
    file.type
  )
}

export async function loadReceiptMedia(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant,
  version?: number
): Promise<CachedReceiptMediaRecord | null> {
  const cached = await getWithMeta<CachedReceiptMediaRecord>(
    makeReceiptMediaKey(workspaceId, receiptAssetId, variant),
    {
      expectedVersion: CACHE_VERSIONS.receiptMedia,
    }
  )

  if (!cached?.data) {
    return null
  }

  if (typeof version === "number" && cached.data.version !== version) {
    return null
  }

  return cached.data
}

export async function clearReceiptMediaCache(workspaceId?: string): Promise<void> {
  const prefix = workspaceId ? `${PREFIX}:${workspaceId}:` : `${PREFIX}:`
  await clearKeysWithMeta((key) => key.startsWith(prefix))
}

export async function clearReceiptMediaForAsset(
  workspaceId: string,
  receiptAssetId: string
): Promise<void> {
  const binaryPrefix = `${PREFIX}:${workspaceId}:${receiptAssetId}:`
  const urlPrefix = `${URL_PREFIX}:${workspaceId}:${receiptAssetId}:`
  await clearKeysWithMeta((key) => key.startsWith(binaryPrefix) || key.startsWith(urlPrefix))
}

const URL_PREFIX = "receipt-url"

function makeReceiptUrlKey(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptUrlVariant
): string {
  return `${URL_PREFIX}:${workspaceId}:${receiptAssetId}:${variant}`
}

export async function saveReceiptMediaUrl(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptUrlVariant,
  url: string
): Promise<void> {
  await setWithMeta(
    makeReceiptUrlKey(workspaceId, receiptAssetId, variant),
    { url },
    { ttlMs: Infinity, version: CACHE_VERSIONS.receiptMedia }
  )
}

export async function loadReceiptMediaUrl(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptUrlVariant
): Promise<string | null> {
  const cached = await getWithMeta<{ url: string }>(
    makeReceiptUrlKey(workspaceId, receiptAssetId, variant),
    { expectedVersion: CACHE_VERSIONS.receiptMedia }
  )
  return cached?.data?.url ?? null
}
