import { z } from "zod"

import { db } from "../admin"
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../lib/httpErrors"
import {
  CreateImportBatchSchema,
  ImportBatchSchema,
  ImportItemPatchSchema,
  ImportItemSchema,
  type ImportBatch,
  type ImportItem,
  type ImportItemInput,
} from "@shared/schemas/import"

const ImportBatchArraySchema = z.array(ImportBatchSchema)
const ImportItemArraySchema = z.array(ImportItemSchema)

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry)) as T
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

async function assertWorkspaceMembership(
  workspaceId: string,
  uid: string
): Promise<void> {
  const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get()
  if (!memberSnap.exists) {
    throw new ForbiddenError("Forbidden")
  }
}

function summarizeBatch(
  items: ImportItem[]
): Pick<
  ImportBatch,
  "itemCount" | "pendingCount" | "acceptedCount" | "rejectedCount" | "committedCount"
> {
  return items.reduce(
    (acc, item) => {
      acc.itemCount += 1
      if (item.status === "pending" || item.status === "needs_review") {
        acc.pendingCount += 1
      }
      if (item.status === "accepted") {
        acc.acceptedCount += 1
      }
      if (item.status === "rejected") {
        acc.rejectedCount += 1
      }
      if (item.status === "committed") {
        acc.committedCount += 1
      }
      return acc
    },
    {
      itemCount: 0,
      pendingCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      committedCount: 0,
    }
  )
}

function resolveBatchStatus(summary: ReturnType<typeof summarizeBatch>): ImportBatch["status"] {
  if (summary.itemCount === 0) {
    return "pending"
  }
  if (summary.pendingCount > 0) {
    return "in_review"
  }
  return "completed"
}

function normalizeImportItem(
  workspaceId: string,
  batchId: string,
  itemId: string,
  raw: ImportItemInput,
  nowIso: string
): ImportItem {
  const parsed = ImportItemSchema.parse({
    id: itemId,
    workspaceId,
    batchId,
    kind: raw.kind ?? "unknown",
    source: raw.source,
    status: raw.status ?? "pending",
    importedAt: raw.importedAt ?? nowIso,
    occurredAt: raw.occurredAt ?? null,
    amount: raw.amount ?? null,
    currency: raw.currency ?? null,
    description: raw.description ?? null,
    counterparty: raw.counterparty ?? null,
    rawRow: raw.rawRow ?? {},
    parseWarnings: raw.parseWarnings ?? [],
    confidence: raw.confidence ?? null,
    suggestedDirection: raw.suggestedDirection ?? null,
    suggestedIncomeCategory: raw.suggestedIncomeCategory ?? null,
    suggestedExpenseAccount: raw.suggestedExpenseAccount ?? null,
    userDecision: {
      isBusiness: raw.userDecision?.isBusiness ?? null,
      finalKind: raw.userDecision?.finalKind ?? null,
    },
    completion: {
      missingFields: raw.completion?.missingFields ?? [],
      readyToCommit: raw.completion?.readyToCommit ?? false,
    },
    notes: raw.notes ?? "",
    duplicateSignals: raw.duplicateSignals,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  })

  return parsed
}

async function recomputeAndPersistBatch(
  workspaceId: string,
  batchId: string
): Promise<ImportBatch> {
  const batchRef = db.doc(`workspaces/${workspaceId}/importBatches/${batchId}`)
  const itemsSnap = await batchRef.collection("items").get()
  const items = ImportItemArraySchema.parse(itemsSnap.docs.map((doc) => doc.data()))
  const summary = summarizeBatch(items)
  const existingSnap = await batchRef.get()
  if (!existingSnap.exists) {
    throw new NotFoundError("Import batch not found")
  }
  const existing = ImportBatchSchema.parse({
    id: existingSnap.id,
    ...existingSnap.data(),
  })
  const nextBatch = ImportBatchSchema.parse({
    ...existing,
    ...summary,
    status: resolveBatchStatus(summary),
    updatedAt: new Date().toISOString(),
  })
  await batchRef.set(nextBatch)
  return nextBatch
}

export async function createImportBatch(
  workspaceId: string,
  uid: string,
  input: unknown
): Promise<{ batch: ImportBatch; items: ImportItem[] }> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsed = CreateImportBatchSchema.safeParse(input)
  if (!parsed.success) {
    throw new BadRequestError("Invalid import batch payload", parsed.error.format())
  }

  const nowIso = new Date().toISOString()
  const batchRef = db.collection(`workspaces/${workspaceId}/importBatches`).doc()
  const items = parsed.data.items.map((item) =>
    normalizeImportItem(workspaceId, batchRef.id, batchRef.collection("items").doc().id, item, nowIso)
  )
  const summary = summarizeBatch(items)

  const batch = ImportBatchSchema.parse({
    id: batchRef.id,
    workspaceId,
    source: parsed.data.batch.source,
    label: parsed.data.batch.label,
    fileName: parsed.data.batch.fileName,
    notes: parsed.data.batch.notes,
    status: parsed.data.batch.status ?? resolveBatchStatus(summary),
    ...summary,
    createdAt: nowIso,
    updatedAt: nowIso,
  })

  const writer = db.batch()
  writer.set(batchRef, stripUndefinedDeep(batch))
  for (const item of items) {
    writer.set(batchRef.collection("items").doc(item.id), stripUndefinedDeep(item))
  }
  await writer.commit()

  return { batch, items }
}

export async function getImportBatches(
  workspaceId: string,
  uid: string
): Promise<ImportBatch[]> {
  await assertWorkspaceMembership(workspaceId, uid)

  const snap = await db
    .collection(`workspaces/${workspaceId}/importBatches`)
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get()

  return ImportBatchArraySchema.parse(
    snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
  )
}

export async function getImportItems(
  workspaceId: string,
  uid: string,
  batchId: string
): Promise<ImportItem[]> {
  await assertWorkspaceMembership(workspaceId, uid)

  const batchRef = db.doc(`workspaces/${workspaceId}/importBatches/${batchId}`)
  const batchSnap = await batchRef.get()
  if (!batchSnap.exists) {
    throw new NotFoundError("Import batch not found")
  }

  const itemsSnap = await batchRef.collection("items").orderBy("createdAt", "asc").get()
  return ImportItemArraySchema.parse(itemsSnap.docs.map((doc) => doc.data()))
}

export async function updateImportItem(
  workspaceId: string,
  uid: string,
  batchId: string,
  itemId: string,
  patch: unknown
): Promise<{ batch: ImportBatch; item: ImportItem }> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsedPatch = ImportItemPatchSchema.safeParse(patch)
  if (!parsedPatch.success) {
    throw new BadRequestError("Invalid import item patch", parsedPatch.error.format())
  }

  const itemRef = db.doc(
    `workspaces/${workspaceId}/importBatches/${batchId}/items/${itemId}`
  )
  const itemSnap = await itemRef.get()
  if (!itemSnap.exists) {
    throw new NotFoundError("Import item not found")
  }

  const existing = ImportItemSchema.parse(itemSnap.data())
  const nowIso = new Date().toISOString()
  const next = ImportItemSchema.parse({
    ...existing,
    ...parsedPatch.data,
    userDecision: {
      ...existing.userDecision,
      ...(parsedPatch.data.userDecision ?? {}),
    },
    completion: {
      ...existing.completion,
      ...(parsedPatch.data.completion ?? {}),
    },
    updatedAt: nowIso,
    version: (existing.version ?? 1) + 1,
  })

  await itemRef.set(stripUndefinedDeep(next))
  const batch = await recomputeAndPersistBatch(workspaceId, batchId)

  return { batch, item: next }
}
