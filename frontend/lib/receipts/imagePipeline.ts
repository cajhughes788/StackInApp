"use client"

export type DecodedReceiptImage = {
  width: number
  height: number
  source: ImageBitmap | HTMLImageElement
  close: () => void
}

function isImageBitmap(
  value: ImageBitmap | HTMLImageElement
): value is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap
}

export async function loadReceiptImage(
  file: File
): Promise<DecodedReceiptImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => {
          bitmap.close()
        },
      }
    } catch {}
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = "async"
  image.src = url
  await image.decode()
  URL.revokeObjectURL(url)

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    source: image,
    close: () => {},
  }
}

export function getScaledDimensions(
  decoded: DecodedReceiptImage,
  maxDimension: number
): { width: number; height: number } {
  const longestSide = Math.max(decoded.width, decoded.height, 1)
  const scale = Math.min(1, maxDimension / longestSide)

  return {
    width: Math.max(1, Math.round(decoded.width * scale)),
    height: Math.max(1, Math.round(decoded.height * scale)),
  }
}

export function renderReceiptCanvas(
  decoded: DecodedReceiptImage,
  maxDimension: number,
  contextOptions?: CanvasRenderingContext2DSettings
): HTMLCanvasElement {
  const { width, height } = getScaledDimensions(decoded, maxDimension)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", contextOptions)

  if (!context) {
    throw new Error("Unable to prepare receipt image.")
  }

  const source = decoded.source
  if (isImageBitmap(source)) {
    context.drawImage(source, 0, 0, width, height)
  } else {
    context.drawImage(source, 0, 0, width, height)
  }

  return canvas
}
