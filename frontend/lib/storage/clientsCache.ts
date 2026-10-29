import { getWithMeta, setWithMeta, clearKeysWithMeta } from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import { CACHE_VERSIONS } from "./cacheVersions"
import { ClientPaymentSummarySchema, ClientSchema, type ClientPaymentSummary, type ClientType } from "@shared/schemas/client"
import { z } from "zod"

// The last clients list from the server, so Clients shows at once on the
// next launch while a fresh copy loads. Payments are this year's totals, so
// a copy from another year is ignored.

type PersistedClients = {
  year: string
  clients: ClientType[]
  payments: Record<string, ClientPaymentSummary>
}

const PersistedClientsSchema = z.object({
  year: z.string(),
  clients: z.array(ClientSchema),
  payments: z.record(z.string(), ClientPaymentSummarySchema),
})

function clientsKey(workspaceId: string): string {
  return `workspaces::${workspaceId}::clients`
}

export async function readClientsCache(
  workspaceId: string,
  year: string
): Promise<{ clients: ClientType[]; payments: Record<string, ClientPaymentSummary> } | null> {
  const rec = await getWithMeta<PersistedClients>(clientsKey(workspaceId), { expectedVersion: CACHE_VERSIONS.clients })
  if (!rec?.data) return null
  const parsed = safeSchemaParse(PersistedClientsSchema, rec.data)
  if (!parsed.success || parsed.data.year !== year) return null
  return { clients: parsed.data.clients, payments: parsed.data.payments }
}

export async function saveClientsCache(
  workspaceId: string,
  year: string,
  clients: ClientType[],
  payments: Record<string, ClientPaymentSummary>
): Promise<void> {
  await setWithMeta<PersistedClients>(clientsKey(workspaceId), { year, clients, payments }, { version: CACHE_VERSIONS.clients })
}

export async function clearClientsCache(workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta((key) => key.endsWith("::clients"))
    return
  }
  await clearKeysWithMeta((key) => key === clientsKey(workspaceId))
}
