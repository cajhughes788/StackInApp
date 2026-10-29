import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import {
  ClientCreateInputSchema,
  ClientPatchSchema,
  ClientSchema,
  type ClientPayment,
  type ClientPaymentSummary,
  type ClientType,
} from "@shared/schemas/client"
import { clientKey, summarizeClientPayments, type ClientMatchEntry } from "@shared/clients"
import { InvoiceSchema } from "@shared/schemas/invoice"

// Saved clients — see shared/schemas/client.ts.

export function clientsCol(workspaceId: string) {
  return db.collection(`workspaces/${workspaceId}/clients`)
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

function parseClient(data: unknown): ClientType | null {
  const parsed = ClientSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

async function readAllClients(workspaceId: string): Promise<ClientType[]> {
  const snap = await clientsCol(workspaceId).get()
  return snap.docs.map((doc) => parseClient(doc.data())).filter((c): c is ClientType => c !== null)
}

/** The client a name means (by name or alias), active ones first. */
export async function findClientByName(workspaceId: string, name: string): Promise<ClientType | null> {
  const key = clientKey(name)
  if (!key) return null
  const [byName, byAlias] = await Promise.all([
    clientsCol(workspaceId).where("nameKey", "==", key).get(),
    clientsCol(workspaceId).where("aliases", "array-contains", key).get(),
  ])
  const found = [...byName.docs, ...byAlias.docs]
    .map((doc) => parseClient(doc.data()))
    .filter((c): c is ClientType => c !== null)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.createdAt.localeCompare(b.createdAt))
  return found[0] ?? null
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

/**
 * The client an invoice belongs to (no membership check — callers have done
 * it): the one picked (clientId), else the one with that name, else a new
 * one made from the invoice's details. Contact details on the invoice fill
 * in blanks on the client, never overwrite them.
 */
export async function resolveInvoiceClient(
  workspaceId: string,
  input: {
    clientId?: string | null
    clientName: string
    clientEmail?: string | null
    clientPhone?: string | null
    clientAddress?: string | null
  }
): Promise<ClientType> {
  let client: ClientType | null = null
  if (input.clientId) {
    const snap = await clientsCol(workspaceId).doc(input.clientId).get()
    client = snap.exists ? parseClient(snap.data()) : null
    if (!client) throw new BadRequestError("That client no longer exists.")
  } else {
    client = await findClientByName(workspaceId, input.clientName)
  }

  const nowIso = new Date().toISOString()
  if (!client) {
    const ref = clientsCol(workspaceId).doc()
    const created = ClientSchema.parse({
      id: ref.id,
      workspaceId,
      name: input.clientName.trim(),
      nameKey: clientKey(input.clientName),
      email: blankToNull(input.clientEmail),
      phone: blankToNull(input.clientPhone),
      address: blankToNull(input.clientAddress),
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await ref.set(created)
    return created
  }

  const fill: Partial<ClientType> = {}
  if (!client.email && blankToNull(input.clientEmail)) fill.email = blankToNull(input.clientEmail)
  if (!client.phone && blankToNull(input.clientPhone)) fill.phone = blankToNull(input.clientPhone)
  if (!client.address && blankToNull(input.clientAddress)) fill.address = blankToNull(input.clientAddress)
  if (client.archived) fill.archived = false // invoicing them again brings them back
  if (Object.keys(fill).length > 0) {
    await clientsCol(workspaceId).doc(client.id).set({ ...fill, updatedAt: nowIso }, { merge: true })
    client = { ...client, ...fill, updatedAt: nowIso }
  }
  return client
}

function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10)
}

/**
 * The client a customer booking online is (no membership check — the
 * public booking page calls it): found by email, else by phone, since a
 * name alone could be someone else with the same name. Otherwise a new
 * client. Their details fill in blanks, never overwrite.
 */
export async function resolveClientByContact(
  workspaceId: string,
  input: { clientName: string; clientEmail: string; clientPhone?: string | null }
): Promise<ClientType> {
  const email = input.clientEmail.trim().toLowerCase()
  const phone = phoneDigits(input.clientPhone)
  const clients = await readAllClients(workspaceId)
  const byActive = (a: ClientType, b: ClientType) => Number(a.archived) - Number(b.archived) || a.createdAt.localeCompare(b.createdAt)
  const found =
    clients.filter((client) => client.email?.trim().toLowerCase() === email).sort(byActive)[0] ??
    (phone.length === 10 ? clients.filter((client) => phoneDigits(client.phone) === phone).sort(byActive)[0] : undefined)
  if (found) return resolveInvoiceClient(workspaceId, { ...input, clientId: found.id, clientName: found.name })
  const nowIso = new Date().toISOString()
  const ref = clientsCol(workspaceId).doc()
  const created = ClientSchema.parse({
    id: ref.id,
    workspaceId,
    name: input.clientName.trim(),
    nameKey: clientKey(input.clientName),
    email: blankToNull(input.clientEmail),
    phone: blankToNull(input.clientPhone),
    address: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  await ref.set(created)
  return created
}

// Only the fields ClientMatchEntry uses (shared/clients.ts) — entryGross
// reads just incomeBreakdowns and customIncome. Every entry is still read,
// so lifetime totals stay whole; each one is just smaller.
const MATCH_ENTRY_FIELDS = [
  "workspace",
  "date",
  "kind",
  "clientMutationId",
  "payerName",
  "refund",
  "independent.incomeBreakdowns",
  "independent.customIncome",
] as const

async function readMatchEntries(workspaceId: string): Promise<ClientMatchEntry[]> {
  const snap = await db.collection(`workspaces/${workspaceId}/entries`).select(...MATCH_ENTRY_FIELDS).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ClientMatchEntry, "id">) }))
}

/** Clients plus what they paid outside invoices. year = "2026". */
export async function listClients(
  workspaceId: string,
  uid: string,
  year: string
): Promise<{ clients: ClientType[]; payments: Record<string, ClientPaymentSummary> }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const [clients, entries] = await Promise.all([readAllClients(workspaceId), readMatchEntries(workspaceId)])
  const { summaries } = summarizeClientPayments(clients, entries, year)
  clients.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  return { clients, payments: summaries }
}

/** One client, with each payment outside invoices. */
export async function getClient(
  workspaceId: string,
  uid: string,
  clientId: string,
  year: string
): Promise<{ client: ClientType; summary: ClientPaymentSummary | null; payments: ClientPayment[] }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const [clients, entries] = await Promise.all([readAllClients(workspaceId), readMatchEntries(workspaceId)])
  const client = clients.find((c) => c.id === clientId)
  if (!client) throw new NotFoundError("Client not found")
  const { summaries, payments } = summarizeClientPayments(clients, entries, year)
  return { client, summary: summaries[clientId] ?? null, payments: payments[clientId] ?? [] }
}

export async function createClient(workspaceId: string, uid: string, raw: unknown): Promise<ClientType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = ClientCreateInputSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid client", formatIssues(parsed.error))
  const input = parsed.data
  const ref = input.id ? clientsCol(workspaceId).doc(input.id) : clientsCol(workspaceId).doc()
  if (input.id) {
    // A retry of the same add.
    const retried = parseClient((await ref.get()).data())
    if (retried) return retried
  }
  const existing = await findClientByName(workspaceId, input.name)
  if (existing && !existing.archived) {
    throw new ConflictError(`${existing.name} is already a client.`)
  }
  const nowIso = new Date().toISOString()
  const client = ClientSchema.parse({
    id: ref.id,
    workspaceId,
    name: input.name,
    nameKey: clientKey(input.name),
    email: blankToNull(input.email),
    phone: blankToNull(input.phone),
    address: blankToNull(input.address),
    notes: input.notes ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  await ref.set(client)
  return client
}

export async function updateClient(
  workspaceId: string,
  uid: string,
  clientId: string,
  raw: unknown
): Promise<ClientType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = ClientPatchSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid client changes", formatIssues(parsed.error))
  const patch = parsed.data
  const ref = clientsCol(workspaceId).doc(clientId)
  const snap = await ref.get()
  const current = snap.exists ? parseClient(snap.data()) : null
  if (!current) throw new NotFoundError("Client not found")

  const next: ClientType = {
    ...current,
    ...(patch.email !== undefined ? { email: blankToNull(patch.email) } : {}),
    ...(patch.phone !== undefined ? { phone: blankToNull(patch.phone) } : {}),
    ...(patch.address !== undefined ? { address: blankToNull(patch.address) } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
    updatedAt: new Date().toISOString(),
  }
  if (patch.name && clientKey(patch.name) !== current.nameKey) {
    const other = await findClientByName(workspaceId, patch.name)
    if (other && other.id !== current.id) {
      throw new ConflictError(`${other.name} is already a client — merge them instead.`)
    }
    // The old name keeps matching (invoices and payments made out to it).
    next.aliases = Array.from(new Set([...current.aliases, current.nameKey])).filter(
      (key) => key !== clientKey(patch.name as string)
    )
    next.name = patch.name
    next.nameKey = clientKey(patch.name)
  } else if (patch.name) {
    next.name = patch.name // same key, different capitalisation
  }
  const client = ClientSchema.parse(next)
  await ref.set(client)
  return client
}

/**
 * Folds `fromId` into `intoId`: its invoices move over, its name and aliases
 * become aliases (so payments under that name keep counting), blanks in the
 * kept client's contact details are filled, notes are joined, and the merged
 * client is deleted.
 */
export async function mergeClients(
  workspaceId: string,
  uid: string,
  fromId: string,
  intoId: string
): Promise<ClientType> {
  await assertWorkspaceMembership(workspaceId, uid)
  if (fromId === intoId) throw new BadRequestError("Pick two different clients to merge.")
  const fromRef = clientsCol(workspaceId).doc(fromId)
  const intoRef = clientsCol(workspaceId).doc(intoId)
  const linkedInvoices = db.collection(`workspaces/${workspaceId}/invoices`).where("clientId", "==", fromId)

  return db.runTransaction(async (txn) => {
    const [fromSnap, intoSnap] = await txn.getAll(fromRef, intoRef)
    const invoicesSnap = await txn.get(linkedInvoices)
    const from = fromSnap.exists ? parseClient(fromSnap.data()) : null
    const into = intoSnap.exists ? parseClient(intoSnap.data()) : null
    if (!from || !into) throw new NotFoundError("Client not found")
    const nowIso = new Date().toISOString()
    const merged = ClientSchema.parse({
      ...into,
      email: into.email ?? from.email,
      phone: into.phone ?? from.phone,
      address: into.address ?? from.address,
      notes: [into.notes, from.notes].map((n) => n.trim()).filter(Boolean).join("\n\n"),
      aliases: Array.from(new Set([...into.aliases, from.nameKey, ...from.aliases])).filter(
        (key) => key !== into.nameKey
      ),
      archived: false,
      updatedAt: nowIso,
    })
    txn.set(intoRef, merged)
    for (const doc of invoicesSnap.docs) {
      // Only the link moves; the name printed on each invoice stays as sent.
      if (InvoiceSchema.safeParse(doc.data()).success) txn.update(doc.ref, { clientId: intoId })
    }
    txn.delete(fromRef)
    return merged
  })
}
