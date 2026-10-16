"use client"

import { INVOICE_LOGO_MAX_LENGTH } from "@shared/schemas/invoice"

// Turns a picked image into the data URL InvoiceSettings.logoDataUrl stores:
// scaled to fit 480×240 (twice the largest size it's shown at), PNG when the
// image has transparency, JPEG otherwise, stepping quality down until it
// fits INVOICE_LOGO_MAX_LENGTH.
const MAX_WIDTH = 480
const MAX_HEIGHT = 240

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("That file couldn't be read as an image."))
    }
    image.src = url
  })
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

export async function prepareInvoiceLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for your logo.")
  const image = await loadImage(file)
  const scale = Math.min(MAX_WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight, 1)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Couldn't process that image.")
  context.drawImage(image, 0, 0, width, height)

  if (hasTransparency(context, width, height)) {
    const png = canvas.toDataURL("image/png")
    if (png.length <= INVOICE_LOGO_MAX_LENGTH) return png
    // Too big as PNG: flatten onto white and fall through to JPEG.
    context.globalCompositeOperation = "destination-over"
    context.fillStyle = "#FFFFFF"
    context.fillRect(0, 0, width, height)
  }
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality)
    if (jpeg.length <= INVOICE_LOGO_MAX_LENGTH) return jpeg
  }
  throw new Error("That logo is too detailed to fit — try a simpler image.")
}
