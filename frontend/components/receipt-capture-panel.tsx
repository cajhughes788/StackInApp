"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Camera, Check, ImagePlus, Info, ReceiptText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/helpers"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore"
import { recognizeReceiptText } from "@/lib/imports/ocr"
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace"
import { createReceiptAsset, updateReceiptAsset } from "@/lib/api/receiptAssetsApi"
import {
  analyzeReceipt as analyzeReceiptApi,
  finalizeReceiptAnalysis as finalizeReceiptAnalysisApi,
} from "@/lib/api/receiptAnalysisApi"
import { analyzeReceiptImageQuality } from "@/lib/receipts/imageQuality"
import { extractReceiptDraft } from "@/lib/receipts/receiptDraft"
import {
  loadReceiptImage,
  type DecodedReceiptImage,
} from "@/lib/receipts/imagePipeline"
import {
  getReceiptStorageDownloadUrl,
  prepareReceiptPreviewFile,
  prepareReceiptThumbnailFile,
  prepareReceiptUploadFile,
  uploadReceiptAssetToStorage,
} from "@/lib/receipts/receiptAssetStorage"
import { saveReceiptMediaFromFile } from "@/lib/storage/receiptAssetsCache"
import {
  captureReceiptImage,
  isNativeCameraAvailable,
} from "@/lib/native/camera"
import StackInLoaderWeb from "@/components/stackin-loader-web"
import * as expensesService from "@/lib/domain/expenseService"
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenseCategories"
import {
  findDuplicateExpense,
  getSuggestedExpenseCategoryForImport,
} from "@/lib/imports/reviewUtils"
import type {
  ReceiptDraft,
  ReceiptDraftAllocationMode,
  ReceiptDraftInput,
  ReceiptDraftPatch,
} from "@shared/schemas/receiptDraft"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"

function formatOccurredAt(value: string | null | undefined): string {
  if (!value) return "Missing date"
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function isStorageUploadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    message.includes("firebase storage") ||
    message.includes("storage bucket") ||
    message.includes("bucket exists") ||
    message.includes("preflight") ||
    message.includes("cors") ||
    message.includes("object-not-found") ||
    message.includes("404")
  )
}

function isProvisionalAnalysisDraft(item: ReceiptDraft): boolean {
  return item.analysisStatus === "analysis_complete_draft_pending"
}

function buildPatchFromLocalDraft(
  localDraft: ReceiptDraft,
  finalizedDraft: ReceiptDraft
): ReceiptDraftPatch {
  return {
    status: localDraft.status,
    occurredAt: localDraft.occurredAt,
    amount: localDraft.amount,
    subtotal: localDraft.subtotal,
    tax: localDraft.tax,
    tip: localDraft.tip,
    currency: localDraft.currency,
    description: localDraft.description,
    counterparty: localDraft.counterparty,
    parseWarnings: localDraft.parseWarnings,
    confidence: localDraft.confidence,
    suggestedExpenseAccount:
      localDraft.suggestedExpenseAccount ?? finalizedDraft.suggestedExpenseAccount,
    allocationMode: localDraft.allocationMode,
    completion: localDraft.completion,
    notes: localDraft.notes,
    lineItems: localDraft.lineItems,
    allocations: localDraft.allocations,
    fieldConfidence: localDraft.fieldConfidence,
    committedExpenseId: localDraft.committedExpenseId,
  }
}

function buildOptimisticReceiptDraft(
  workspaceId: string,
  receiptAsset: ReceiptAsset,
  mode: ReceiptDraftAllocationMode,
  category: string
): ReceiptDraft {
  const nowIso = new Date().toISOString()

  return applyDraftMode(
    {
      id: `pending:${receiptAsset.id}`,
      workspaceId,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
      status: "draft",
      occurredAt: null,
      amount: null,
      subtotal: null,
      tax: null,
      tip: null,
      currency: "USD",
      description: null,
      counterparty: null,
      parseWarnings: ["Analyzing receipt..."],
      confidence: null,
      suggestedExpenseAccount: category.trim() || null,
      allocationMode: mode,
      completion: {
        missingFields: ["merchant", "date", "amount"],
        readyToCommit: false,
      },
      notes: "",
      receiptAssetId: receiptAsset.id,
      analysisStatus: "queued",
      receiptAsset,
      lineItems: [],
      allocations: [],
      fieldConfidence: {},
    },
    mode,
    category
  )
}

function sumLineItems(
  lineItems: ReceiptDraft["lineItems"] | null | undefined
): number | null {
  if (!lineItems?.length) return null
  const amounts = lineItems
    .map((lineItem) => lineItem.amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (!amounts.length) return null
  return amounts.reduce((sum, value) => sum + value, 0)
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function reconcileLineItemsToTarget(
  lineItems: NonNullable<ReceiptDraft["lineItems"]>,
  targetAmount: number | null | undefined,
  defaultCategory: string
): NonNullable<ReceiptDraft["lineItems"]> {
  if (
    typeof targetAmount !== "number" ||
    !Number.isFinite(targetAmount) ||
    targetAmount <= 0 ||
    lineItems.length === 0
  ) {
    return lineItems
  }

  const currentTotal = sumLineItems(lineItems)
  if (currentTotal == null) return lineItems

  const delta = roundCurrency(targetAmount - currentTotal)
  if (Math.abs(delta) <= 0.009) {
    return lineItems
  }

  if (Math.abs(delta) <= 0.05) {
    const next = [...lineItems]
    const lastIndex = next.length - 1
    const lastAmount = typeof next[lastIndex]?.amount === "number" ? next[lastIndex].amount ?? 0 : 0
    next[lastIndex] = {
      ...next[lastIndex],
      amount: roundCurrency(lastAmount + delta),
      category: next[lastIndex]?.category ?? (defaultCategory.trim() || undefined),
    }
    return next
  }

  if (delta < 0) {
    const next = [...lineItems]
    const candidateIndex = next
      .map((lineItem, index) => ({ index, amount: lineItem.amount ?? 0 }))
      .sort((left, right) => right.amount - left.amount)[0]?.index

    if (typeof candidateIndex === "number") {
      const candidate = next[candidateIndex]
      const candidateAmount = candidate.amount ?? 0
      const adjustedAmount = roundCurrency(candidateAmount + delta)
      if (adjustedAmount > 0) {
        next[candidateIndex] = {
          ...candidate,
          amount: adjustedAmount,
          category: candidate.category ?? (defaultCategory.trim() || undefined),
        }
        return next
      }
    }

    return lineItems
  }

  return [
    ...lineItems,
    {
      description: "Unparsed receipt line",
      amount: delta,
      category: defaultCategory.trim() || undefined,
    },
  ]
}

function normalizeLineItemKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

type ReceiptCaptureStep = "mode" | "category" | "source"

function prepareMultiCategoryLineItems(
  lineItems: ReceiptDraft["lineItems"] | null | undefined,
  defaultCategory: string,
  targetAmount?: number | null
): NonNullable<ReceiptDraft["lineItems"]> {
  if (!lineItems?.length) return []

  const grouped = new Map<
    string,
    NonNullable<ReceiptDraft["lineItems"]>[number] & { repeatCount: number }
  >()

  for (const rawLineItem of lineItems) {
    const description = rawLineItem.description?.trim()
    const amount = rawLineItem.amount
    if (!description || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      continue
    }

    const key = normalizeLineItemKey(description)
    const existing = grouped.get(key)
    if (existing) {
      existing.amount = Number(((existing.amount ?? 0) + amount).toFixed(2))
      existing.repeatCount += 1
      existing.quantity =
        existing.repeatCount > 1
          ? existing.repeatCount
          : rawLineItem.quantity && rawLineItem.quantity > 1
            ? rawLineItem.quantity
            : undefined
      continue
    }

    grouped.set(key, {
      ...rawLineItem,
      description,
      amount: Number(amount.toFixed(2)),
      category: rawLineItem.category ?? (defaultCategory.trim() || undefined),
      quantity:
        rawLineItem.quantity && rawLineItem.quantity > 1 ? rawLineItem.quantity : undefined,
      repeatCount: 1,
    })
  }

  const normalizedLineItems = Array.from(grouped.values()).map(({ repeatCount, ...lineItem }) => ({
    ...lineItem,
    quantity:
      repeatCount > 1 ? repeatCount : lineItem.quantity && lineItem.quantity > 1
        ? lineItem.quantity
        : undefined,
  }))

  return reconcileLineItemsToTarget(normalizedLineItems, targetAmount, defaultCategory)
}

function buildAllocationsFromLineItems(
  lineItems: ReceiptDraft["lineItems"] | null | undefined,
  defaultCategory: string
): ReceiptDraft["allocations"] {
  if (!lineItems?.length) return []

  const grouped = new Map<string, { amount: number; lineItemIndexes: number[] }>()

  lineItems.forEach((lineItem, index) => {
    const amount = lineItem.amount
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return
    }

    const category = lineItem.category?.trim() || defaultCategory.trim()
    if (!category) return

    const existing = grouped.get(category) ?? { amount: 0, lineItemIndexes: [] }
    existing.amount += amount
    existing.lineItemIndexes.push(index)
    grouped.set(category, existing)
  })

  return Array.from(grouped.entries()).map(([category, value]) => ({
    category,
    amount: Number(value.amount.toFixed(2)),
    lineItemIndexes: value.lineItemIndexes,
  }))
}

function resolveAllocationMode(item: ReceiptDraft): ReceiptDraftAllocationMode {
  if (item.allocationMode) return item.allocationMode
  return item.lineItems?.length ? "multiple" : "single"
}

function applyDraftMode<T extends ReceiptDraftInput | ReceiptDraft>(
  draft: T,
  mode: ReceiptDraftAllocationMode,
  selectedCategory: string
): T {
  const category = selectedCategory.trim()
  const nextLineItems =
    mode === "multiple"
      ? prepareMultiCategoryLineItems(
          draft.lineItems,
          category,
          draft.subtotal ?? draft.amount ?? null
        )
      : []

  return {
    ...draft,
    allocationMode: mode,
    suggestedExpenseAccount: category || draft.suggestedExpenseAccount || null,
    lineItems: nextLineItems,
    allocations:
      mode === "multiple"
        ? buildAllocationsFromLineItems(nextLineItems, category)
        : [],
  } as T
}

function mergeReceiptDraftPatch(
  current: ReceiptDraftPatch | undefined,
  incoming: ReceiptDraftPatch
): ReceiptDraftPatch {
  if (!current) return incoming

  return {
    ...current,
    ...incoming,
    completion:
      current.completion || incoming.completion
        ? {
            ...current.completion,
            ...incoming.completion,
          }
        : undefined,
  }
}

function buildModePatch(
  draft: ReceiptDraft,
  mode: ReceiptDraftAllocationMode,
  category: string
): ReceiptDraftPatch {
  const normalizedCategory = category.trim() || null
  const nextLineItems =
    mode === "multiple"
      ? prepareMultiCategoryLineItems(
          draft.lineItems,
          normalizedCategory ?? "",
          draft.subtotal ?? draft.amount ?? null
        )
      : []

  return {
    allocationMode: mode,
    suggestedExpenseAccount: normalizedCategory,
    lineItems: nextLineItems,
    allocations:
      mode === "multiple"
        ? buildAllocationsFromLineItems(nextLineItems, normalizedCategory ?? "")
        : [],
  }
}

export default function ReceiptCapturePanel() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const receiptDraftsEntry = useReceiptDraftsStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const expenses = useExpensesStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId]?.expenses ?? [] : []
  )
  const createDraft = useReceiptDraftsStore((state) => state.createDraft)
  const refreshDrafts = useReceiptDraftsStore((state) => state.refreshDrafts)
  const updateDraft = useReceiptDraftsStore((state) => state.updateDraft)
  const patchDraftLocally = useReceiptDraftsStore((state) => state.patchDraftLocally)
  const removeDraftsForReceiptAsset = useReceiptDraftsStore(
    (state) => state.removeDraftsForReceiptAsset
  )
  const hydrateExpenseMemoryStore = useExpenseMemoryStore(
    (state) => state.hydrateFromStorageOnce
  )
  const updateExpenseMemory = useExpenseMemoryStore(
    (state) => state.updateFromExpense
  )
  const getAccountForVendor = useExpenseMemoryStore(
    (state) => state.getAccountForVendor
  )

  const [uploading, setUploading] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<string | null>(null)
  const [workingItemId, setWorkingItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isNativeCamera, setIsNativeCamera] = useState(false)
  const [captureMode, setCaptureMode] =
    useState<ReceiptDraftAllocationMode | "">("")
  const [captureCategory, setCaptureCategory] = useState<string>("")
  const [captureStep, setCaptureStep] = useState<ReceiptCaptureStep>("mode")
  const [expenseCategoriesByItemId, setExpenseCategoriesByItemId] = useState<
    Record<string, string>
  >({})
  const [expanded, setExpanded] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const draftSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const draftSyncQueueRef = useRef<Record<string, ReceiptDraftPatch>>({})

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    void refreshDrafts(activeWorkspaceId)
  }, [activeWorkspaceId, activeWorkspace?.type, refreshDrafts])

  useEffect(() => {
    hydrateExpenseMemoryStore()
  }, [hydrateExpenseMemoryStore])

  useEffect(() => {
    setIsNativeCamera(isNativeCameraAvailable())
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(draftSyncTimersRef.current)) {
        clearTimeout(timer)
      }
      draftSyncTimersRef.current = {}
      draftSyncQueueRef.current = {}
    }
  }, [])

  const receiptDrafts = receiptDraftsEntry?.drafts ?? []

  const pendingReceiptItems = receiptDrafts.filter(
    (item) => item.status === "draft" || item.status === "ready_to_review"
  )

  useEffect(() => {
    if (pendingReceiptItems.length === 0) {
      setAnalysisOpen(false)
    }
  }, [pendingReceiptItems.length])

  useEffect(() => {
    if (!expanded || uploading) return
    if (!captureMode) {
      setCaptureStep("mode")
      return
    }
    if (!captureCategory.trim()) {
      setCaptureStep("category")
      return
    }
    setCaptureStep("source")
  }, [expanded, uploading, captureMode, captureCategory])

  async function processReceiptFile(
    file: File,
    captureSource: "camera" | "gallery" | "upload" = "upload"
  ) {
    if (!file || !activeWorkspaceId) return
    if (!captureMode) {
      setError("Choose how you want to save this receipt before uploading.")
      return
    }
    if (!captureCategory.trim()) {
      setError("Choose an expense category before uploading a receipt.")
      return
    }

    setUploading(true)
    setError(null)
    setMessage(null)
    const trace = createProfileTrace("receipt_capture", {
      workspaceId: activeWorkspaceId,
      fileName: file.name,
      captureSource,
    })
    let decodedReceiptImage: DecodedReceiptImage | null = null
    let optimisticReceiptAssetId: string | null = null
    const profile = (step: string, metadata: Record<string, string | number | boolean | null | undefined> = {}) => ({
      traceId: trace.traceId,
      flow: trace.flow,
      step,
      metadata: {
        workspaceId: activeWorkspaceId,
        fileName: file.name,
        captureSource,
        ...metadata,
      },
    })

    try {
      trace.mark("receipt.capture.begin", {
        sizeBytes: file.size,
        mimeType: file.type || "unknown",
      })
      trace.mark("receipt.image_selected", {
        sizeBytes: file.size,
        mimeType: file.type || "unknown",
      })
      decodedReceiptImage = await withProfileStep(
        trace,
        "receipt.image_decode",
        () => loadReceiptImage(file),
        {}
      )
      const quality = await withProfileStep(
        trace,
        "receipt.quality_check",
        () => analyzeReceiptImageQuality(file, decodedReceiptImage ?? undefined),
        { sizeBytes: file.size }
      )

      if (quality.qualityStatus === "bad") {
        trace.mark("receipt.quality_blocked", {
          blurScore: Number(quality.blurScore.toFixed(3)),
          glareScore: Number(quality.glareScore.toFixed(3)),
        })
        throw new Error(
          quality.warnings[0] ||
            "This receipt image is too hard to read. Please retake the photo before continuing."
        )
      }

      setOcrStatus("Uploading receipt image...")
      const originalUploadFile = await withProfileStep(
        trace,
        "receipt.upload_prepare",
        () => prepareReceiptUploadFile(file, decodedReceiptImage ?? undefined),
        {
          originalSizeBytes: file.size,
        }
      )
      trace.mark("receipt.upload_file_ready", {
        originalSizeBytes: file.size,
        originalUploadSizeBytes: originalUploadFile.size,
        uploadMimeType: originalUploadFile.type || "image/jpeg",
      })
      const receiptAsset = await withProfileStep(
        trace,
        "receipt.asset_create",
        () =>
          createReceiptAsset(activeWorkspaceId, {
            fileName: file.name,
            mimeType: originalUploadFile.type || "image/jpeg",
            sizeBytes: originalUploadFile.size,
            captureSource,
            quality: quality.quality,
            blurScore: quality.blurScore,
            glareScore: quality.glareScore,
            qualityStatus: quality.qualityStatus,
            qualityWarnings: quality.warnings,
          }, profile("receipt.asset_create.network_request")),
        {}
      )
      trace.mark("receipt.asset_created", {
        receiptAssetId: receiptAsset.id,
        originalStoragePath:
          receiptAsset.originalStoragePath ?? receiptAsset.storagePath ?? null,
        previewStoragePath: receiptAsset.previewStoragePath ?? null,
        thumbnailStoragePath: receiptAsset.thumbnailStoragePath ?? null,
      })
      const optimisticDraft = buildOptimisticReceiptDraft(
        activeWorkspaceId,
        receiptAsset,
        captureMode,
        captureCategory
      )
      useReceiptDraftsStore.getState().applyDraft(activeWorkspaceId, optimisticDraft)
      optimisticReceiptAssetId = receiptAsset.id
      let storedReceiptAsset = receiptAsset
      let storageReady = false

      try {
        const originalUpload = await withProfileStep(
          trace,
          "receipt.upload_original",
          () =>
            uploadReceiptAssetToStorage(
              originalUploadFile,
              receiptAsset.originalStoragePath ?? receiptAsset.storagePath ?? "",
              { resolveDownloadUrl: false }
            ),
          {
            receiptAssetId: receiptAsset.id,
            originalStoragePath:
              receiptAsset.originalStoragePath ?? receiptAsset.storagePath ?? null,
            originalUploadSizeBytes: originalUploadFile.size,
          }
        )
        trace.mark("receipt.original_upload_complete", {
          receiptAssetId: receiptAsset.id,
          originalStoragePath: originalUpload.storagePath,
        })
        storedReceiptAsset = {
          ...receiptAsset,
          originalStoragePath: originalUpload.storagePath,
          storagePath: originalUpload.storagePath,
          sizeBytes: originalUploadFile.size,
        }
        storageReady = true
        patchDraftLocally(activeWorkspaceId, `pending:${receiptAsset.id}`, {
          analysisStatus: "analyzing",
          receiptAsset: storedReceiptAsset,
          parseWarnings: ["Analyzing receipt..."],
        })

        const backgroundTrace = trace.child("receipt.media_background", {
          receiptAssetId: receiptAsset.id,
        })
        const backgroundDecodedReceiptImage = decodedReceiptImage
        decodedReceiptImage = null
        void (async (
          workspaceId: string,
          sourceFile: File,
          originalAsset: ReceiptAsset
        ) => {
          try {
            const [originalDownloadUrl, previewFile, thumbnailFile] = await Promise.all([
              getReceiptStorageDownloadUrl(
                originalAsset.originalStoragePath ?? originalAsset.storagePath ?? ""
              ),
              withProfileStep(
                backgroundTrace,
                "receipt.preview_prepare",
                () => prepareReceiptPreviewFile(sourceFile, backgroundDecodedReceiptImage ?? undefined),
                {}
              ),
              withProfileStep(
                backgroundTrace,
                "receipt.thumbnail_prepare",
                () => prepareReceiptThumbnailFile(sourceFile, backgroundDecodedReceiptImage ?? undefined),
                {}
              ),
            ])

            const derivedUploadResults = await withProfileStep(
              backgroundTrace,
              "receipt.upload_derived",
              async () => {
                const [preview, thumbnail] = await Promise.allSettled([
                  uploadReceiptAssetToStorage(
                    previewFile,
                    originalAsset.previewStoragePath ?? ""
                  ),
                  uploadReceiptAssetToStorage(
                    thumbnailFile,
                    originalAsset.thumbnailStoragePath ?? ""
                  ),
                ])

                return {
                  preview,
                  thumbnail,
                }
              },
              {
                receiptAssetId: originalAsset.id,
                previewStoragePath: originalAsset.previewStoragePath ?? null,
                thumbnailStoragePath: originalAsset.thumbnailStoragePath ?? null,
                previewUploadSizeBytes: previewFile.size,
                thumbnailUploadSizeBytes: thumbnailFile.size,
              }
            )

            const previewUpload =
              derivedUploadResults.preview.status === "fulfilled"
                ? derivedUploadResults.preview.value
                : null
            const thumbnailUpload =
              derivedUploadResults.thumbnail.status === "fulfilled"
                ? derivedUploadResults.thumbnail.value
                : null
            const failedDerivedVariants = [
              ...(previewUpload ? [] : ["preview"]),
              ...(thumbnailUpload ? [] : ["thumbnail"]),
            ]

            if (failedDerivedVariants.length > 0) {
              backgroundTrace.mark("receipt.derived_upload_partial_failure", {
                receiptAssetId: originalAsset.id,
                failedVariants: failedDerivedVariants.join(","),
              })

              for (const result of [
                { variant: "preview", outcome: derivedUploadResults.preview },
                { variant: "thumbnail", outcome: derivedUploadResults.thumbnail },
              ] as const) {
                if (result.outcome.status === "rejected") {
                  backgroundTrace.error("receipt.derived_upload_failed", result.outcome.reason, {
                    receiptAssetId: originalAsset.id,
                    variant: result.variant,
                  })
                }
              }
            }

            const finalizedAsset = await withProfileStep(
              backgroundTrace,
              "receipt.asset_update",
              () =>
                updateReceiptAsset(workspaceId, originalAsset.id, {
                  originalStoragePath:
                    originalAsset.originalStoragePath ?? originalAsset.storagePath,
                  storagePath: originalAsset.storagePath,
                  originalDownloadUrl,
                  downloadUrl: originalDownloadUrl,
                  previewStoragePath: previewUpload?.storagePath,
                  thumbnailStoragePath: thumbnailUpload?.storagePath,
                  previewDownloadUrl: previewUpload?.downloadUrl ?? undefined,
                  thumbnailDownloadUrl: thumbnailUpload?.downloadUrl ?? undefined,
                  sizeBytes: originalAsset.sizeBytes,
                }, profile("receipt.asset_update.network_request", {
                  receiptAssetId: originalAsset.id,
                  source: "background",
                })),
              {
                receiptAssetId: originalAsset.id,
              }
            )

            await withProfileStep(
              backgroundTrace,
              "receipt.cache_write",
              async () => {
                const version = finalizedAsset.version ?? originalAsset.version ?? 1
                const cacheWrites: Promise<unknown>[] = []

                if (previewUpload) {
                  cacheWrites.push(
                    saveReceiptMediaFromFile(
                      workspaceId,
                      finalizedAsset.id,
                      "preview",
                      version,
                      previewFile
                    )
                  )
                }

                if (thumbnailUpload) {
                  cacheWrites.push(
                    saveReceiptMediaFromFile(
                      workspaceId,
                      finalizedAsset.id,
                      "thumbnail",
                      version,
                      thumbnailFile
                    )
                  )
                }

                await Promise.all(cacheWrites)
              },
              {
                receiptAssetId: finalizedAsset.id,
                version: finalizedAsset.version ?? originalAsset.version ?? 1,
              }
            )

            backgroundTrace.mark("receipt.cache_ready", {
              receiptAssetId: finalizedAsset.id,
              version: finalizedAsset.version ?? originalAsset.version ?? 1,
            })
          } catch (backgroundError) {
            backgroundTrace.error("receipt.media_background_failed", backgroundError, {
              receiptAssetId: originalAsset.id,
            })
          } finally {
            backgroundDecodedReceiptImage?.close()
          }
        })(activeWorkspaceId, file, storedReceiptAsset)
      } catch (uploadError) {
        trace.error("receipt.upload_failed", uploadError, {
          receiptAssetId: receiptAsset.id,
        })

        if (!isStorageUploadError(uploadError)) {
          throw uploadError
        }
      }

      try {
        if (!storageReady) {
          throw new Error("Receipt upload unavailable")
        }

        setOcrStatus("Analyzing receipt...")
        const analyzed = await withProfileStep(
          trace,
          "receipt.analysis_request",
          () =>
            analyzeReceiptApi(
              activeWorkspaceId,
              storedReceiptAsset.id,
              profile("receipt.analysis_request.network_request", {
                receiptAssetId: storedReceiptAsset.id,
              })
            ),
          {
            receiptAssetId: storedReceiptAsset.id,
          }
        )
        const provisionalDraft: ReceiptDraft = {
          ...analyzed.draft,
          receiptAsset: storedReceiptAsset,
        }
        const modePatch = buildModePatch(provisionalDraft, captureMode, captureCategory)
        useReceiptDraftsStore.getState().applyDraft(activeWorkspaceId, provisionalDraft)
        patchDraftLocally(activeWorkspaceId, provisionalDraft.id, modePatch)
        void finalizeReceiptAnalysisApi(
          activeWorkspaceId,
          { analysisId: analyzed.analysis.id },
          profile("receipt.analysis_finalize.network_request", {
            analysisId: analyzed.analysis.id,
            receiptAssetId: storedReceiptAsset.id,
          })
        )
          .then(async (finalized) => {
            const currentLocalDraft = useReceiptDraftsStore
              .getState()
              .byWorkspaceId[activeWorkspaceId]
              ?.drafts.find(
                (candidate) => candidate.receiptAssetId === storedReceiptAsset.id
              )
            const finalizedDraft: ReceiptDraft = {
              ...finalized.draft,
              receiptAsset: storedReceiptAsset,
            }
            const patchToPersist = currentLocalDraft
              ? buildPatchFromLocalDraft(currentLocalDraft, finalizedDraft)
              : modePatch
            useReceiptDraftsStore.getState().applyDraft(activeWorkspaceId, finalizedDraft)
            if (Object.keys(patchToPersist).length > 0) {
              patchDraftLocally(activeWorkspaceId, finalizedDraft.id, patchToPersist)
              await updateDraft(activeWorkspaceId, finalizedDraft.id, patchToPersist)
            }
          })
          .catch((finalizeError) => {
            setError(
              finalizeError instanceof Error
                ? finalizeError.message
                : "Receipt analysis is ready, but finishing the draft save failed."
            )
          })
        setExpanded(false)
        setAnalysisOpen(true)
        setMessage(null)
        trace.mark("receipt.draft_loaded", {
          qualityStatus: quality.qualityStatus,
          analysisStatus: analyzed.analysis.status,
          receiptAssetId: storedReceiptAsset.id,
          draftId: analyzed.draft.id,
        })
      } catch (analysisError) {
        trace.error("receipt.analysis_failed", analysisError, {
          receiptAssetId: storedReceiptAsset.id,
          storageReady,
        })

        let resolvedOcrText = ""

        if (!resolvedOcrText) {
          setOcrStatus(
            storageReady
              ? "Receipt analysis unavailable. Reading receipt text locally..."
              : "Cloud receipt upload unavailable. Reading receipt text locally..."
          )
          resolvedOcrText = await withProfileStep(
            trace,
            "receipt.ocr",
            () =>
              recognizeReceiptText(file, ({ status, progress }) => {
                const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))
                setOcrStatus(`${status} (${percent}%)`)
              }),
            {}
          )
        } else {
          setOcrStatus(
            storageReady
              ? "Receipt analysis unavailable. Using pasted OCR text."
              : "Cloud receipt upload unavailable. Using pasted OCR text."
          )
        }

        const draftPayload = await withProfileStep(
          trace,
          "receipt.draft_prepare",
          async () => {
            const extracted = extractReceiptDraft(resolvedOcrText, file.name)
            const nextDraft: ReceiptDraftInput = {
              status: extracted.missingFields.length === 0 ? "ready_to_review" : "draft",
              occurredAt: extracted.occurredAt,
              amount: extracted.amount,
              currency: "USD",
              description: extracted.description,
              counterparty: extracted.merchant,
              parseWarnings:
                resolvedOcrText.trim().length === 0 ? ["No OCR text provided yet"] : [],
              confidence: resolvedOcrText.trim().length > 0 ? 0.75 : 0.35,
              suggestedExpenseAccount: extracted.suggestedExpenseAccount,
              completion: {
                missingFields: extracted.missingFields,
                readyToCommit: extracted.missingFields.length === 0,
              },
              notes: "",
              receiptAssetId: storedReceiptAsset.id,
              receiptAnalysisId: undefined,
              analysisStatus: storageReady ? "failed" : undefined,
              lineItems: [],
              allocations: [],
              fieldConfidence:
                resolvedOcrText.trim().length > 0 ? { total: 0.75, merchant: 0.7 } : {},
              receiptAsset: storedReceiptAsset,
            }
            return applyDraftMode(nextDraft, captureMode, captureCategory)
          },
          {}
        )
        trace.mark("receipt.draft_prepared", {
          receiptAssetId: storedReceiptAsset.id,
        })
        await withProfileStep(
          trace,
          "receipt.draft_create",
          () =>
            createDraft(
              activeWorkspaceId,
              draftPayload,
            ),
          {
            qualityStatus: quality.qualityStatus,
            storageReady,
          }
        )
        setExpanded(false)
        setAnalysisOpen(true)
        setMessage(
          storageReady
            ? "Receipt draft created with local OCR fallback. Review the extracted fields below before saving."
            : "Receipt draft created with local OCR because Firebase Storage upload is unavailable. Review the extracted fields below before saving."
        )
        trace.mark("receipt.capture.complete", {
          mode: storageReady ? "fallback_ocr" : "fallback_ocr_storage_unavailable",
          receiptAssetId: storedReceiptAsset.id,
        })
      }
    } catch (err) {
      if (err instanceof Error && /canceled/i.test(err.message)) {
        trace.mark("receipt.capture.canceled")
        if (optimisticReceiptAssetId) {
          removeDraftsForReceiptAsset(activeWorkspaceId, optimisticReceiptAssetId)
        }
        return
      }

      trace.error("receipt.capture_failed", err)
      if (optimisticReceiptAssetId) {
        removeDraftsForReceiptAsset(activeWorkspaceId, optimisticReceiptAssetId)
      }

      setError(
        err instanceof Error ? err.message : "Unable to create receipt draft."
      )
    } finally {
      trace.mark("receipt.capture.finally", {
        uploading: false,
      })
      decodedReceiptImage?.close()
      decodedReceiptImage = null
      setOcrStatus(null)
      setUploading(false)
    }
  }

  async function handleReceiptUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]
    if (!file) return

    await processReceiptFile(file, "upload")
    event.target.value = ""
  }

  async function handleNativeCapture(source: "camera" | "photos") {
    if (!activeWorkspaceId) return

    try {
      const file = await captureReceiptImage(source)
      if (!file) return
      await processReceiptFile(file, source === "camera" ? "camera" : "gallery")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to open receipt capture."
      )
    }
  }

  async function commitReceiptExpense(item: ReceiptDraft) {
    if (!activeWorkspaceId) return

    const category =
      expenseCategoriesByItemId[item.id] || item.suggestedExpenseAccount || ""
    if (!category) {
      setError("Choose an expense category before saving this receipt.")
      return
    }

    const occurredAt = item.occurredAt
    const amount = Number(item.amount ?? 0)
    if (!occurredAt || !Number.isFinite(amount) || amount <= 0) {
      setError("This receipt still needs a valid date and amount.")
      return
    }

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    try {
      const allocationMode = resolveAllocationMode(item)
      const allocations =
        allocationMode === "multiple"
          ? buildAllocationsFromLineItems(item.lineItems, category)
          : []
      const missingFields = [
        ...(occurredAt ? [] : ["date"]),
        ...(amount > 0 ? [] : ["amount"]),
        ...(item.counterparty || item.description ? [] : ["merchant"]),
        ...(category ? [] : ["expenseCategory"]),
      ]

      patchDraftLocally(activeWorkspaceId, item.id, {
        status: "committed",
        suggestedExpenseAccount: category,
        allocationMode,
        allocations,
        completion: {
          missingFields,
          readyToCommit: missingFields.length === 0,
        },
      })

      if (pendingReceiptItems.length <= 1) {
        setAnalysisOpen(false)
      }
      setExpanded(false)

      const expense = await expensesService.createExpense(activeWorkspaceId, {
        date: occurredAt,
        amount,
        vendor: item.counterparty || item.description || "Receipt expense",
        description: item.description || item.counterparty || "Receipt expense",
        account: category,
        periodId: occurredAt.slice(0, 7),
        clientMutationId: `receipt-draft:${item.id}`,
        receiptAssetId: item.receiptAssetId,
        receiptAnalysisId: item.receiptAnalysisId,
        allocations,
        calculationMethod: "manual",
      })

      patchDraftLocally(activeWorkspaceId, item.id, {
        status: "committed",
        suggestedExpenseAccount: category,
        allocationMode,
        allocations,
        completion: {
          missingFields,
          readyToCommit: missingFields.length === 0,
        },
        committedExpenseId: expense.id,
      })

      updateExpenseMemory({
        vendor: item.counterparty || item.description || "",
        description: item.description || item.counterparty || "",
        account: category,
      })

      setMessage("Receipt saved as a business expense.")
      setExpanded(false)
      if (!isProvisionalAnalysisDraft(item)) {
        void updateDraft(activeWorkspaceId, item.id, {
          status: "committed",
          suggestedExpenseAccount: category,
          allocationMode,
          allocations,
          completion: {
            missingFields,
            readyToCommit: missingFields.length === 0,
          },
          committedExpenseId: expense.id,
        }).catch(async (err) => {
          await refreshDrafts(activeWorkspaceId)
          setError(
            err instanceof Error ? err.message : "Failed to save receipt expense."
          )
        })
      }
    } catch (err) {
      await refreshDrafts(activeWorkspaceId)
      setError(
        err instanceof Error ? err.message : "Failed to save receipt expense."
      )
    } finally {
      setWorkingItemId(null)
    }
  }

  async function dismissReceiptDraft(item: ReceiptDraft) {
    if (!activeWorkspaceId) return

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    patchDraftLocally(activeWorkspaceId, item.id, {
      status: "dismissed",
    })

    if (pendingReceiptItems.length <= 1) {
      setAnalysisOpen(false)
    }
    setExpanded(false)

    if (isProvisionalAnalysisDraft(item)) {
      setWorkingItemId(null)
      setMessage("Receipt draft cleared.")
      return
    }

    try {
      await updateDraft(activeWorkspaceId, item.id, {
        status: "dismissed",
      })
      setMessage("Receipt draft cleared.")
    } catch (err) {
      await refreshDrafts(activeWorkspaceId)
      setError(
        err instanceof Error ? err.message : "Failed to clear receipt draft."
      )
    } finally {
      setWorkingItemId(null)
    }
  }

  function persistReceiptItemPatch(
    item: ReceiptDraft,
    patch: ReceiptDraftPatch
  ) {
    if (!activeWorkspaceId) return

    setError(null)
    patchDraftLocally(activeWorkspaceId, item.id, patch)

    if (isProvisionalAnalysisDraft(item)) {
      return
    }

    const queueKey = `${activeWorkspaceId}:${item.id}`
    draftSyncQueueRef.current[queueKey] = mergeReceiptDraftPatch(
      draftSyncQueueRef.current[queueKey],
      patch
    )

    const existingTimer = draftSyncTimersRef.current[queueKey]
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    draftSyncTimersRef.current[queueKey] = setTimeout(() => {
      const patchToPersist = draftSyncQueueRef.current[queueKey]
      delete draftSyncQueueRef.current[queueKey]
      delete draftSyncTimersRef.current[queueKey]

      if (!patchToPersist) return

      void updateDraft(activeWorkspaceId, item.id, patchToPersist).catch(
        async (err) => {
          await refreshDrafts(activeWorkspaceId)
          setError(
            err instanceof Error ? err.message : "Failed to update receipt draft."
          )
        }
      )
    }, 350)
  }

  async function updateReceiptLineItem(
    item: ReceiptDraft,
    lineItemIndex: number,
    patch: Partial<NonNullable<ReceiptDraft["lineItems"]>[number]>
  ) {
    if (!activeWorkspaceId) return
    const nextLineItems = (item.lineItems ?? []).map((lineItem, index) =>
      index === lineItemIndex ? { ...lineItem, ...patch } : lineItem
    )
    const nextLineItemsTotal = sumLineItems(nextLineItems)
    const receiptTotal = Number(item.amount ?? 0)
    if (
      nextLineItemsTotal != null &&
      Number.isFinite(receiptTotal) &&
      receiptTotal > 0 &&
      nextLineItemsTotal - receiptTotal > 0.009
    ) {
      setError("Line item amounts cannot exceed the receipt total.")
      return
    }
    const defaultCategory =
      expenseCategoriesByItemId[item.id] ||
      getSuggestedExpenseCategoryForImport(item, getAccountForVendor) ||
      item.suggestedExpenseAccount ||
      ""
    persistReceiptItemPatch(item, {
      lineItems: nextLineItems,
      allocations: buildAllocationsFromLineItems(nextLineItems, defaultCategory),
    })
  }

  if (activeWorkspace?.type !== "independent" || !activeWorkspaceId) {
    return null
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border px-5 py-4 transition-colors ${
        uploading
          ? "border-black bg-black text-white"
          : "border-border/80 bg-background"
      }`}
    >
      <button
        type="button"
        className={`text-left text-base font-semibold transition ${
          uploading
            ? "text-emerald-300 hover:text-emerald-200"
            : "text-emerald-600 hover:text-emerald-500 dark:text-emerald-300 dark:hover:text-emerald-200"
        }`}
        onClick={() => {
          setExpanded((current) => !current)
          setError(null)
          setMessage(null)
        }}
      >
        Receipt Capture
      </button>
      {expanded ? (
        <div className="mt-4">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleReceiptUpload}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReceiptUpload}
          />
            <div className="mx-auto max-w-xl px-1 py-1">
            {!uploading ? (
              <div className="space-y-2">
                <p className="text-xl font-semibold text-foreground">
                  {captureStep === "mode"
                    ? "How should we save this receipt?"
                    : captureStep === "category"
                      ? "What default category should we start with?"
                      : "Add a receipt image"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {captureStep === "mode"
                    ? "Choose whether this receipt should land in one category or be split across several."
                    : captureStep === "category"
                      ? "Pick the category we should apply first. You can still adjust details after analysis."
                      : "Use the camera or upload an image from your library to begin receipt analysis."}
                </p>
              </div>
            ) : null}

            {!uploading && (captureMode || captureCategory.trim()) ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {captureMode ? (
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 transition hover:bg-accent"
                    onClick={() => setCaptureStep("mode")}
                  >
                    Mode: {captureMode === "single" ? "One category" : "Multiple categories"}
                  </button>
                ) : null}
                {captureCategory.trim() ? (
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 transition hover:bg-accent"
                    onClick={() => setCaptureStep("category")}
                  >
                    Category: {captureCategory}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6">
              {uploading ? (
                <div className="py-4">
                  <StackInLoaderWeb
                    label={ocrStatus ?? "Analyzing receipt..."}
                    showLabel
                    size={210}
                    cardBackground="transparent"
                    textColor="#486b18"
                  />
                </div>
              ) : captureStep === "mode" ? (
                <div className="space-y-3">
                  <Select
                    value={captureMode}
                    onValueChange={(value) => {
                      setCaptureMode(value as ReceiptDraftAllocationMode)
                      setCaptureStep("category")
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select receipt mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Save to one category</SelectItem>
                      <SelectItem value="multiple">Split across multiple categories</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {captureMode === "single"
                      ? "Recommended for most receipts. We’ll save the full amount into one business expense category."
                      : captureMode === "multiple"
                        ? "Use this when one receipt contains items that belong in different expense categories."
                        : "Choose the structure first and we’ll guide the rest of the flow."}
                  </p>
                </div>
              ) : captureStep === "category" ? (
                <div className="space-y-3">
                  <Select
                    value={captureCategory}
                    onValueChange={(value) => {
                      setCaptureCategory(value)
                      setCaptureStep("source")
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose expense category" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-start">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setCaptureStep("mode")}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() =>
                        isNativeCamera
                          ? void handleNativeCapture("camera")
                          : cameraInputRef.current?.click()
                      }
                    >
                      <Camera className="h-4 w-4" />
                      Take Photo
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        isNativeCamera
                          ? void handleNativeCapture("photos")
                          : libraryInputRef.current?.click()
                      }
                    >
                      <ImagePlus className="h-4 w-4" />
                      Choose Image
                    </Button>
                  </div>
                  <div className="flex justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setCaptureStep("category")}
                    >
                      Back
                    </Button>
                    {pendingReceiptItems.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setExpanded(false)
                          setAnalysisOpen(true)
                        }}
                      >
                        {pendingReceiptItems.length === 1
                          ? "Review 1 pending draft"
                          : `Review ${pendingReceiptItems.length} pending drafts`}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
            {!uploading && pendingReceiptItems.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No receipt drafts yet. Start with the receipt mode and we’ll guide the rest.
              </p>
            ) : null}
            {!uploading && ocrStatus ? (
              <p className="mt-4 text-sm text-muted-foreground">{ocrStatus}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog open={analysisOpen && pendingReceiptItems.length > 0} onOpenChange={setAnalysisOpen}>
        <DialogContent className="!inset-0 !left-0 !top-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-hidden rounded-none border-0 p-0 data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 sm:!max-w-none">
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="border-b px-6 py-4">
              <p className="text-lg font-semibold text-foreground">Receipt Analysis</p>
              <p className="text-sm text-muted-foreground">
                Confirm the analyzed fields below before saving.
              </p>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-4">
              {pendingReceiptItems.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No receipt drafts are waiting for review.
                </div>
              ) : (
                <div className="space-y-4">
            {pendingReceiptItems.map((item) => {
              const allocationMode = resolveAllocationMode(item)
              const isMultiCategory = allocationMode === "multiple"
              const isProvisional = isProvisionalAnalysisDraft(item)
              const duplicateExpense = findDuplicateExpense(item, expenses)
              const lineItemsTotal = sumLineItems(item.lineItems)
              const selectedCategory =
                expenseCategoriesByItemId[item.id] ||
                getSuggestedExpenseCategoryForImport(item, getAccountForVendor) ||
                item.suggestedExpenseAccount ||
                ""
              const liveAllocations =
                isMultiCategory && item.lineItems?.length
                  ? buildAllocationsFromLineItems(item.lineItems, selectedCategory)
                  : item.allocations ?? []
              return (
                <div key={item.id} className="overflow-hidden rounded-xl border p-4">
                  {duplicateExpense ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <Badge variant="outline">Possible duplicate</Badge>
                      <span>A matching expense already exists for this date and amount.</span>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {item.counterparty || item.description || "Receipt draft"}
                        </p>
                        <Badge variant="outline">receipt</Badge>
                        {item.analysisStatus ? (
                          <Badge variant="secondary">{item.analysisStatus}</Badge>
                        ) : null}
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Merchant
                          </p>
                          <Input
                            value={item.counterparty || item.description || ""}
                            onChange={(event) =>
                              persistReceiptItemPatch(item, {
                                counterparty: event.target.value,
                                description: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Total
                          </p>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.amount ?? ""}
                            onChange={(event) =>
                              persistReceiptItemPatch(item, {
                                amount:
                                  event.target.value.trim() === ""
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Date
                          </p>
                          <Input
                            type="date"
                            value={item.occurredAt ?? ""}
                            onChange={(event) =>
                              persistReceiptItemPatch(item, {
                                occurredAt: event.target.value || null,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Category
                          </p>
                          <Select
                            value={selectedCategory}
                            onValueChange={(value) =>
                              setExpenseCategoriesByItemId((current) => ({
                                ...current,
                                [item.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose expense category" />
                            </SelectTrigger>
                            <SelectContent>
                              {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isMultiCategory ? (
                            <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
                              <Info className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>
                                General category default. You can edit line-by-line categories below.
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isMultiCategory && item.lineItems?.length ? (
                        <div className="space-y-3 rounded-xl border border-dashed p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">Analyzed Line Items</p>
                              <p className="text-xs text-muted-foreground">
                                Edit descriptions, amounts, or category before saving.
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {lineItemsTotal != null ? (
                                <Badge variant="outline">
                                  Items total {formatCurrency(lineItemsTotal)}
                                </Badge>
                              ) : null}
                              {lineItemsTotal != null &&
                              Math.abs((item.amount ?? 0) - lineItemsTotal) > 0.009 ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    persistReceiptItemPatch(item, {
                                      amount: lineItemsTotal,
                                    })
                                  }
                                >
                                  Use Items Total
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          <div className="space-y-2">
                            {item.lineItems.map((lineItem, lineItemIndex) => {
                              const showQuantity =
                                typeof lineItem.quantity === "number" && lineItem.quantity > 1

                              return (
                                <div
                                  key={`${item.id}-line-item-${lineItemIndex}`}
                                  className={
                                    showQuantity
                                      ? "grid gap-3 rounded-lg border bg-muted/10 p-4 xl:grid-cols-[minmax(0,1.4fr)_110px_140px_280px]"
                                      : "grid gap-3 rounded-lg border bg-muted/10 p-4 xl:grid-cols-[minmax(0,1.6fr)_160px_320px]"
                                  }
                                >
                                  <div className="min-w-0 space-y-1">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Description
                                    </p>
                                    <Input
                                      value={lineItem.description}
                                      onChange={(event) =>
                                        void updateReceiptLineItem(item, lineItemIndex, {
                                          description: event.target.value,
                                        })
                                      }
                                    />
                                  </div>
                                  {showQuantity ? (
                                    <div className="space-y-1">
                                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                        Qty
                                      </p>
                                      <Input
                                        type="number"
                                        step="1"
                                        value={lineItem.quantity ?? ""}
                                        onChange={(event) =>
                                          void updateReceiptLineItem(item, lineItemIndex, {
                                            quantity:
                                              event.target.value.trim() === ""
                                                ? undefined
                                                : Number(event.target.value),
                                          })
                                        }
                                      />
                                    </div>
                                  ) : null}
                                  <div className="space-y-1">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Amount
                                    </p>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={lineItem.amount ?? ""}
                                      onChange={(event) =>
                                        void updateReceiptLineItem(item, lineItemIndex, {
                                          amount:
                                            event.target.value.trim() === ""
                                              ? undefined
                                              : Number(event.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Category
                                    </p>
                                    <Select
                                      value={lineItem.category ?? selectedCategory}
                                      onValueChange={(value) =>
                                        void updateReceiptLineItem(item, lineItemIndex, {
                                          category: value,
                                        })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Choose category" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                                          <SelectItem key={option} value={option}>
                                            {option}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>{formatOccurredAt(item.occurredAt)}</span>
                        <span>{formatCurrency(item.amount ?? 0)}</span>
                        {item.receiptAnalysisId ? <span>analysis ready</span> : null}
                        {item.receiptAsset?.fileName ? (
                          <span>{item.receiptAsset.fileName}</span>
                        ) : null}
                      </div>

                      {item.receiptAsset?.originalDownloadUrl || item.receiptAsset?.downloadUrl ? (
                        <a
                          href={
                            item.receiptAsset?.originalDownloadUrl ??
                            item.receiptAsset?.downloadUrl
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-sky-700 underline underline-offset-2"
                        >
                          Open uploaded receipt
                        </a>
                      ) : null}

                      {item.parseWarnings.length > 0 ? (
                        <p className="text-xs text-amber-700">
                          {item.parseWarnings.join(" • ")}
                        </p>
                      ) : null}

                      {item.analysisStatus === "failed" ? (
                        <p className="text-xs text-destructive">
                          Receipt analysis failed, so this draft may rely on fallback OCR.
                        </p>
                      ) : null}

                      {isProvisional ? (
                        <p className="text-xs text-muted-foreground">
                          Finalizing receipt draft in the background. You can keep editing and save now.
                        </p>
                      ) : null}

                      {isMultiCategory && liveAllocations?.length ? (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <p className="text-sm font-medium">Allocations</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {liveAllocations.map((allocation, index) => (
                              <Badge key={`${item.id}-allocation-${index}`} variant="outline">
                                {allocation.category}: {formatCurrency(allocation.amount)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => commitReceiptExpense(item)}
                          disabled={
                            workingItemId === item.id ||
                            duplicateExpense != null
                          }
                        >
                          <Check className="h-4 w-4" />
                          Save Receipt Expense
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => dismissReceiptDraft(item)}
                          disabled={workingItemId === item.id}
                        >
                          Cancel
                        </Button>
                        <Badge variant="secondary">
                          <ReceiptText className="h-3 w-3" />
                          Draft
                        </Badge>
                      </div>
                  </div>
                </div>
              )
            })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
