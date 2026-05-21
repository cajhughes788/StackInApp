import type { ImportBatch, ImportItem } from "@shared/schemas/import"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { ApiError } from "@/lib/api/core/errors"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { logPerf } from "@/lib/observability/perf"

export type CreateImportBatchResponse = {
  ok: boolean
  batch: ImportBatch
  items: ImportItem[]
}

export type UpdateImportItemResponse = {
  ok: boolean
  batch: ImportBatch
  item: ImportItem
}

type ImportBatchesResponse = {
  batches: ImportBatch[]
}

type ImportItemsResponse = {
  items: ImportItem[]
}

export async function createImportBatch(
  workspaceId: string,
  body: any,
  profile?: ApiProfileContext
): Promise<CreateImportBatchResponse> {
  const endpoint = `${API_ENDPOINTS.imports.batch.post}?workspaceId=${encodeURIComponent(workspaceId)}`

  logPerf("import.create_batch.request", {
    workspaceId,
    batchSource: body?.batch?.source ?? null,
    itemCount: Array.isArray(body?.items) ? body.items.length : null,
    distinctItemSources: Array.isArray(body?.items)
      ? Array.from(new Set(body.items.map((item: any) => item?.source ?? null)))
      : [],
    firstItemSources: Array.isArray(body?.items)
      ? body.items.slice(0, 10).map((item: any) => item?.source ?? null)
      : [],
  })

  try {
    const res = await tryWrite(
      endpoint,
      "POST",
      body,
      profile
    )

    logPerf("import.create_batch.success", {
      workspaceId,
      batchId: (res as any)?.batch?.id ?? null,
      returnedItemCount: Array.isArray((res as any)?.items) ? (res as any).items.length : null,
    })

    return {
      ok: true,
      batch: (res as any).batch,
      items: (res as any).items,
    }
  } catch (error) {
    logPerf("import.create_batch.failed", {
      workspaceId,
      status: error instanceof ApiError ? error.status ?? null : null,
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof ApiError ? error.details ?? null : null,
      batchSource: body?.batch?.source ?? null,
      itemCount: Array.isArray(body?.items) ? body.items.length : null,
      distinctItemSources: Array.isArray(body?.items)
        ? Array.from(new Set(body.items.map((item: any) => item?.source ?? null)))
        : [],
      firstItemSources: Array.isArray(body?.items)
        ? body.items.slice(0, 10).map((item: any) => item?.source ?? null)
        : [],
    })
    throw error
  }
}

export async function getImportBatches(
  workspaceId: string,
  profile?: ApiProfileContext
): Promise<ImportBatch[]> {
  const res = await apiFetch<ImportBatchesResponse>(
    `${API_ENDPOINTS.imports.batch.get}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET", profile }
  )
  return res.batches
}

export async function getImportItems(
  workspaceId: string,
  batchId: string,
  profile?: ApiProfileContext
): Promise<ImportItem[]> {
  const res = await apiFetch<ImportItemsResponse>(
    `${API_ENDPOINTS.imports.items.get}?workspaceId=${encodeURIComponent(workspaceId)}&batchId=${encodeURIComponent(batchId)}`,
    { method: "GET", profile }
  )
  return res.items
}

export async function updateImportItem(
  workspaceId: string,
  batchId: string,
  itemId: string,
  body: any,
  profile?: ApiProfileContext
): Promise<UpdateImportItemResponse> {
  const res = await tryWrite(
    `${API_ENDPOINTS.imports.items.patch}?workspaceId=${encodeURIComponent(workspaceId)}&batchId=${encodeURIComponent(batchId)}&itemId=${encodeURIComponent(itemId)}`,
    "PATCH",
    body,
    profile
  )

  return {
    ok: true,
    batch: (res as any).batch,
    item: (res as any).item,
  }
}
