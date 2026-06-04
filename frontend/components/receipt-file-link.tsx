"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { resolveReceiptOriginalUrl } from "@/lib/domain/receiptAssetsService"

type ReceiptFileLinkProps = {
  workspaceId: string
  receiptAssetId: string
  initialUrl?: string | null
  className?: string
  label?: string
  variant?: "link" | "outline" | "ghost"
}

export default function ReceiptFileLink({
  workspaceId,
  receiptAssetId,
  initialUrl = null,
  className,
  label = "View receipt",
  variant = "link",
}: ReceiptFileLinkProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(initialUrl)
  const [loading, setLoading] = useState(false)

  async function handleOpen() {
    if (resolvedUrl) {
      window.open(resolvedUrl, "_blank", "noopener,noreferrer")
      return
    }

    setLoading(true)
    try {
      const nextUrl = await resolveReceiptOriginalUrl(workspaceId, receiptAssetId, null)
      setResolvedUrl(nextUrl)
      if (nextUrl) {
        window.open(nextUrl, "_blank", "noopener,noreferrer")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={() => void handleOpen()}
      disabled={loading}
    >
      {loading ? "Opening..." : label}
    </Button>
  )
}
