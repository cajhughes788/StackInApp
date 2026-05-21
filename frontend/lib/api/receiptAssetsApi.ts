import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function createReceiptAsset(
  workspaceId: string,
  body: Partial<ReceiptAsset>,
  profile?: ApiProfileContext
): Promise<ReceiptAsset> {
  const res = await tryWrite<{ ok: boolean; asset: ReceiptAsset }>(
    `${API_ENDPOINTS.receiptAssets.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body,
    profile
  )

  return res.asset
}

export async function updateReceiptAsset(
  workspaceId: string,
  receiptAssetId: string,
  body: Partial<ReceiptAsset>,
  profile?: ApiProfileContext
): Promise<ReceiptAsset> {
  const res = await tryWrite<{ ok: boolean; asset: ReceiptAsset }>(
    `${API_ENDPOINTS.receiptAssets.patch}?workspaceId=${encodeURIComponent(workspaceId)}&receiptAssetId=${encodeURIComponent(receiptAssetId)}`,
    "PATCH",
    body,
    profile
  )

  return res.asset
}

export async function getReceiptAsset(
  workspaceId: string,
  receiptAssetId: string,
  profile?: ApiProfileContext
): Promise<ReceiptAsset> {
  const res = await apiFetch<{ asset: ReceiptAsset }>(
    `${API_ENDPOINTS.receiptAssets.get}?workspaceId=${encodeURIComponent(workspaceId)}&receiptAssetId=${encodeURIComponent(receiptAssetId)}`,
    { method: "GET", profile }
  )

  return res.asset
}
