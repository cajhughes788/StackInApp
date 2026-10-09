"use client"

import type { ReceiptAsset } from "@shared/schemas/receiptAsset"
import type { ReceiptDraft } from "@shared/schemas/receiptDraft"

import { getReceiptAsset } from "@/lib/api/receiptAssetsApi"
import {
  loadReceiptMedia,
  loadReceiptMediaUrl,
  saveReceiptMediaUrl,
  type ReceiptMediaVariant,
  type ReceiptUrlVariant,
} from "@/lib/storage/receiptAssetsCache"

function getAssetVersion(asset: Partial<ReceiptAsset> | null | undefined): number {
  return asset?.version ?? 1
}

// Resolved (and in-flight) download URLs for the session. Saves repeat
// persistent-cache reads (a native bridge call each on iOS) and collapses
// concurrent lookups — e.g. a viewer's warm-up and its click — into one
// getDownloadURL.
const resolvedUrls = new Map<string, Promise<string>>()

function resolveUrlFromPath(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptUrlVariant,
  storagePath: string
): Promise<string> {
  const key = `${workspaceId}:${receiptAssetId}:${variant}`
  const existing = resolvedUrls.get(key)
  if (existing) return existing

  const pending = (async () => {
    const cached = await loadReceiptMediaUrl(workspaceId, receiptAssetId, variant)
    if (cached) return cached

    const { getDownloadURL, ref } = await import("firebase/storage")
    const { getStorageSafe } = await import("@/lib/firebase")
    const url = await getDownloadURL(ref(getStorageSafe(), storagePath))
    await saveReceiptMediaUrl(workspaceId, receiptAssetId, variant, url)
    return url
  })()
  pending.catch(() => resolvedUrls.delete(key))
  resolvedUrls.set(key, pending)
  return pending
}

// Same formula as the backend's buildDerivedStoragePath (and the client's
// buildClientReceiptDerivedPath, not imported here to keep firebase/storage
// out of this module's static graph).
function derivedStoragePath(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant
): string {
  const fileName = variant === "thumbnail" ? "thumb.jpg" : "preview.jpg"
  return `workspaces/${workspaceId}/receipts/${receiptAssetId}/${fileName}`
}

function hasMediaSource(asset: Partial<ReceiptAsset> | null | undefined): boolean {
  return Boolean(
    asset?.previewStoragePath ||
      asset?.thumbnailStoragePath ||
      asset?.originalStoragePath ||
      asset?.storagePath ||
      asset?.dataUrl
  )
}

// Expenses on the Receipts page usually have no draft (and so no asset
// record) attached, which meant the thumbnail and then the viewer each made
// their own backend round trip for the same asset. Keep fetched assets (and
// in-flight fetches) for the session so the viewer reuses the thumbnail's.
const fetchedAssets = new Map<string, Promise<ReceiptAsset>>()

function fetchAssetOnce(workspaceId: string, receiptAssetId: string): Promise<ReceiptAsset> {
  const key = `${workspaceId}:${receiptAssetId}`
  const existing = fetchedAssets.get(key)
  if (existing) return existing

  const pending = getReceiptAsset(workspaceId, receiptAssetId).then(
    (fetched) => {
      // Don't pin a record that may still change (upload still running).
      if (!hasMediaSource(fetched) || fetched.uploadStatus === "uploading") {
        fetchedAssets.delete(key)
      }
      return fetched
    },
    (err) => {
      fetchedAssets.delete(key)
      throw err
    }
  )
  fetchedAssets.set(key, pending)
  return pending
}

async function ensureAsset(
  workspaceId: string,
  receiptAssetId: string,
  asset?: Partial<ReceiptAsset> | null
): Promise<ReceiptAsset> {
  if (asset?.id === receiptAssetId && hasMediaSource(asset)) {
    return asset as ReceiptAsset
  }

  return fetchAssetOnce(workspaceId, receiptAssetId)
}

export async function resolveReceiptMediaSource(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptMediaVariant,
  asset?: Partial<ReceiptAsset> | null
): Promise<{ src: string | null; asset: ReceiptAsset | null; fromCache: boolean }> {
  const cached = await loadReceiptMedia(
    workspaceId,
    receiptAssetId,
    variant,
    getAssetVersion(asset)
  )
  if (cached?.dataUrl) {
    return { src: cached.dataUrl, asset: (asset as ReceiptAsset) ?? null, fromCache: true }
  }

  // Without an asset record in hand (expenses carry only the id), go
  // straight to the deterministic derived path instead of a backend round
  // trip for the record. Only if that object is missing (older receipt, or
  // its preview upload failed) fall back to fetching the record.
  if (!hasMediaSource(asset)) {
    try {
      const url = await resolveUrlFromPath(
        workspaceId,
        receiptAssetId,
        variant,
        derivedStoragePath(workspaceId, receiptAssetId, variant)
      )
      return { src: url, asset: (asset as ReceiptAsset) ?? null, fromCache: false }
    } catch {
      // Fall through to the asset record's own paths.
    }
  }

  const resolvedAsset = await ensureAsset(workspaceId, receiptAssetId, asset)

  if (resolvedAsset.dataUrl?.startsWith("data:") || resolvedAsset.dataUrl?.startsWith("blob:")) {
    return { src: resolvedAsset.dataUrl, asset: resolvedAsset, fromCache: false }
  }

  const storagePath =
    variant === "thumbnail"
      ? (resolvedAsset.thumbnailStoragePath ??
         resolvedAsset.previewStoragePath ??
         resolvedAsset.originalStoragePath ??
         resolvedAsset.storagePath)
      : (resolvedAsset.previewStoragePath ??
         resolvedAsset.originalStoragePath ??
         resolvedAsset.storagePath)

  if (!storagePath) {
    return { src: null, asset: resolvedAsset, fromCache: false }
  }

  const url = await resolveUrlFromPath(workspaceId, receiptAssetId, variant, storagePath)
  return { src: url, asset: resolvedAsset, fromCache: false }
}

const WARM_THUMBNAIL_CONCURRENCY = 4

// Each ReceiptThumbnail on the Receipts page only starts resolving its image
// (asset lookup -> Storage getDownloadURL -> bytes) when it mounts, which is
// what makes that page feel slow to open. Call this whenever a batch of
// drafts is freshly fetched anywhere else in the app (e.g. the receipt
// drafts store's backend refresh) to warm the download-URL cache ahead of
// time, so the Receipts page's own resolution is a cache hit.
export function warmReceiptThumbnails(workspaceId: string, drafts: ReceiptDraft[]): void {
  const candidates = drafts.filter((draft) => draft.receiptAssetId)
  let index = 0
  async function next(): Promise<void> {
    const draft = candidates[index++]
    if (!draft) return
    try {
      await resolveReceiptMediaSource(workspaceId, draft.receiptAssetId, "thumbnail", draft.receiptAsset)
    } catch {
      // Best-effort warm-up — the Receipts page still resolves its own
      // images on visit if this didn't finish or failed.
    }
    return next()
  }
  void Promise.all(
    Array.from({ length: Math.min(WARM_THUMBNAIL_CONCURRENCY, candidates.length) }, next)
  )
}

export async function resolveReceiptOriginalUrl(
  workspaceId: string,
  receiptAssetId: string,
  asset: Partial<ReceiptAsset> | null | undefined
): Promise<string | null> {
  if (asset?.dataUrl?.startsWith("data:") || asset?.dataUrl?.startsWith("blob:")) {
    return asset.dataUrl
  }

  const cached = await loadReceiptMediaUrl(workspaceId, receiptAssetId, "original")
  if (cached) return cached

  const storagePath = asset?.originalStoragePath ?? asset?.storagePath
  if (storagePath) {
    return resolveUrlFromPath(workspaceId, receiptAssetId, "original", storagePath)
  }

  try {
    const fetched = await fetchAssetOnce(workspaceId, receiptAssetId)
    const path = fetched.originalStoragePath ?? fetched.storagePath
    if (!path) return null
    return resolveUrlFromPath(workspaceId, receiptAssetId, "original", path)
  } catch {
    return null
  }
}
