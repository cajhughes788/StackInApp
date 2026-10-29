"use client"

// lib/domain/clientService.ts
// Client changes that don't make the user wait (backgroundSave.ts): adding
// one, editing their details or notes, archiving and restoring. Each shows
// at once and reaches the server behind it, one at a time per client.
// Merging two clients still waits — it moves invoices and payments.

import { createClient, updateClient } from "@/lib/api/clientsApi"
import { saveInBackground } from "@/lib/domain/backgroundSave"
import { clientSaveKey, useClientsStore } from "@/lib/stores/useClientsStore"
import { clientKey } from "@shared/clients"
import { ClientSchema, type ClientCreateInput, type ClientPatch, type ClientType } from "@shared/schemas/client"

function newClientId(): string {
  const bytes = new Uint8Array(15)
  crypto.getRandomValues(bytes)
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from(bytes, (byte) => letters[byte % letters.length]).join("") + Date.now().toString(36).slice(-5)
}

function blankToNull(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

/** Shows the new client now and saves them in the background, or says why not. */
export function createClientInBackground(workspaceId: string, input: ClientCreateInput): { client: ClientType } | { error: string } {
  const store = useClientsStore.getState()
  const nameKey = clientKey(input.name)
  const existing = (store.byWorkspaceId[workspaceId]?.clients ?? []).find((client) => client.nameKey === nameKey && !client.archived)
  if (existing) return { error: `${existing.name} is already a client.` }

  const nowIso = new Date().toISOString()
  const id = input.id ?? newClientId()
  const client = ClientSchema.parse({
    id,
    workspaceId,
    name: input.name.trim(),
    nameKey,
    email: blankToNull(input.email),
    phone: blankToNull(input.phone),
    address: blankToNull(input.address),
    notes: input.notes ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  store.upsert(workspaceId, client)
  saveInBackground({
    key: clientSaveKey(id),
    task: () => createClient(workspaceId, { ...input, id }),
    onSaved: (saved) => useClientsStore.getState().upsert(workspaceId, saved),
    onFailed: () => {
      useClientsStore.getState().remove(workspaceId, id)
      void useClientsStore.getState().load(workspaceId, { force: true }).catch(() => {})
    },
    failTitle: `Couldn't add ${client.name}`,
    failAction: { label: "Try again", run: () => void createClientInBackground(workspaceId, { ...input, id }) },
  })
  return { client }
}

/** Shows the change now and saves it in the background. */
export function updateClientInBackground(workspaceId: string, client: ClientType, patch: ClientPatch, failTitle: string): ClientType {
  const next = ClientSchema.parse({
    ...client,
    ...(patch.name !== undefined ? { name: patch.name.trim(), nameKey: clientKey(patch.name) } : {}),
    ...(patch.email !== undefined ? { email: blankToNull(patch.email) } : {}),
    ...(patch.phone !== undefined ? { phone: blankToNull(patch.phone) } : {}),
    ...(patch.address !== undefined ? { address: blankToNull(patch.address) } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
    updatedAt: new Date().toISOString(),
  })
  useClientsStore.getState().upsert(workspaceId, next)
  saveInBackground({
    key: clientSaveKey(client.id),
    task: () => updateClient(workspaceId, client.id, patch),
    onSaved: (saved) => useClientsStore.getState().upsert(workspaceId, saved),
    onFailed: () => {
      useClientsStore.getState().upsert(workspaceId, client)
      void useClientsStore.getState().load(workspaceId, { force: true }).catch(() => {})
    },
    failTitle: `${failTitle} (${client.name})`,
  })
  return next
}
