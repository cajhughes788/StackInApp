"use client"

import { useEffect, useState } from "react"
import { FileText } from "lucide-react"

import { resolveReceiptMediaSource } from "@/lib/domain/receiptAssetsService"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

type ReceiptThumbnailProps = {
  workspaceId: string
  receiptAssetId: string
  asset?: Partial<ReceiptAsset> | null
  alt: string
  className?: string
}

export default function ReceiptThumbnail({
  workspaceId,
  receiptAssetId,
  asset,
  alt,
  className = "h-16 w-16 rounded-lg border border-border object-cover",
}: ReceiptThumbnailProps) {
  const [src, setSrc] = useState<string | null>(asset?.dataUrl ?? null)

  useEffect(() => {
    let cancelled = false

    void resolveReceiptMediaSource(workspaceId, receiptAssetId, "thumbnail", asset)
      .then((result) => {
        if (cancelled || !result.src) return
        setSrc(result.src)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [asset, receiptAssetId, workspaceId])

  if (src) {
    return <img src={src} alt={alt} className={className} />
  }

  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
      <FileText className="h-5 w-5" />
    </div>
  )
}
