import type { ReceiptAnalysis } from "@shared/schemas/receiptAnalysis"
import type { ReceiptDraft } from "@shared/schemas/receiptDraft"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function analyzeReceipt(
  workspaceId: string,
  receiptAssetId: string,
  profile?: ApiProfileContext
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const res = await tryWrite<{
    ok: boolean
    analysis: ReceiptAnalysis
    draft: ReceiptDraft
  }>(
    `${API_ENDPOINTS.receiptAnalysis.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    { receiptAssetId },
    profile
  )

  return {
    analysis: res.analysis,
    draft: res.draft,
  }
}

export async function finalizeReceiptAnalysis(
  workspaceId: string,
  body: { analysisId?: string; receiptAssetId?: string },
  profile?: ApiProfileContext
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const res = await tryWrite<{
    ok: boolean
    analysis: ReceiptAnalysis
    draft: ReceiptDraft
  }>(
    `${API_ENDPOINTS.receiptAnalysis.finalize}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body,
    profile
  )

  return {
    analysis: res.analysis,
    draft: res.draft,
  }
}

export async function getReceiptAnalysis(
  workspaceId: string,
  params: { analysisId?: string; receiptAssetId?: string },
  profile?: ApiProfileContext
): Promise<ReceiptAnalysis> {
  const query = new URLSearchParams({
    workspaceId,
    ...(params.analysisId ? { analysisId: params.analysisId } : {}),
    ...(params.receiptAssetId ? { receiptAssetId: params.receiptAssetId } : {}),
  })
  const res = await apiFetch<{ analysis: ReceiptAnalysis }>(
    `${API_ENDPOINTS.receiptAnalysis.get}?${query.toString()}`,
    { method: "GET", profile }
  )
  return res.analysis
}
