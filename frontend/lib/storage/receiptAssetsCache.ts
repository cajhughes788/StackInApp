"use client"

import { clearKeysWithMeta, getWithMeta, setWithMeta } from "./metadata"
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

  await setWithMeta(
    makeReceiptMediaKey(workspaceId, receiptAssetId, variant),
    record,
    {
      ttlMs: Infinity,
      version: CACHE_VERSIONS.receiptMedia,
    }
  )

  return record
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
