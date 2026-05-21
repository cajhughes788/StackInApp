type OcrProgress = {
  status: string
  progress: number
}

export async function recognizeReceiptText(
  image: File | Blob,
  onProgress?: (progress: OcrProgress) => void
): Promise<string> {
  const { recognize } = await import("tesseract.js")
  const handleProgress = onProgress

  const result = await recognize(image, "eng", {
    logger: (message) => {
      if (
        handleProgress &&
        typeof message?.status === "string" &&
        typeof message?.progress === "number"
      ) {
        handleProgress({
          status: message.status,
          progress: message.progress,
        })
      }
    },
  })

  return result.data.text ?? ""
}
