import type {
  ReceiptDraft,
  ReceiptDraftInput,
  ReceiptDraftPatch,
} from "@shared/schemas/receiptDraft"
import type { ExpenseType } from "@shared/schemas/expense"

import type { ApiProfileContext } from "@/lib/api/core/client"
import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function createReceiptDraft(
  workspaceId: string,
  body: ReceiptDraftInput,
  profile?: ApiProfileContext
): Promise<ReceiptDraft> {
  const res = await tryWrite<{ ok: boolean; draft: ReceiptDraft }>(
    `${API_ENDPOINTS.receiptDrafts.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body,
    profile
  )

  return res.draft
}

export async function getReceiptDrafts(
  workspaceId: string,
  profile?: ApiProfileContext
): Promise<ReceiptDraft[]> {
  const res = await apiFetch<{ drafts: ReceiptDraft[] }>(
    `${API_ENDPOINTS.receiptDrafts.get}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET", profile }
  )
  return res.drafts
}

export async function updateReceiptDraft(
  workspaceId: string,
  receiptDraftId: string,
  body: ReceiptDraftPatch,
  profile?: ApiProfileContext
): Promise<ReceiptDraft> {
  const res = await tryWrite<{ ok: boolean; draft: ReceiptDraft }>(
    `${API_ENDPOINTS.receiptDrafts.patch}?workspaceId=${encodeURIComponent(workspaceId)}&receiptDraftId=${encodeURIComponent(receiptDraftId)}`,
    "PATCH",
    body,
    profile
  )

  return res.draft
}

export async function commitReceiptDraftApi(
  workspaceId: string,
  receiptDraftId: string,
  expenseInput: Record<string, unknown>
): Promise<{ expense: ExpenseType; draft: ReceiptDraft }> {
  const res = await tryWrite<{ ok: boolean; expense: ExpenseType; draft: ReceiptDraft }>(
    `${API_ENDPOINTS.receiptDrafts.commit}?workspaceId=${encodeURIComponent(workspaceId)}&receiptDraftId=${encodeURIComponent(receiptDraftId)}`,
    "POST",
    expenseInput
  )
  return { expense: res.expense, draft: res.draft }
}
