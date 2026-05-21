import type { EntryType } from "@shared/schemas/entry"

import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export type CanonicalEntryResponse = {
  ok: boolean
  id: string
  entry: EntryType
  error?: string
}

type EntriesResponse = { entries: EntryType[] }

export async function postEntry(
  workspaceId: string,
  body: any & { clientMutationId?: string },
  options: {
    traceId?: string
    flow?: string
    step?: string
  } = {}
): Promise<CanonicalEntryResponse> {
  const res = await tryWrite(
    `${API_ENDPOINTS.entries.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body,
    options.traceId && options.flow
      ? {
          traceId: options.traceId,
          flow: options.flow,
          step: options.step ?? "entry_create.network_request",
          metadata: {
            workspaceId,
          },
        }
      : undefined
  )

  return {
    ok: true,
    id: (res as any).id,
    entry: (res as any).entry,
  }
}

export async function editEntry(
  workspaceId: string,
  entryId: string,
  body: any
): Promise<CanonicalEntryResponse> {
  const res = await tryWrite(
    `${API_ENDPOINTS.entries.patch}?workspaceId=${encodeURIComponent(workspaceId)}&entryId=${encodeURIComponent(entryId)}`,
    "PATCH",
    body
  )

  return {
    ok: true,
    id: (res as any).id,
    entry: (res as any).entry,
  }
}

export async function getEntries(): Promise<EntryType[]> {
  const res = await apiFetch<EntriesResponse>(
    API_ENDPOINTS.entries.get,
    { method: "GET" }
  )
  return res.entries
}

export async function getEntriesForPeriod(
  workspaceId: string,
  periodId: string
) {
  const url = `${API_ENDPOINTS.entries.get}?workspaceId=${encodeURIComponent(workspaceId)}&periodId=${encodeURIComponent(periodId)}`
  const res = await apiFetch<EntriesResponse>(url, { method: "GET" })
  return res.entries
}

export async function deleteEntry(
  workspaceId: string,
  entryId: string
): Promise<{ ok: boolean; error?: string }> {
  const res = (await tryWrite(
    `${API_ENDPOINTS.entries.delete}?workspaceId=${encodeURIComponent(workspaceId)}&entryId=${encodeURIComponent(entryId)}`,
    "DELETE",
    {}
  )) as any

  return {
    ok: res?.ok ?? true,
    error: res?.error,
  }
}
