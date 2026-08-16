"use client"

import type { ReceiptQualityStatus } from "@shared/schemas/receiptAsset"
import {
  loadReceiptImage,
  renderReceiptCanvas,
  type DecodedReceiptImage,
} from "@/lib/receipts/imagePipeline"

export type ReceiptImageQualityResult = {
  width: number
  height: number
  blurScore: number
  glareScore: number
  contrastScore: number
  edgeDensity: number
  quality: number
  qualityStatus: ReceiptQualityStatus
  warnings: string[]
}

function drawSample(decoded: DecodedReceiptImage) {
  const canvas = renderReceiptCanvas(decoded, 360, { willReadFrequently: true })
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) {
    throw new Error("Unable to analyze receipt image quality.")
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: imageData.data }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export async function analyzeReceiptImageQuality(
  file: File,
  decoded?: DecodedReceiptImage
): Promise<ReceiptImageQualityResult> {
  const resolvedDecoded = decoded ?? (await loadReceiptImage(file))
  const sample = drawSample(resolvedDecoded)
  if (!decoded) {
    resolvedDecoded.close()
  }

  const { width, height, data } = sample
  const pixelCount = Math.max(1, width * height)
  const grayscale = new Float32Array(pixelCount)
  let brightnessSum = 0
  let brightnessSquaredSum = 0
  let brightPixels = 0

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4
    const r = data[offset] ?? 0
    const g = data[offset + 1] ?? 0
    const b = data[offset + 2] ?? 0
    const value = 0.299 * r + 0.587 * g + 0.114 * b
    grayscale[i] = value
    brightnessSum += value
    brightnessSquaredSum += value * value
    if (value >= 245) brightPixels += 1
  }

  const meanBrightness = brightnessSum / pixelCount
  const variance = Math.max(0, brightnessSquaredSum / pixelCount - meanBrightness ** 2)
  const contrastScore = clamp(Math.sqrt(variance) / 64)
  const glareScore = clamp(brightPixels / pixelCount / 0.18)

  let edgeHits = 0
  let edgeStrengthSum = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx =
        -grayscale[index - width - 1] -
        2 * grayscale[index - 1] -
        grayscale[index + width - 1] +
        grayscale[index - width + 1] +
        2 * grayscale[index + 1] +
        grayscale[index + width + 1]
      const gy =
        -grayscale[index - width - 1] -
        2 * grayscale[index - width] -
        grayscale[index - width + 1] +
        grayscale[index + width - 1] +
        2 * grayscale[index + width] +
        grayscale[index + width + 1]
      const magnitude = Math.sqrt(gx * gx + gy * gy)
      edgeStrengthSum += magnitude
      if (magnitude > 52) edgeHits += 1
    }
  }

  const normalizedEdgeStrength = edgeStrengthSum / Math.max(1, pixelCount) / 48
  const edgeDensity = clamp(edgeHits / Math.max(1, pixelCount) / 0.24)
  const blurScore = clamp(1 - normalizedEdgeStrength)
  const quality = clamp(
    1 - (blurScore * 0.45 + glareScore * 0.3) + contrastScore * 0.2 + edgeDensity * 0.15
  )

  const warnings: string[] = []
  if (blurScore >= 0.62) warnings.push("This image looks blurry.")
  if (glareScore >= 0.55) warnings.push("There may be glare or overexposure on the receipt.")
  if (contrastScore <= 0.22) warnings.push("The image has low contrast and may be hard to read.")
  if (edgeDensity <= 0.12) warnings.push("The receipt edges are faint or tightly cropped.")
  if (width < 900 || height < 900) warnings.push("A higher-resolution image would improve extraction.")

  // Photos are informational only — never block upload with "bad" status.
  let qualityStatus: ReceiptQualityStatus = "good"
  if (warnings.length > 0) {
    qualityStatus = "warning"
  }

  return {
    width,
    height,
    blurScore,
    glareScore,
    contrastScore,
    edgeDensity,
    quality,
    qualityStatus,
    warnings,
  }
}
