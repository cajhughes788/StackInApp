"use client"

import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

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

async function resolveUrlFromPath(
  workspaceId: string,
  receiptAssetId: string,
  variant: ReceiptUrlVariant,
  storagePath: string
): Promise<string | null> {
  const cached = await loadReceiptMediaUrl(workspaceId, receiptAssetId, variant)
  if (cached) return cached

  const { getDownloadURL, ref } = await import("firebase/storage")
  const { getStorageSafe } = await import("@/lib/firebase")
  const url = await getDownloadURL(ref(getStorageSafe(), storagePath))
  await saveReceiptMediaUrl(workspaceId, receiptAssetId, variant, url)
  return url
}

async function ensureAsset(
  workspaceId: string,
  receiptAssetId: string,
  asset?: Partial<ReceiptAsset> | null
): Promise<ReceiptAsset> {
  if (asset?.id === receiptAssetId) {
    const hasStoragePath = Boolean(
      asset.previewStoragePath ||
        asset.thumbnailStoragePath ||
        asset.originalStoragePath ||
        asset.storagePath ||
        asset.dataUrl
    )
    if (hasStoragePath) {
      return asset as ReceiptAsset
    }
  }

  return getReceiptAsset(workspaceId, receiptAssetId)
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
    const fetched = await getReceiptAsset(workspaceId, receiptAssetId)
    const path = fetched.originalStoragePath ?? fetched.storagePath
    if (!path) return null
    return resolveUrlFromPath(workspaceId, receiptAssetId, "original", path)
  } catch {
    return null
  }
}
