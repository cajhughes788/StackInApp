import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import type {
  ClientCreateInput,
  ClientPatch,
  ClientPayment,
  ClientPaymentSummary,
  ClientType,
} from "@shared/schemas/client"

// Saved clients — see shared/schemas/client.ts. year = "2026" (this year in
// the user's own calendar).

export async function getClients(
  workspaceId: string,
  year: string
): Promise<{ clients: ClientType[]; payments: Record<string, ClientPaymentSummary> }> {
  const res = await apiFetch<{ clients: ClientType[]; payments?: Record<string, ClientPaymentSummary> }>(
    `${API_ENDPOINTS.clients.get}?workspaceId=${encodeURIComponent(workspaceId)}&year=${year}`,
    { method: "GET" }
  )
  return { clients: res.clients ?? [], payments: res.payments ?? {} }
}

export async function getClientDetail(
  workspaceId: string,
  clientId: string,
  year: string
): Promise<{ client: ClientType; summary: ClientPaymentSummary | null; payments: ClientPayment[] }> {
  const res = await apiFetch<{ client: ClientType; summary: ClientPaymentSummary | null; payments?: ClientPayment[] }>(
    `${API_ENDPOINTS.clients.get}?workspaceId=${encodeURIComponent(workspaceId)}&clientId=${encodeURIComponent(clientId)}&year=${year}`,
    { method: "GET" }
  )
  return { client: res.client, summary: res.summary ?? null, payments: res.payments ?? [] }
}

export async function createClient(workspaceId: string, input: ClientCreateInput): Promise<ClientType> {
  const res = await tryWrite<{ client: ClientType }>(
    `${API_ENDPOINTS.clients.save}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    input
  )
  return res.client
}

export async function updateClient(workspaceId: string, clientId: string, patch: ClientPatch): Promise<ClientType> {
  const res = await tryWrite<{ client: ClientType }>(
    `${API_ENDPOINTS.clients.save}?workspaceId=${encodeURIComponent(workspaceId)}&clientId=${encodeURIComponent(clientId)}`,
    "POST",
    patch
  )
  return res.client
}

/** Folds fromId into intoId (fromId is deleted). */
export async function mergeClients(workspaceId: string, fromId: string, intoId: string): Promise<ClientType> {
  const res = await tryWrite<{ client: ClientType }>(
    `${API_ENDPOINTS.clients.merge}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    { fromId, intoId }
  )
  return res.client
}
