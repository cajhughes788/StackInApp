"use client"

import { clearKeysWithMeta, getWithMeta, setWithMeta } from "./metadata"
import { CACHE_VERSIONS } from "./cacheVersions"

export type ReceiptMediaVariant = "preview" | "thumbnail"

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

export async function saveReceiptMediaFromBlob(
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

export async function saveReceiptMediaFromUrl(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant,
  version: number,
  url: string
): Promise<CachedReceiptMediaRecord> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Unable to cache receipt media: HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return saveReceiptMediaFromBlob(
    workspaceId,
    receiptAssetId,
    variant,
    version,
    blob,
    blob.type || "image/jpeg"
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
  const prefix = `${PREFIX}:${workspaceId}:${receiptAssetId}:`
  await clearKeysWithMeta((key) => key.startsWith(prefix))
}
