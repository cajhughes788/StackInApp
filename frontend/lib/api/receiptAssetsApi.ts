import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function createReceiptAsset(
  workspaceId: string,
  body: Partial<ReceiptAsset>,
  profile?: ApiProfileContext,
  signal?: AbortSignal
): Promise<ReceiptAsset> {
  const res = await tryWrite<{ ok: boolean; asset: ReceiptAsset }>(
    `${API_ENDPOINTS.receiptAssets.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body,
    profile,
    signal
  )

  return res.asset
}


export async function getReceiptAsset(
  workspaceId: string,
  receiptAssetId: string,
  profile?: ApiProfileContext,
  signal?: AbortSignal
): Promise<ReceiptAsset> {
  const res = await apiFetch<{ asset: ReceiptAsset }>(
    `${API_ENDPOINTS.receiptAssets.get}?workspaceId=${encodeURIComponent(workspaceId)}&receiptAssetId=${encodeURIComponent(receiptAssetId)}`,
    { method: "GET", profile, signal }
  )

  return res.asset
}

export async function deleteReceiptAsset(
  workspaceId: string,
  receiptAssetId: string,
  profile?: ApiProfileContext,
  signal?: AbortSignal
): Promise<void> {
  await tryWrite<{ ok: boolean }>(
    `${API_ENDPOINTS.receiptAssets.delete}?workspaceId=${encodeURIComponent(workspaceId)}&receiptAssetId=${encodeURIComponent(receiptAssetId)}`,
    "DELETE",
    {},
    profile,
    signal
  )
}
