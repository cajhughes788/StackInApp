import { z } from "zod"

import { db } from "../admin"
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../lib/httpErrors"
import type { BackendProfileTrace } from "../lib/profileTrace"
import { withBackendProfileStep } from "../lib/profileTrace"
import {
  ReceiptAnalysisSchema,
  type ReceiptAnalysis,
} from "@shared/schemas/receiptAnalysis"
import {
  ReceiptDraftSchema,
  type ReceiptDraft,
  type ReceiptDraftInput,
} from "@shared/schemas/receiptDraft"

import { normalizeTextractExpense } from "../utils/normalizeTextractExpense"
import { analyzeReceiptWithTextract } from "./textractService"
import { getReceiptAsset } from "./receiptAssetsService"
import { upsertReceiptDraftForAsset } from "./receiptDraftsService"

const noopTrace: BackendProfileTrace = {
  traceId: "receipt-analysis-no-trace",
  flow: "receipt_analysis",
  mark() {},
  start() {},
  end() {},
  error() {},
}

const AnalyzeReceiptInputSchema = z.object({
  receiptAssetId: z.string().trim().min(1),
})

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

async function createQueuedAnalysis(
  workspaceId: string,
  receiptAssetId: string
): Promise<ReceiptAnalysis> {
  const nowIso = new Date().toISOString()
  const ref = db.collection(`workspaces/${workspaceId}/receiptAnalyses`).doc()
  const analysis = ReceiptAnalysisSchema.parse({
    id: ref.id,
    workspaceId,
    receiptAssetId,
    provider: "aws_textract",
    providerVersion: "analyze-expense-2018-06-27",
    status: "queued",
    lineItems: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  await ref.set(stripUndefinedDeep(analysis))
  return analysis
}

async function saveAnalysis(analysis: ReceiptAnalysis): Promise<ReceiptAnalysis> {
  const ref = db.doc(`workspaces/${analysis.workspaceId}/receiptAnalyses/${analysis.id}`)
  await ref.set(stripUndefinedDeep(analysis))
  return analysis
}

async function upsertReceiptDraftFromAnalysis(
  workspaceId: string,
  uid: string,
  receiptAssetId: string,
  analysis: ReceiptAnalysis
): Promise<ReceiptDraft> {
  return upsertReceiptDraftForAsset(
    workspaceId,
    uid,
    receiptAssetId,
    buildReceiptDraftInputFromAnalysis(analysis)
  )
}

function buildReceiptDraftInputFromAnalysis(
  analysis: ReceiptAnalysis,
  overrides: Partial<ReceiptDraftInput> = {}
): ReceiptDraftInput {
  const merchant = analysis.merchant?.trim() || null
  const amount = analysis.total ?? analysis.subtotal ?? null
  const occurredAt = analysis.receiptDate ?? null
  const missingFields = [
    ...(occurredAt ? [] : ["date"]),
    ...(amount != null ? [] : ["amount"]),
    ...(merchant ? [] : ["merchant"]),
  ]

  return {
    status: "ready_to_review",
    occurredAt,
    amount,
    subtotal: analysis.subtotal ?? null,
    tax: analysis.tax ?? null,
    tip: analysis.tip ?? null,
    currency: analysis.currency ?? "USD",
    description: merchant,
    counterparty: merchant,
    parseWarnings: analysis.status === "failed" ? [analysis.error ?? "Receipt analysis failed"] : [],
    confidence: analysis.confidence ?? null,
    suggestedExpenseAccount: null,
    completion: {
      missingFields,
      readyToCommit: missingFields.length === 0,
    },
    notes: "",
    receiptAssetId: analysis.receiptAssetId,
    receiptAnalysisId: analysis.id,
    analysisStatus: analysis.status,
    receiptAsset: undefined,
    lineItems: analysis.lineItems,
    allocations: [],
    fieldConfidence: analysis.fieldConfidence,
    ...overrides,
  }
}

function buildProvisionalReceiptDraft(
  workspaceId: string,
  analysis: ReceiptAnalysis
): ReceiptDraft {
  const nowIso = new Date().toISOString()
  return ReceiptDraftSchema.parse({
    id: `pending:${analysis.id}`,
    workspaceId,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
    ...buildReceiptDraftInputFromAnalysis(analysis, {
      analysisStatus: "analysis_complete_draft_pending",
    }),
  })
}

export async function analyzeReceipt(
  workspaceId: string,
  uid: string,
  input: unknown,
  trace?: BackendProfileTrace
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const activeTrace = trace ?? noopTrace
  await withBackendProfileStep(activeTrace, "receipt.analysis.membership_check", () =>
    assertWorkspaceMembership(workspaceId, uid)
  )

  const parsed = AnalyzeReceiptInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new BadRequestError("Invalid receipt analysis payload", parsed.error.format())
  }
  activeTrace.mark("receipt.analysis.payload_validated", {
    receiptAssetId: parsed.data.receiptAssetId,
  })

  const asset = await withBackendProfileStep(
    activeTrace,
    "receipt.asset.load",
    () => getReceiptAsset(workspaceId, uid, parsed.data.receiptAssetId),
    { receiptAssetId: parsed.data.receiptAssetId }
  )
  activeTrace.mark("receipt.asset.loaded", {
    receiptAssetId: asset.id,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    version: asset.version,
    hasOriginalDownloadUrl: Boolean(asset.originalDownloadUrl ?? asset.downloadUrl),
    hasOriginalStoragePath: Boolean(asset.originalStoragePath ?? asset.storagePath),
    hasPreviewDownloadUrl: Boolean(asset.previewDownloadUrl),
    hasThumbnailDownloadUrl: Boolean(asset.thumbnailDownloadUrl),
    qualityStatus: asset.qualityStatus ?? null,
  })

  let analysis = await withBackendProfileStep(
    activeTrace,
    "receipt.analysis.create",
    () => createQueuedAnalysis(workspaceId, asset.id),
    { receiptAssetId: asset.id }
  )
  activeTrace.mark("receipt.analysis.record_created", {
    analysisId: analysis.id,
    receiptAssetId: asset.id,
    status: analysis.status,
  })

  try {
    analysis = await saveAnalysis({
      ...analysis,
      status: "analyzing",
      updatedAt: new Date().toISOString(),
    })

    const raw = await withBackendProfileStep(
      activeTrace,
      "receipt.textract.request",
      () => analyzeReceiptWithTextract(asset, activeTrace),
      {
        receiptAssetId: asset.id,
        analysisId: analysis.id,
        provider: "aws_textract",
      }
    )

    const normalized = await withBackendProfileStep(
      activeTrace,
      "receipt.analysis.normalize",
      async () => normalizeTextractExpense(raw),
      {
        analysisId: analysis.id,
      }
    )
    activeTrace.mark("receipt.analysis.normalized", {
      analysisId: analysis.id,
      merchant: normalized.merchant ?? null,
      total: normalized.total ?? null,
      currency: normalized.currency ?? null,
      lineItemCount: normalized.lineItems.length,
      hasReceiptDate: Boolean(normalized.receiptDate),
    })

    analysis = await withBackendProfileStep(
      activeTrace,
      "receipt.analysis.persist",
      () =>
        saveAnalysis(
          ReceiptAnalysisSchema.parse({
            ...analysis,
            status: "analysis_complete_draft_pending",
            summaryFieldsRaw: normalized.summaryFieldsRaw,
            lineItemsRaw: normalized.lineItemsRaw,
            normalized: normalized.normalized,
            merchant: normalized.merchant,
            receiptDate: normalized.receiptDate,
            subtotal: normalized.subtotal,
            tax: normalized.tax,
            tip: normalized.tip,
            total: normalized.total,
            currency: normalized.currency,
            lineItems: normalized.lineItems,
            confidence: normalized.confidence,
            fieldConfidence: normalized.fieldConfidence,
            updatedAt: new Date().toISOString(),
          })
        ),
      {
        analysisId: analysis.id,
      }
    )
  } catch (error) {
    analysis = await saveAnalysis({
      ...analysis,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    })
    throw error
  }

  const draft = buildProvisionalReceiptDraft(workspaceId, analysis)
  activeTrace.mark("receipt.draft.provisional_ready", {
    receiptDraftId: draft.id,
    receiptAssetId: draft.receiptAssetId,
    receiptAnalysisId: draft.receiptAnalysisId ?? null,
    status: draft.status,
    analysisStatus: draft.analysisStatus ?? null,
    lineItemCount: draft.lineItems?.length ?? 0,
    committedExpenseId: draft.committedExpenseId ?? null,
  })

  return {
    analysis,
    draft,
  }
}

export async function finalizeReceiptDraftForAnalysis(
  workspaceId: string,
  uid: string,
  query: unknown
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const analysis = await getReceiptAnalysis(workspaceId, uid, query)
  const finalizedAnalysis =
    analysis.status === "analysis_complete_draft_pending"
      ? await saveAnalysis({
          ...analysis,
          status: "succeeded",
          updatedAt: new Date().toISOString(),
        })
      : analysis

  const draft = await upsertReceiptDraftFromAnalysis(
    workspaceId,
    uid,
    finalizedAnalysis.receiptAssetId,
    finalizedAnalysis
  )

  return {
    analysis: finalizedAnalysis,
    draft,
  }
}

export async function getReceiptAnalysis(
  workspaceId: string,
  uid: string,
  query: unknown
): Promise<ReceiptAnalysis> {
  await assertWorkspaceMembership(workspaceId, uid)

  const QuerySchema = z
    .object({
      analysisId: z.string().trim().min(1).optional(),
      receiptAssetId: z.string().trim().min(1).optional(),
    })
    .refine((value) => Boolean(value.analysisId || value.receiptAssetId), {
      message: "analysisId or receiptAssetId is required",
    })

  const parsed = QuerySchema.safeParse(query)
  if (!parsed.success) {
    throw new BadRequestError("Invalid receipt analysis query", parsed.error.format())
  }

  if (parsed.data.analysisId) {
    const snap = await db
      .doc(`workspaces/${workspaceId}/receiptAnalyses/${parsed.data.analysisId}`)
      .get()
    if (!snap.exists) {
      throw new NotFoundError("Receipt analysis not found")
    }
    return ReceiptAnalysisSchema.parse({
      id: snap.id,
      ...snap.data(),
    })
  }

  const snap = await db
    .collection(`workspaces/${workspaceId}/receiptAnalyses`)
    .where("receiptAssetId", "==", parsed.data.receiptAssetId)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get()

  if (snap.empty) {
    throw new NotFoundError("Receipt analysis not found")
  }

  const doc = snap.docs[0]
  return ReceiptAnalysisSchema.parse({
    id: doc.id,
    ...doc.data(),
  })
}
