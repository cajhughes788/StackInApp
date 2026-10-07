"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { createReceiptAsset, updateReceiptAssetUploadStatus } from "@/lib/api/receiptAssetsApi"
import { analyzeReceiptImageQuality } from "@/lib/receipts/imageQuality"
import { loadReceiptImage, normalizeExifOrientation } from "@/lib/receipts/imagePipeline"
import {
  buildClientReceiptDerivedPath,
  buildClientReceiptStoragePath,
  prepareReceiptPreviewFile,
  prepareReceiptThumbnailFile,
  prepareReceiptUploadFile,
  uploadReceiptAssetToStorage,
} from "@/lib/receipts/receiptAssetStorage"
import { captureReceiptImage, isNativeCameraAvailable } from "@/lib/native/camera"
import { useToast } from "@/hooks/use-toast"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

// Shared by ExpenseForm and the Plaid pending-transactions panel — capture
// or pick an image, upload it as a receipt asset, and hold the result until
// the caller is ready to link it to an expense via receiptAssetId.
export function useReceiptCapture(workspaceId: string | null) {
  const { toast } = useToast()
  const [attachedReceiptAsset, setAttachedReceiptAsset] = useState<ReceiptAsset | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  // Local blob: preview of the picked/captured image, shown while
  // processReceiptFile is still decoding/checking/creating the doc so the
  // field can show the photo immediately instead of a blank gap. On success
  // the same URL is handed to the asset as its dataUrl (not revoked); on
  // failure it's revoked.
  const [pendingReceiptPreview, setPendingReceiptPreview] = useState<{
    url: string
    fileName: string
  } | null>(null)
  const [isNativeCamera, setIsNativeCamera] = useState(false)
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null)
  // Lets a caller (ExpenseForm) that doesn't want to block its own submit on
  // the brief decode/quality-check/create-doc window await "whatever capture
  // is currently in flight, if any" without needing to poll receiptUploading.
  // Resolves with the asset directly (not void) so a caller that awaits this
  // after the hook's own state may have already been cleared (e.g. a form
  // that calls clearAttachedReceipt() right after kicking off submission)
  // still gets the right value — no race against React's render timing.
  const pendingCapturePromiseRef = useRef<Promise<ReceiptAsset | null> | null>(null)

  useEffect(() => {
    setIsNativeCamera(isNativeCameraAvailable())
  }, [])

  // Revoke the blob: URL before clearing the receipt state so the browser can
  // release the backing file bytes. Must be called instead of setAttachedReceiptAsset(null)
  // directly whenever the asset is discarded outside of the user pressing ✕.
  const clearAttachedReceipt = useCallback(() => {
    setAttachedReceiptAsset((current) => {
      if (current?.dataUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(current.dataUrl)
      }
      return null
    })
    setReceiptError(null)
  }, [])

  async function processReceiptFile(file: File): Promise<ReceiptAsset | null> {
    // Capture workspaceId once so the catch cleanup uses the same value as the writes.
    const scopedWorkspaceId = workspaceId
    if (!scopedWorkspaceId) return null
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    const isAllowed =
      ALLOWED_TYPES.includes(file.type.toLowerCase()) ||
      /\.(jpe?g|png|webp|heic)$/i.test(file.name)
    if (!isAllowed) {
      setReceiptError("Unsupported file type. Please use JPEG, PNG, WebP, or HEIC.")
      return null
    }
    if (file.size > 30 * 1024 * 1024) {
      setReceiptError("Image is too large. Please use an image under 30 MB.")
      return null
    }

    const previewUrl = URL.createObjectURL(file)
    setPendingReceiptPreview({ url: previewUrl, fileName: file.name })
    setReceiptUploading(true)
    setReceiptError(null)

    // Hoisted so the finally block can always close it, regardless of which
    // step throws. decoded.close() frees the GPU-backed ImageBitmap.
    let decoded: Awaited<ReturnType<typeof loadReceiptImage>> | null = null

    try {
      decoded = await loadReceiptImage(file)
      decoded = await normalizeExifOrientation(file, decoded)

      const quality = await analyzeReceiptImageQuality(file, decoded)
      if (quality.qualityStatus === "bad") {
        throw new Error(quality.warnings[0] || "This image is too blurry or unclear. Please retake the photo.")
      }

      const assetId = `receipt-${crypto.randomUUID?.() ?? Date.now()}`
      const uploadFile = await prepareReceiptUploadFile(file, decoded)
      // decoded is no longer needed after the upload file is prepared — close
      // it now so the bitmap is freed before the network calls begin.
      decoded.close()
      decoded = null

      const originalPath = buildClientReceiptStoragePath(scopedWorkspaceId, assetId, file.name)
      const previewPath = buildClientReceiptDerivedPath(scopedWorkspaceId, assetId, "preview")
      const thumbPath = buildClientReceiptDerivedPath(scopedWorkspaceId, assetId, "thumb")

      // Only the Firestore record is awaited here — it's a small doc write
      // and is what makes the asset a real, referenceable thing. The actual
      // image bytes upload (the slow part, especially on cellular) happens
      // in the background below, so the caller can link this receipt to an
      // expense and move on right away instead of waiting on the network.
      await createReceiptAsset(scopedWorkspaceId, {
        id: assetId,
        fileName: file.name,
        mimeType: uploadFile.type || "image/jpeg",
        sizeBytes: uploadFile.size,
        captureSource: "upload",
        quality: quality.quality,
        blurScore: quality.blurScore,
        glareScore: quality.glareScore,
        qualityStatus: quality.qualityStatus,
        qualityWarnings: quality.warnings,
        width: quality.width,
        height: quality.height,
      })

      const asset: ReceiptAsset = {
        id: assetId,
        fileName: file.name,
        mimeType: uploadFile.type || "image/jpeg",
        sizeBytes: uploadFile.size,
        version: 1,
        originalStoragePath: originalPath,
        storagePath: originalPath,
        previewStoragePath: previewPath,
        thumbnailStoragePath: thumbPath,
        captureSource: "upload",
        qualityStatus: quality.qualityStatus,
        qualityWarnings: quality.warnings,
        uploadStatus: "uploading",
        dataUrl: previewUrl,
      }
      setAttachedReceiptAsset(asset)
      setPendingReceiptPreview(null)
      setReceiptUploading(false)

      // Background: upload the original + preview + thumbnail bytes. The
      // caller may already have linked this receipt to an expense and moved
      // on by the time this settles, so a failure here can't just be
      // swallowed — flip the record's uploadStatus to "failed" (so it stays
      // visible even if this toast is missed) and toast right away too.
      void Promise.all([
        uploadReceiptAssetToStorage(uploadFile, originalPath, { resolveDownloadUrl: false }),
        prepareReceiptPreviewFile(file).then((previewFile) =>
          uploadReceiptAssetToStorage(previewFile, previewPath, { resolveDownloadUrl: false })
        ),
        prepareReceiptThumbnailFile(file).then((thumbFile) =>
          uploadReceiptAssetToStorage(thumbFile, thumbPath, { resolveDownloadUrl: false })
        ),
      ])
        .then(() => {
          void updateReceiptAssetUploadStatus(scopedWorkspaceId, assetId, "complete").catch(() => {})
          setAttachedReceiptAsset((current) =>
            current?.id === assetId ? { ...current, uploadStatus: "complete" } : current
          )
        })
        .catch((uploadErr) => {
          void updateReceiptAssetUploadStatus(scopedWorkspaceId, assetId, "failed").catch(() => {})
          setAttachedReceiptAsset((current) =>
            current?.id === assetId ? { ...current, uploadStatus: "failed" } : current
          )
          setReceiptError((current) =>
            current ?? "This receipt's image failed to upload. Please reattach it."
          )
          toast({
            title: "Receipt upload failed",
            description: `"${file.name}" didn't finish uploading${
              uploadErr instanceof Error ? `: ${uploadErr.message}` : "."
            } Please reattach it.`,
            variant: "destructive",
          })
        })

      return asset
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Failed to attach receipt.")
      URL.revokeObjectURL(previewUrl)
      setPendingReceiptPreview(null)
      setReceiptUploading(false)
      return null
    } finally {
      // Always release the ImageBitmap — covers every throw path including
      // bad-quality early exits and canvas errors in prepareReceiptUploadFile.
      decoded?.close()
    }
  }

  async function handleReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const promise = processReceiptFile(file)
    pendingCapturePromiseRef.current = promise
    await promise
    event.target.value = ""
  }

  async function handleNativeReceiptCapture(source: "camera" | "photos") {
    try {
      const file = await captureReceiptImage(source)
      if (file) {
        const promise = processReceiptFile(file)
        pendingCapturePromiseRef.current = promise
        await promise
      }
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Unable to open camera.")
    }
  }

  // Resolves with the captured asset (or null if nothing's ever been
  // captured, or the capture failed) once the current/most recent
  // processReceiptFile call settles. Only covers the fast
  // decode/quality-check/create-doc step, not the background byte upload
  // that continues after (that part already has its own failure toast).
  function waitForPendingCapture(): Promise<ReceiptAsset | null> {
    return pendingCapturePromiseRef.current ?? Promise.resolve(null)
  }

  return {
    attachedReceiptAsset,
    receiptUploading,
    pendingReceiptPreview,
    receiptError,
    isNativeCamera,
    receiptFileInputRef,
    handleReceiptFileChange,
    handleNativeReceiptCapture,
    clearAttachedReceipt,
    waitForPendingCapture,
  }
}

export type ReceiptCapture = ReturnType<typeof useReceiptCapture>
