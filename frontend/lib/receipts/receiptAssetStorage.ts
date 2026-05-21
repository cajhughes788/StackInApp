"use client"

import { getDownloadURL, ref, uploadBytes } from "firebase/storage"

import { getStorageSafe } from "@/lib/firebase"
import { createProfileTrace } from "@/lib/observability/profileTrace"
import {
  loadReceiptImage,
  renderReceiptCanvas,
  type DecodedReceiptImage,
} from "@/lib/receipts/imagePipeline"

const TEXTRACT_UPLOAD_MAX_BYTES = 4_500_000
const TEXTRACT_UPLOAD_MAX_DIMENSION = 1600
const RECEIPT_PREVIEW_MAX_BYTES = 1_500_000
const RECEIPT_PREVIEW_MAX_DIMENSION = 1400
const RECEIPT_THUMBNAIL_MAX_BYTES = 120_000
const RECEIPT_THUMBNAIL_MAX_DIMENSION = 320

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to prepare receipt image for upload."))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality
    )
  })
}

function normalizeReceiptBaseName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "") || "receipt"
}

async function renderReceiptVariant(
  file: File,
  options: {
    maxDimension: number
    maxBytes: number
    qualitySteps: number[]
    suffix?: string
  },
  decoded?: DecodedReceiptImage
): Promise<File> {
  const resolvedDecoded = decoded ?? (await loadReceiptImage(file))
  try {
    const canvas = renderReceiptCanvas(resolvedDecoded, options.maxDimension)

    let bestBlob: Blob | null = null
    for (const quality of options.qualitySteps) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality)
      bestBlob = blob
      if (blob.size <= options.maxBytes) {
        break
      }
    }

    if (!bestBlob) {
      throw new Error("Unable to prepare receipt image for upload.")
    }

    const normalizedName = normalizeReceiptBaseName(file.name)
    const suffix = options.suffix ? `-${options.suffix}` : ""
    return new File([bestBlob], `${normalizedName}${suffix}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    })
  } finally {
    if (!decoded) {
      resolvedDecoded.close()
    }
  }
}

export async function getReceiptImageDimensions(
  file: File,
  decoded?: DecodedReceiptImage
): Promise<{ width: number; height: number }> {
  const resolvedDecoded = decoded ?? (await loadReceiptImage(file))
  if (!decoded) {
    try {
      return { width: resolvedDecoded.width, height: resolvedDecoded.height }
    } finally {
      resolvedDecoded.close()
    }
  }
  return { width: resolvedDecoded.width, height: resolvedDecoded.height }
}

export async function prepareReceiptUploadFile(
  file: File,
  decoded?: DecodedReceiptImage
): Promise<File> {
  return renderReceiptVariant(file, {
    maxDimension: TEXTRACT_UPLOAD_MAX_DIMENSION,
    maxBytes: TEXTRACT_UPLOAD_MAX_BYTES,
    qualitySteps: [0.82, 0.72, 0.6, 0.5, 0.4],
  }, decoded)
}

export async function prepareReceiptPreviewFile(
  file: File,
  decoded?: DecodedReceiptImage
): Promise<File> {
  return renderReceiptVariant(file, {
    maxDimension: RECEIPT_PREVIEW_MAX_DIMENSION,
    maxBytes: RECEIPT_PREVIEW_MAX_BYTES,
    qualitySteps: [0.8, 0.72, 0.64, 0.56, 0.48],
    suffix: "preview",
  }, decoded)
}

export async function prepareReceiptThumbnailFile(
  file: File,
  decoded?: DecodedReceiptImage
): Promise<File> {
  return renderReceiptVariant(file, {
    maxDimension: RECEIPT_THUMBNAIL_MAX_DIMENSION,
    maxBytes: RECEIPT_THUMBNAIL_MAX_BYTES,
    qualitySteps: [0.76, 0.68, 0.58, 0.48, 0.4],
    suffix: "thumb",
  }, decoded)
}

export async function prepareReceiptUploadBundle(file: File): Promise<{
  original: File
  preview: File
  thumbnail: File
}> {
  const [original, preview, thumbnail] = await Promise.all([
    prepareReceiptUploadFile(file),
    prepareReceiptPreviewFile(file),
    prepareReceiptThumbnailFile(file),
  ])

  return {
    original,
    preview,
    thumbnail,
  }
}

export async function uploadReceiptAssetToStorage(
  file: File,
  storagePath: string,
  options?: {
    resolveDownloadUrl?: boolean
  }
): Promise<{ downloadUrl: string | null; storagePath: string }> {
  const trace = createProfileTrace("receipt_upload", {
    storagePath,
    fileName: file.name,
    mimeType: file.type || "image/jpeg",
    sizeBytes: file.size,
  })
  const storage = getStorageSafe()
  const storageRef = ref(storage, storagePath)
  const resolveDownloadUrl = options?.resolveDownloadUrl !== false

  try {
    trace.start("receipt.upload.bytes", {
      storagePath,
    })
    await uploadBytes(storageRef, file, {
      contentType: file.type || "image/jpeg",
      cacheControl: "public,max-age=3600",
    })
    trace.end("receipt.upload.bytes", {
      storagePath,
      sizeBytes: file.size,
    })

    let downloadUrl: string | null = null
    if (resolveDownloadUrl) {
      trace.start("receipt.upload.download_url", {
        storagePath,
      })
      downloadUrl = await getDownloadURL(storageRef)
      trace.end("receipt.upload.download_url", {
        storagePath,
        hasDownloadUrl: Boolean(downloadUrl),
      })
    }
    trace.mark("receipt.upload.complete", {
      storagePath,
      resolvedDownloadUrl: resolveDownloadUrl,
      downloadUrlHost:
        typeof downloadUrl === "string"
          ? (() => {
              try {
                return new URL(downloadUrl).host
              } catch {
                return null
              }
            })()
          : null,
    })
    return {
      downloadUrl,
      storagePath,
    }
  } catch (err) {
    trace.error("receipt.upload.failed", err, {
      storagePath,
    })
    const message = err instanceof Error ? err.message : String(err)
    const normalized = message.toLowerCase()

    if (
      normalized.includes("storage/unknown") ||
      normalized.includes("storage/bucket-not-found") ||
      normalized.includes("object-not-found") ||
      normalized.includes("cors") ||
      normalized.includes("preflight") ||
      normalized.includes("404")
    ) {
      throw new Error(
        "Receipt upload could not reach Firebase Storage. Check that the Storage bucket exists, that the frontend bucket setting is correct, and that Storage is enabled for this Firebase project."
      )
    }

    throw err
  }
}

export async function getReceiptStorageDownloadUrl(
  storagePath: string
): Promise<string> {
  const trace = createProfileTrace("receipt_download_url", {
    storagePath,
  })
  const storage = getStorageSafe()
  const storageRef = ref(storage, storagePath)

  try {
    trace.start("receipt.download_url.fetch", {
      storagePath,
    })
    const downloadUrl = await getDownloadURL(storageRef)
    trace.end("receipt.download_url.fetch", {
      storagePath,
      hasDownloadUrl: Boolean(downloadUrl),
    })
    return downloadUrl
  } catch (err) {
    trace.error("receipt.download_url.failed", err, {
      storagePath,
    })
    throw err
  }
}
