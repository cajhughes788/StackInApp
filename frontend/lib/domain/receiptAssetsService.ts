"use client"

import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

import { getReceiptAsset } from "@/lib/api/receiptAssetsApi"
import {
  loadReceiptMedia,
  saveReceiptMediaFromUrl,
  type ReceiptMediaVariant,
} from "@/lib/storage/receiptAssetsCache"

function getAssetVersion(asset: Partial<ReceiptAsset> | null | undefined): number {
  return asset?.version ?? 1
}

function getReceiptMediaDownloadUrl(
  asset: Partial<ReceiptAsset> | null | undefined,
  variant: ReceiptMediaVariant
): string | null {
  if (!asset) {
    return null
  }

  if (variant === "thumbnail") {
    return (
      asset.thumbnailDownloadUrl ??
      asset.previewDownloadUrl ??
      asset.originalDownloadUrl ??
      asset.downloadUrl ??
      asset.dataUrl ??
      null
    )
  }

  return (
    asset.previewDownloadUrl ??
    asset.originalDownloadUrl ??
    asset.downloadUrl ??
    asset.dataUrl ??
    null
  )
}

async function ensureAsset(
  workspaceId: string,
  receiptAssetId: string,
  asset?: Partial<ReceiptAsset> | null
): Promise<ReceiptAsset> {
  if (asset?.id === receiptAssetId) {
    const hasAnyMediaUrl = Boolean(
      asset.previewDownloadUrl ||
        asset.thumbnailDownloadUrl ||
        asset.originalDownloadUrl ||
        asset.downloadUrl ||
        asset.dataUrl
    )
    if (hasAnyMediaUrl) {
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
  const expectedVersion = getAssetVersion(asset)
  const cached = await loadReceiptMedia(
    workspaceId,
    receiptAssetId,
    variant,
    expectedVersion
  )
  if (cached?.dataUrl) {
    return {
      src: cached.dataUrl,
      asset: (asset as ReceiptAsset) ?? null,
      fromCache: true,
    }
  }

  const resolvedAsset = await ensureAsset(workspaceId, receiptAssetId, asset)
  const version = getAssetVersion(resolvedAsset)

  const hydratedCache = await loadReceiptMedia(
    workspaceId,
    receiptAssetId,
    variant,
    version
  )
  if (hydratedCache?.dataUrl) {
    return {
      src: hydratedCache.dataUrl,
      asset: resolvedAsset,
      fromCache: true,
    }
  }

  const mediaUrl = getReceiptMediaDownloadUrl(resolvedAsset, variant)
  if (!mediaUrl) {
    return {
      src: null,
      asset: resolvedAsset,
      fromCache: false,
    }
  }

  if (mediaUrl.startsWith("data:")) {
    return {
      src: mediaUrl,
      asset: resolvedAsset,
      fromCache: false,
    }
  }

  try {
    const cachedRecord = await saveReceiptMediaFromUrl(
      workspaceId,
      receiptAssetId,
      variant,
      version,
      mediaUrl
    )

    return {
      src: cachedRecord.dataUrl,
      asset: resolvedAsset,
      fromCache: false,
    }
  } catch {
    return {
      src: mediaUrl,
      asset: resolvedAsset,
      fromCache: false,
    }
  }
}

export function getReceiptOriginalUrl(
  asset: Partial<ReceiptAsset> | null | undefined
): string | null {
  return asset?.originalDownloadUrl ?? asset?.downloadUrl ?? null
}
