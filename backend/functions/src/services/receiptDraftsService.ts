import { z } from "zod"

import { db } from "../admin"
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../lib/httpErrors"
import {
  ReceiptDraftPatchSchema,
  ReceiptDraftSchema,
  type ReceiptDraft,
  type ReceiptDraftInput,
} from "@shared/schemas/receiptDraft"
import { ExpenseSchema, ExpenseInput, type ExpenseType } from "@shared/schemas/expense"
import {
  normalizeExpenseAccount,
  resolvePeriodId,
  findExpenseByClientMutationId,
  findExpenseByReceiptAssetId,
  syncExpenseProfitLossDates,
} from "./expensesService"

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
  const draftRef = db
    .collection(`workspaces/${workspaceId}/receiptDrafts`)
    .doc(parsed.data.receiptAssetId)
  const draft = normalizeReceiptDraft(workspaceId, draftRef.id, parsed.data, nowIso)
  await draftRef.set(stripUndefinedDeep(draft))
  return draft
}

export async function listReceiptDrafts(
  workspaceId: string,
  uid: string
): Promise<ReceiptDraft[]> {
  await assertWorkspaceMembership(workspaceId, uid)

  // Only return actionable drafts. Committed/dismissed drafts belong to history
  // and are not needed in the capture panel. Filtering by status eliminates
  // the old 200-document hard cap that could silently hide older pending drafts.
  // Requires a Firestore composite index: status ASC + updatedAt DESC.
  const snap = await db
    .collection(`workspaces/${workspaceId}/receiptDrafts`)
    .where("status", "in", ["draft", "ready_to_review"])
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get()

  return ReceiptDraftArraySchema.parse(
    snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
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

const VALID_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export async function commitReceiptDraftWithExpense(
  workspaceId: string,
  uid: string,
  draftId: string,
  expenseInput: unknown
): Promise<{ expense: ExpenseType; draft: ReceiptDraft }> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsed = ExpenseInput.safeParse(expenseInput)
  if (!parsed.success) {
    throw new BadRequestError("Invalid expense data", parsed.error.format())
  }
  if (!VALID_DATE_RE.test(parsed.data.date)) {
    throw new BadRequestError("Date must be a valid calendar date (YYYY-MM-DD).")
  }

  const draftRef = db.doc(`workspaces/${workspaceId}/receiptDrafts/${draftId}`)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) {
    throw new NotFoundError("Receipt draft not found")
  }
  const existingDraft = ReceiptDraftSchema.parse({ id: draftSnap.id, ...draftSnap.data() })

  // Idempotency: if draft is already committed with an expense, return existing records.
  if (existingDraft.status === "committed" && existingDraft.committedExpenseId) {
    const expenseRef = db.doc(`workspaces/${workspaceId}/expenses/${existingDraft.committedExpenseId}`)
    const expenseSnap = await expenseRef.get()
    if (expenseSnap.exists) {
      return {
        expense: ExpenseSchema.parse({ id: expenseSnap.id, ...expenseSnap.data() }),
        draft: existingDraft,
      }
    }
  }

  // Run the two idempotency/uniqueness checks concurrently — neither depends on
  // the other, and in the common case (no duplicates) both return null.
  const clientMutationId = typeof parsed.data.clientMutationId === "string"
    ? parsed.data.clientMutationId : null

  const [existingByMutationId, existingForAsset] = await Promise.all([
    clientMutationId
      ? findExpenseByClientMutationId(workspaceId, clientMutationId)
      : Promise.resolve(null),
    existingDraft.receiptAssetId
      ? findExpenseByReceiptAssetId(workspaceId, existingDraft.receiptAssetId)
      : Promise.resolve(null),
  ])

  if (existingByMutationId) {
    const nowIso = new Date().toISOString()
    const recoveredDraft = ReceiptDraftSchema.parse({
      ...existingDraft,
      status: "committed",
      committedExpenseId: existingByMutationId.id,
      updatedAt: nowIso,
      version: existingDraft.version + 1,
    })
    await draftRef.set(stripUndefinedDeep(recoveredDraft))
    return { expense: existingByMutationId.expense, draft: recoveredDraft }
  }

  if (existingForAsset) {
    throw new ConflictError("This receipt is already linked to an existing expense.")
  }

  // Resolve and validate expense category.
  const normalizedAccount = await normalizeExpenseAccount(workspaceId, parsed.data.account)
  const nowIso = new Date().toISOString()
  const periodId = resolvePeriodId(parsed.data)

  // Resolve OCR provider from draft analysis status.
  // "succeeded" → Textract ran successfully. "failed" → fell back to local Tesseract.
  const ocrProvider: "aws_textract" | "tesseract_local" | undefined =
    existingDraft.analysisStatus === "succeeded"
      ? "aws_textract"
      : existingDraft.analysisStatus === "failed"
        ? "tesseract_local"
        : undefined

  // Build both documents before writing.
  const expenseRef = db.collection(`workspaces/${workspaceId}/expenses`).doc()
  const expense = ExpenseSchema.parse({
    ...parsed.data,
    account: normalizedAccount,
    id: expenseRef.id,
    periodId,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
    // Audit trail — permanently answers "how was this expense created?"
    createdFromReceipt: true,
    receiptDraftId: draftId,
    ocrProvider,
    ocrConfidence: existingDraft.confidence ?? undefined,
  })

  const committedDraft = ReceiptDraftSchema.parse({
    ...existingDraft,
    status: "committed",
    committedExpenseId: expense.id,
    updatedAt: nowIso,
    version: existingDraft.version + 1,
  })

  // Single atomic batch: expense creation + draft commit together.
  // Either both succeed or neither does — no partial commits.
  const batch = db.batch()
  batch.set(expenseRef, stripUndefinedDeep(expense))
  batch.set(draftRef, stripUndefinedDeep(committedDraft))
  await batch.commit()

  // P&L sync is best-effort — do not await it so the commit response is not
  // blocked. Failures are observable via the stale flag on the statement document.
  void syncExpenseProfitLossDates(workspaceId, [expense.date])

  return { expense, draft: committedDraft }
}
