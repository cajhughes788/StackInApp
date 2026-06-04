"use client"

export type DecodedReceiptImage = {
  width: number
  height: number
  source: ImageBitmap | HTMLImageElement
  close: () => void
}

/**
 * Reads the EXIF orientation tag from a JPEG file's raw bytes.
 * Returns a value 1–8, where 1 means no rotation needed.
 * Returns 1 for non-JPEG files or when EXIF is absent.
 */
async function readJpegExifOrientation(file: File): Promise<number> {
  if (!file.type.includes("jpeg") && !file.type.includes("jpg") && !file.name.toLowerCase().match(/\.jpe?g$/)) {
    return 1
  }
  try {
    const buffer = await file.slice(0, 65536).arrayBuffer()
    const view = new DataView(buffer)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1

    let offset = 2
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset)
      const segLength = view.getUint16(offset + 2)
      if (marker === 0xffe1) {
        // APP1 — check for "Exif\0\0" header
        if (
          view.byteLength > offset + 10 &&
          view.getUint32(offset + 4) === 0x45786966 &&
          view.getUint16(offset + 8) === 0x0000
        ) {
          const tiffBase = offset + 10
          const byteOrder = view.getUint16(tiffBase)
          const le = byteOrder === 0x4949
          const ifdOffset = view.getUint32(tiffBase + 4, le)
          const ifdStart = tiffBase + ifdOffset
          if (ifdStart + 2 > view.byteLength) break
          const numEntries = view.getUint16(ifdStart, le)
          for (let i = 0; i < numEntries; i++) {
            const entryBase = ifdStart + 2 + i * 12
            if (entryBase + 12 > view.byteLength) break
            if (view.getUint16(entryBase, le) === 0x0112) {
              return view.getUint16(entryBase + 8, le)
            }
          }
        }
      }
      if (segLength < 2) break
      offset += 2 + segLength
    }
  } catch {
    // Non-fatal — default to no rotation
  }
  return 1
}

/**
 * Applies EXIF orientation to produce an upright image.
 * `createImageBitmap` on Safari iOS < 15 does not apply EXIF orientation;
 * this ensures correct orientation before quality analysis and OCR upload.
 */
export async function normalizeExifOrientation(
  file: File,
  decoded: DecodedReceiptImage
): Promise<DecodedReceiptImage> {
  const orientation = await readJpegExifOrientation(file)
  if (orientation <= 1) return decoded

  const swap = orientation >= 5
  const cw = swap ? decoded.height : decoded.width
  const ch = swap ? decoded.width : decoded.height

  const canvas = document.createElement("canvas")
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext("2d")
  if (!ctx) return decoded

  ctx.save()
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, cw, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, cw, ch); break
    case 4: ctx.transform(1, 0, 0, -1, 0, ch); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, ch, 0); break
    case 7: ctx.transform(0, -1, -1, 0, ch, cw); break
    case 8: ctx.transform(0, -1, 1, 0, 0, cw); break
  }
  ctx.drawImage(decoded.source as CanvasImageSource, 0, 0)
  ctx.restore()

  // Convert the corrected canvas back to an ImageBitmap so the rest of the
  // pipeline (quality check, upload, preview render) sees an upright image.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("EXIF normalization canvas.toBlob failed"))),
      "image/jpeg",
      0.95
    )
  })

  const normalizedBitmap = await createImageBitmap(blob)
  decoded.close()

  return {
    width: cw,
    height: ch,
    source: normalizedBitmap,
    close: () => normalizedBitmap.close(),
  }
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
