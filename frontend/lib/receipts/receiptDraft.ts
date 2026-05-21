import type { ReceiptAsset } from "@shared/schemas/receiptAsset"
import type { ReceiptCaptureSource } from "@shared/schemas/receiptAsset"

import type { ReceiptImageQualityResult } from "@/lib/receipts/imageQuality"

function parseAmountCandidate(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, "")
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function extractDate(text: string): string | null {
  const match =
    text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/) ||
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (!match) return null
  const parsed = new Date(match[1])
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function extractMerchant(text: string, fallbackFileName: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const firstMeaningful = lines.find(
    (line) => !/\b(receipt|invoice|thank you|visa|mastercard)\b/i.test(line)
  )

  return (
    firstMeaningful ||
    fallbackFileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")
  )
}

function extractTotal(text: string): number | null {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (/\b(total|amount due|grand total)\b/i.test(line)) {
      const amount = parseAmountCandidate(line)
      if (amount != null) return amount
    }
  }

  const allMatches = Array.from(text.matchAll(/\$?\s?(\d+\.\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
  if (!allMatches.length) return null
  return Math.max(...allMatches)
}

function suggestExpenseCategory(text: string): string | null {
  const normalized = text.toLowerCase()
  if (normalized.includes("uber") || normalized.includes("lyft") || normalized.includes("shell")) {
    return "Vehicle & Transportation"
  }
  if (normalized.includes("sally") || normalized.includes("cosmoprof") || normalized.includes("supply")) {
    return "Supplies"
  }
  if (normalized.includes("rent") || normalized.includes("booth")) {
    return "Rent / Booth Rent"
  }
  if (normalized.includes("quickbooks") || normalized.includes("glossgenius") || normalized.includes("vagaro")) {
    return "Software & Subscriptions"
  }
  if (normalized.includes("meta") || normalized.includes("instagram") || normalized.includes("ad")) {
    return "Marketing & Advertising"
  }
  return null
}

async function readImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = "async"
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function compressReceiptImage(file: File): Promise<string> {
  const image = await readImage(file)
  const maxWidth = 1280
  const scale = Math.min(1, maxWidth / Math.max(image.naturalWidth, 1))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("Unable to prepare receipt preview.")
  }

  context.drawImage(image, 0, 0, width, height)
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72)
  if (dataUrl.length > 850_000) {
    throw new Error(
      "Receipt image is too large to store in this MVP flow. Try a clearer crop or smaller image."
    )
  }
  return dataUrl
}

export function extractReceiptDraft(ocrText: string, fileName: string) {
  const normalizedText = ocrText.trim()
  const occurredAt = extractDate(normalizedText)
  const amount = extractTotal(normalizedText)
  const merchant = extractMerchant(normalizedText, fileName)
  const suggestedExpenseAccount = suggestExpenseCategory(normalizedText)

  return {
    occurredAt,
    amount,
    merchant,
    description: merchant,
    suggestedExpenseAccount,
    missingFields: [
      ...(occurredAt ? [] : ["date"]),
      ...(amount != null ? [] : ["amount"]),
      ...(merchant ? [] : ["merchant"]),
      ...(suggestedExpenseAccount ? [] : ["expenseCategory"]),
    ],
  }
}

export async function createReceiptPreviewAsset(
  file: File,
  options?: {
    captureSource?: ReceiptCaptureSource
    quality?: ReceiptImageQualityResult
    receiptAsset?: Partial<ReceiptAsset>
  }
): Promise<ReceiptAsset> {
  const receiptDataUrl = await compressReceiptImage(file)
  const receiptAssetId =
    options?.receiptAsset?.id ?? `receipt:${crypto.randomUUID?.() ?? Date.now()}`
  const quality = options?.quality

  return {
    ...options?.receiptAsset,
    id: receiptAssetId,
    version: options?.receiptAsset?.version ?? 1,
    fileName: file.name,
    mimeType: file.type || "image/jpeg",
    sizeBytes: file.size,
    width: quality?.width,
    height: quality?.height,
    captureSource: options?.captureSource ?? "upload",
    quality: quality?.quality,
    blurScore: quality?.blurScore,
    glareScore: quality?.glareScore,
    qualityStatus: quality?.qualityStatus,
    qualityWarnings: quality?.warnings ?? [],
    dataUrl: receiptDataUrl,
  }
}
