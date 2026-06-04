import { z } from "zod"

import { db } from "../admin"
import {
  BadRequestError,
  NotFoundError,
} from "../lib/httpErrors"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import type { BackendProfileTrace } from "../lib/profileTrace"
import { withBackendProfileStep } from "../lib/profileTrace"
import {
  ReceiptAnalysisSchema,
  type ReceiptAnalysis,
} from "@shared/schemas/receiptAnalysis"
import {
  type ReceiptDraft,
  type ReceiptDraftInput,
} from "@shared/schemas/receiptDraft"

import { normalizeTextractExpense } from "../utils/normalizeTextractExpense"
import { analyzeReceiptBytesWithTextract, analyzeReceiptWithTextract } from "./textractService"
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
  imageBase64: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
})


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

// Builds the analysis record in memory and reserves a Firestore ID.
// No write happens here — the first and only write is after Textract completes,
// at which point status is set to "succeeded" or "failed" before saving.
// "analyzing" is never written to Firestore.
function buildAnalysisRecord(
  workspaceId: string,
  receiptAssetId: string
): ReceiptAnalysis {
  const nowIso = new Date().toISOString()
  const ref = db.collection(`workspaces/${workspaceId}/receiptAnalyses`).doc()
  return ReceiptAnalysisSchema.parse({
    id: ref.id,
    workspaceId,
    receiptAssetId,
    provider: "aws_textract",
    providerVersion: "analyze-expense-2018-06-27",
    status: "succeeded", // placeholder — overwritten to "succeeded" or "failed" before the first write
    lineItems: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  })
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
  const description = analysis.description?.trim() || null
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
    description,
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


export async function analyzeReceipt(
  workspaceId: string,
  uid: string,
  input: unknown,
  trace?: BackendProfileTrace,
  imageBytes?: Buffer
): Promise<{ analysis: ReceiptAnalysis; draft: ReceiptDraft }> {
  const activeTrace = trace ?? noopTrace
  await withBackendProfileStep(activeTrace, "receipt.analysis.membership_check", () =>
    assertWorkspaceMembership(workspaceId, uid)
  )

  const parsed = AnalyzeReceiptInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new BadRequestError("Invalid receipt analysis payload", parsed.error.format())
  }
  const receiptAssetId = parsed.data.receiptAssetId
  activeTrace.mark("receipt.analysis.payload_validated", {
    receiptAssetId,
    hasBytesInRequest: Boolean(imageBytes),
  })

  // Only fetch the asset from Firestore when we don't have bytes in the request.
  // When bytes are provided directly the GCS round-trip is skipped entirely.
  let assetForFallback: Awaited<ReturnType<typeof getReceiptAsset>> | null = null
  if (!imageBytes) {
    assetForFallback = await withBackendProfileStep(
      activeTrace,
      "receipt.asset.load",
      () => getReceiptAsset(workspaceId, uid, receiptAssetId),
      { receiptAssetId }
    )
    activeTrace.mark("receipt.asset.loaded", {
      receiptAssetId: assetForFallback.id,
      mimeType: assetForFallback.mimeType,
      sizeBytes: assetForFallback.sizeBytes,
      hasOriginalStoragePath: Boolean(
        assetForFallback.originalStoragePath ?? assetForFallback.storagePath
      ),
    })
  }

  // Reserve a Firestore ID but write nothing yet — first write is after Textract.
  let analysis = buildAnalysisRecord(workspaceId, receiptAssetId)
  activeTrace.mark("receipt.analysis.record_initialized", {
    analysisId: analysis.id,
    receiptAssetId,
  })

  try {
    const raw = imageBytes
      ? await withBackendProfileStep(
          activeTrace,
          "receipt.textract.request",
          () => analyzeReceiptBytesWithTextract(imageBytes, activeTrace),
          { receiptAssetId, analysisId: analysis.id, provider: "aws_textract", source: "request_bytes" }
        )
      : await withBackendProfileStep(
          activeTrace,
          "receipt.textract.request",
          () => analyzeReceiptWithTextract(assetForFallback!, activeTrace),
          { receiptAssetId, analysisId: analysis.id, provider: "aws_textract", source: "gcs_fetch" }
        )

    const normalized = await withBackendProfileStep(
      activeTrace,
      "receipt.analysis.normalize",
      async () => normalizeTextractExpense(raw),
      { analysisId: analysis.id }
    )
    activeTrace.mark("receipt.analysis.normalized", {
      analysisId: analysis.id,
      merchant: normalized.merchant ?? null,
      total: normalized.total ?? null,
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
            status: "succeeded",
            summaryFieldsRaw: normalized.summaryFieldsRaw,
            lineItemsRaw: normalized.lineItemsRaw,
            normalized: normalized.normalized,
            merchant: normalized.merchant,
            description: normalized.description,
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
      { analysisId: analysis.id }
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

  // Write the draft to Firestore immediately — the response is a real persisted draft.
  const draft = await withBackendProfileStep(
    activeTrace,
    "receipt.draft.upsert",
    () => upsertReceiptDraftFromAnalysis(workspaceId, uid, receiptAssetId, analysis),
    { analysisId: analysis.id, receiptAssetId }
  )
  activeTrace.mark("receipt.draft.persisted", {
    receiptDraftId: draft.id,
    receiptAssetId: draft.receiptAssetId,
    receiptAnalysisId: draft.receiptAnalysisId ?? null,
    status: draft.status,
    analysisStatus: draft.analysisStatus ?? null,
    lineItemCount: draft.lineItems?.length ?? 0,
  })

  return { analysis, draft }
}
