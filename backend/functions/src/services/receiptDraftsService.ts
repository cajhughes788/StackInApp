import { z } from "zod"

import { db } from "../admin"
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../lib/httpErrors"
import {
  ReceiptDraftPatchSchema,
  ReceiptDraftSchema,
  type ReceiptDraft,
  type ReceiptDraftInput,
} from "@shared/schemas/receiptDraft"

const ReceiptDraftArraySchema = z.array(ReceiptDraftSchema)

async function assertWorkspaceMembership(
  workspaceId: string,
  uid: string
): Promise<void> {
  const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get()
  if (!memberSnap.exists) {
    throw new ForbiddenError("Forbidden")
  }
}

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

function deriveReceiptDraftStatus(
  input: Pick<ReceiptDraft, "completion" | "status">
): ReceiptDraft["status"] {
  if (input.status === "committed" || input.status === "dismissed") {
    return input.status
  }

  return input.completion.readyToCommit ? "ready_to_review" : "draft"
}

function normalizeReceiptDraft(
  workspaceId: string,
  draftId: string,
  raw: ReceiptDraftInput,
  nowIso: string
): ReceiptDraft {
  const completion = {
    missingFields: raw.completion?.missingFields ?? [],
    readyToCommit: raw.completion?.readyToCommit ?? false,
  }

  return ReceiptDraftSchema.parse({
    id: draftId,
    workspaceId,
    status: deriveReceiptDraftStatus({
      status: raw.status ?? "draft",
      completion,
    }),
    occurredAt: raw.occurredAt ?? null,
    amount: raw.amount ?? null,
    currency: raw.currency ?? "USD",
    description: raw.description ?? null,
    counterparty: raw.counterparty ?? null,
    parseWarnings: raw.parseWarnings ?? [],
    confidence: raw.confidence ?? null,
    suggestedExpenseAccount: raw.suggestedExpenseAccount ?? null,
    completion,
    notes: raw.notes ?? "",
    receiptAssetId: raw.receiptAssetId,
    receiptAnalysisId: raw.receiptAnalysisId,
    analysisStatus: raw.analysisStatus,
    receiptAsset: raw.receiptAsset,
    lineItems: raw.lineItems,
    allocations: raw.allocations,
    fieldConfidence: raw.fieldConfidence,
    committedExpenseId: raw.committedExpenseId,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  })
}

export async function createReceiptDraft(
  workspaceId: string,
  uid: string,
  input: unknown
): Promise<ReceiptDraft> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsed = ReceiptDraftSchema.omit({
    id: true,
    workspaceId: true,
    createdAt: true,
    updatedAt: true,
    version: true,
  }).safeParse(input)

  if (!parsed.success) {
    throw new BadRequestError("Invalid receipt draft payload", parsed.error.format())
  }

  const nowIso = new Date().toISOString()
  const draftRef = db.collection(`workspaces/${workspaceId}/receiptDrafts`).doc()
  const draft = normalizeReceiptDraft(workspaceId, draftRef.id, parsed.data, nowIso)
  await draftRef.set(stripUndefinedDeep(draft))
  return draft
}

export async function listReceiptDrafts(
  workspaceId: string,
  uid: string
): Promise<ReceiptDraft[]> {
  await assertWorkspaceMembership(workspaceId, uid)

  const snap = await db
    .collection(`workspaces/${workspaceId}/receiptDrafts`)
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get()

  return ReceiptDraftArraySchema.parse(
    snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
  )
}

export async function getReceiptDraft(
  workspaceId: string,
  uid: string,
  receiptDraftId: string
): Promise<ReceiptDraft> {
  await assertWorkspaceMembership(workspaceId, uid)

  const snap = await db.doc(`workspaces/${workspaceId}/receiptDrafts/${receiptDraftId}`).get()
  if (!snap.exists) {
    throw new NotFoundError("Receipt draft not found")
  }

  return ReceiptDraftSchema.parse({
    id: snap.id,
    ...snap.data(),
  })
}

export async function findReceiptDraftByAssetId(
  workspaceId: string,
  uid: string,
  receiptAssetId: string
): Promise<ReceiptDraft | null> {
  await assertWorkspaceMembership(workspaceId, uid)

  const snap = await db
    .collection(`workspaces/${workspaceId}/receiptDrafts`)
    .where("receiptAssetId", "==", receiptAssetId)
    .get()

  if (snap.empty) {
    return null
  }

  const candidates: Array<Record<string, unknown> & { id: string }> = snap.docs.map((candidate) => {
      const data = candidate.data() as Record<string, unknown>
      return {
        id: candidate.id,
        ...data,
      }
    })
  const doc = candidates.sort((left, right) => {
      const leftUpdatedAt =
        typeof left.updatedAt === "string" ? Date.parse(left.updatedAt) : 0
      const rightUpdatedAt =
        typeof right.updatedAt === "string" ? Date.parse(right.updatedAt) : 0
      return rightUpdatedAt - leftUpdatedAt
    })[0]

  return ReceiptDraftSchema.parse({
    ...doc,
  })
}

export async function updateReceiptDraft(
  workspaceId: string,
  uid: string,
  receiptDraftId: string,
  patch: unknown
): Promise<ReceiptDraft> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsedPatch = ReceiptDraftPatchSchema.safeParse(patch)
  if (!parsedPatch.success) {
    throw new BadRequestError("Invalid receipt draft patch", parsedPatch.error.format())
  }

  const draftRef = db.doc(`workspaces/${workspaceId}/receiptDrafts/${receiptDraftId}`)
  const snap = await draftRef.get()
  if (!snap.exists) {
    throw new NotFoundError("Receipt draft not found")
  }

  const existing = ReceiptDraftSchema.parse({
    id: snap.id,
    ...snap.data(),
  })

  const completion = parsedPatch.data.completion
    ? {
        ...existing.completion,
        ...parsedPatch.data.completion,
      }
    : existing.completion

  const next = ReceiptDraftSchema.parse({
    ...existing,
    ...parsedPatch.data,
    completion,
    status: deriveReceiptDraftStatus({
      status: parsedPatch.data.status ?? existing.status,
      completion,
    }),
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  })

  await draftRef.set(stripUndefinedDeep(next))
  return next
}

export async function upsertReceiptDraftForAsset(
  workspaceId: string,
  uid: string,
  receiptAssetId: string,
  input: ReceiptDraftInput
): Promise<ReceiptDraft> {
  const existing = await findReceiptDraftByAssetId(workspaceId, uid, receiptAssetId)
  if (!existing) {
    return createReceiptDraft(workspaceId, uid, input)
  }

  const patch = { ...input }
  delete (patch as Partial<ReceiptDraftInput>).receiptAssetId
  return updateReceiptDraft(workspaceId, uid, existing.id, patch)
}
