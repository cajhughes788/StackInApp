import type { ReceiptAnalysis } from "@shared/schemas/receiptAnalysis"
import type { ReceiptDraft } from "@shared/schemas/receiptDraft"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

// Uses FileReader.readAsDataURL so encoding runs off the main thread in the
// browser's I/O layer. The previous btoa + String.fromCharCode loop was
// synchronous — it blocked the main thread for 200–400ms on mobile for a
// typical 2MB compressed receipt image.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Failed to encode receipt image for upload"))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string" || result.length === 0) {
        reject(new Error("Failed to encode receipt image for upload"))
        return
      }
      // readAsDataURL produces "data:<mime>;base64,<data>" — strip the prefix
      const comma = result.indexOf(",")
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export async function analyzeReceipt(
  workspaceId: string,
  receiptAssetId: string,
  imageFile?: File,
  profile?: ApiProfileContext,
  signal?: AbortSignal
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const imageBase64 = imageFile ? await fileToBase64(imageFile) : undefined

  const res = await apiFetch<{
    ok: boolean
    analysis: ReceiptAnalysis
    draft: ReceiptDraft
  }>(
    `${API_ENDPOINTS.receiptAnalysis.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        receiptAssetId,
        imageBase64,
        mimeType: imageFile?.type || "image/jpeg",
        sizeBytes: imageFile?.size,
      }),
      timeout: 55_000,
      profile,
      signal,
    }
  )

  return {
    analysis: res.analysis,
    draft: res.draft,
  }
}

