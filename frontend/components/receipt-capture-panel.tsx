"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Camera, Check, ImagePlus, Info, ReceiptText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import ExpenseCategoryPicker from "@/components/expense-category-picker"
import ReceiptViewerTrigger from "@/components/receipt-viewer-trigger"
import { formatCurrency } from "@/lib/helpers"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore"
import { getCalendarMonthBucketFromDate } from "@shared/payPeriods"
import { recognizeReceiptText } from "@/lib/imports/ocr"
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace"
import { isAbortError } from "@/lib/api/core/errors"
import {
  createReceiptAsset,
  deleteReceiptAsset,
} from "@/lib/api/receiptAssetsApi"
import { analyzeReceipt as analyzeReceiptApi } from "@/lib/api/receiptAnalysisApi"
import { commitReceiptDraftApi } from "@/lib/api/receiptDraftsApi"
import { checkDuplicateExpense } from "@/lib/api/expensesApi"
import { analyzeReceiptImageQuality } from "@/lib/receipts/imageQuality"
import {
  createReceiptPreviewAsset,
  extractReceiptDraft,
} from "@/lib/receipts/receiptDraft"
import {
  loadReceiptImage,
  normalizeExifOrientation,
  type DecodedReceiptImage,
} from "@/lib/receipts/imagePipeline"
import {
  computeImageHash,
  saveImageHash,
  findNearMatchByHash,
} from "@/lib/receipts/imageHash"
import {
  buildClientReceiptDerivedPath,
  buildClientReceiptStoragePath,
  prepareReceiptPreviewFile,
  prepareReceiptThumbnailFile,
  prepareReceiptUploadFile,
  uploadReceiptAssetToStorage,
} from "@/lib/receipts/receiptAssetStorage"
import {
  clearReceiptMediaForAsset,
  saveReceiptMediaFromFile,
} from "@/lib/storage/receiptAssetsCache"
import {
  captureReceiptImage,
  isNativeCameraAvailable,
} from "@/lib/native/camera"
import StackInLoaderWeb from "@/components/stackin-loader-web"
import * as expensesService from "@/lib/domain/expenseService"
import * as expenseRepository from "@/lib/domain/expenseRepository"
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
import {
  isVehicleTransportationCategory,
  type VehicleExpenseMode,
} from "@shared/vehicleExpenses"

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

function createReceiptCaptureAbortError(message = "Receipt capture canceled."): Error {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function createClientReceiptAssetId(): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
  return `receipt-${suffix}`
}

function getVehicleExpenseModeForCategory(
  category: string
): VehicleExpenseMode | undefined {
  return isVehicleTransportationCategory(category) ? "direct_expense" : undefined
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
      id: receiptAsset.id,
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
      vehicleExpenseMode: getVehicleExpenseModeForCategory(category.trim()),
      allocationMode: mode,
      completion: {
        missingFields: ["merchant", "date", "amount"],
        readyToCommit: false,
      },
      notes: "",
      receiptAssetId: receiptAsset.id,
      analysisStatus: "analyzing",
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
  // lineItems are OCR source data — never overwritten by a mode change.
  // Mode only controls allocationMode and the derived allocations array.
  const allocations =
    mode === "multiple"
      ? buildAllocationsFromLineItems(draft.lineItems, category)
      : []

  return {
    ...draft,
    allocationMode: mode,
    suggestedExpenseAccount: category || draft.suggestedExpenseAccount || null,
    vehicleExpenseMode: getVehicleExpenseModeForCategory(
      category || draft.suggestedExpenseAccount || ""
    ),
    allocations,
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

  const patch: ReceiptDraftPatch = {
    allocationMode: mode,
    suggestedExpenseAccount: normalizedCategory,
    vehicleExpenseMode: getVehicleExpenseModeForCategory(normalizedCategory ?? ""),
    // lineItems are OCR source data — never overwritten by a mode change.
    // Allocations are derived from the existing lineItems at commit time.
    allocations:
      mode === "multiple"
        ? buildAllocationsFromLineItems(draft.lineItems, normalizedCategory ?? "")
        : [],
  }

  // When collapsing to single mode from multiple detected items, populate the
  // description field with a summary of the line item names so the user can
  // see what was on the receipt in the single description box.
  // When expanding back to multiple, clear the description — the structured
  // line items are the source of truth and no single string describes them.
  if (mode === "single" && (draft.lineItems?.length ?? 0) >= 2) {
    const parts = (draft.lineItems ?? [])
      .map((li) => li.description?.trim())
      .filter((d): d is string => Boolean(d))
    patch.description = parts.length > 0 ? parts.join(", ") : null
  } else if (mode === "multiple") {
    patch.description = null
  }

  return patch
}

const EMPTY_EXPENSES: any[] = []

// A draft stuck at analysisStatus "analyzing" for longer than this is considered
// unrecoverable — the OCR request was abandoned mid-flight (e.g. app closed).
const STUCK_DRAFT_THRESHOLD_MS = 5 * 60 * 1000

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
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId]?.expenses ?? EMPTY_EXPENSES : EMPTY_EXPENSES
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
  const [expenseCategoriesByItemId, setExpenseCategoriesByItemId] = useState<
    Record<string, string>
  >({})
  const [expanded, setExpanded] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  // Tracks which draft IDs the user has explicitly overridden the duplicate warning for.
  const [confirmedDuplicateDraftIds, setConfirmedDuplicateDraftIds] = useState<Set<string>>(
    new Set()
  )
  // Server-side duplicate check results keyed by draft ID.
  // exactDuplicate → same date, blocks save until "Save Anyway" is clicked.
  // nearDuplicate  → ±3 days, informational only, never blocks save.
  const [serverDuplicateByDraftId, setServerDuplicateByDraftId] = useState<
    Record<string, { exact: boolean; near: boolean }>
  >({})
  // Draft awaiting historical-period confirmation before commit.
  const [pendingHistoricalCommit, setPendingHistoricalCommit] = useState<ReceiptDraft | null>(
    null
  )
  // Upload failure tracking: maps receiptAssetId → source File so the user can
  // retry the GCS upload without re-capturing the photo.
  const pendingUploadFilesRef = useRef<Record<string, File>>({})
  const [uploadFailedReceiptAssetIds, setUploadFailedReceiptAssetIds] = useState<Set<string>>(new Set())

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const draftSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const draftSyncQueueRef = useRef<Record<string, ReceiptDraftPatch>>({})
  const activeProcessAbortControllerRef = useRef<AbortController | null>(null)
  const canceledCapturesRef = useRef<Set<string>>(new Set())
  const activeCaptureTraceRef = useRef<ReturnType<typeof createProfileTrace> | null>(null)
  const activeCaptureReceiptAssetIdRef = useRef<string | null>(null)
  const activeCaptureMilestonesRef = useRef({
    draftShellVisible: false,
    editableFieldsVisible: false,
    previewReady: false,
  })
  const lastAnalysisStatusByReceiptAssetRef = useRef<Record<string, string | undefined>>({})
  const lastDraftIdByReceiptAssetRef = useRef<Record<string, string | undefined>>({})
  // Tracks the in-flight createReceiptAsset promise for the active capture.
  // discardReceiptCaptureArtifacts awaits this before deleting, preventing
  // the race where a fast cancel deletes a record that hasn't been written yet.
  const pendingCreateAssetRef = useRef<{
    receiptAssetId: string
    promise: Promise<unknown>
  } | null>(null)

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
      activeProcessAbortControllerRef.current?.abort()
      activeProcessAbortControllerRef.current = null
      for (const timer of Object.values(draftSyncTimersRef.current)) {
        clearTimeout(timer)
      }
      draftSyncTimersRef.current = {}
      draftSyncQueueRef.current = {}
    }
  }, [activeWorkspaceId])

  const receiptDrafts = receiptDraftsEntry?.drafts ?? []

  const pendingReceiptItems = useMemo(
    () =>
      receiptDrafts.filter(
        (item) => item.status === "draft" || item.status === "ready_to_review"
      ),
    [receiptDrafts]
  )

  // A draft is "stuck" when it is still in the analyzing state but is not the
  // currently active capture and was created more than 5 minutes ago. This
  // happens when the user closes the app mid-OCR — the request is abandoned but
  // the optimistic draft persists in Firestore with analysisStatus: "analyzing".
  // activeCaptureReceiptAssetIdRef is intentionally not in the deps array — refs
  // don't trigger re-renders, and we read the current value at compute time which
  // is always triggered by a draft change.
  const stuckDraftIds = useMemo(() => {
    const now = Date.now()
    const activeReceiptAssetId = activeCaptureReceiptAssetIdRef.current
    return new Set(
      pendingReceiptItems
        .filter(
          (item) =>
            item.analysisStatus === "analyzing" &&
            item.receiptAssetId !== activeReceiptAssetId &&
            now - new Date(item.createdAt).getTime() > STUCK_DRAFT_THRESHOLD_MS
        )
        .map((item) => item.id)
    )
  }, [pendingReceiptItems])

  useEffect(() => {
    if (pendingReceiptItems.length === 0) {
      setAnalysisOpen(false)
    }
  }, [pendingReceiptItems.length])

  // Fire server-side duplicate check when a draft becomes ready to review.
  useEffect(() => {
    if (!activeWorkspaceId) return
    for (const item of pendingReceiptItems) {
      const isReady =
        item.analysisStatus === "succeeded" || item.analysisStatus === "failed"
      const alreadyChecked = item.id in serverDuplicateByDraftId
      if (!isReady || alreadyChecked) continue
      if (!item.occurredAt || !item.amount) continue

      const workspaceId = activeWorkspaceId
      const draftId = item.id
      void checkDuplicateExpense(workspaceId, {
        date: item.occurredAt,
        amount: Number(item.amount),
        merchant: item.counterparty || item.description || "",
      })
        .then((result) => {
          setServerDuplicateByDraftId((prev) => ({
            ...prev,
            [draftId]: {
              exact: result.possibleDuplicate,
              near: result.possibleNearDuplicate,
            },
          }))
        })
        .catch(() => {
          // Non-fatal — client-side check is the fallback
        })
    }
  }, [activeWorkspaceId, pendingReceiptItems, serverDuplicateByDraftId])

  useEffect(() => {
    const trace = activeCaptureTraceRef.current
    const receiptAssetId = activeCaptureReceiptAssetIdRef.current
    if (!trace || !receiptAssetId) {
      return
    }

    const matchedDraft = receiptDrafts.find((candidate) => candidate.receiptAssetId === receiptAssetId)
    if (!matchedDraft) {
      return
    }

    const previousDraftId = lastDraftIdByReceiptAssetRef.current[receiptAssetId]
    if (previousDraftId && previousDraftId !== matchedDraft.id) {
      trace.mark("receipt.draft_identity_replaced", {
        receiptAssetId,
        previousDraftId,
        nextDraftId: matchedDraft.id,
      })
    }
    lastDraftIdByReceiptAssetRef.current[receiptAssetId] = matchedDraft.id

    if (!activeCaptureMilestonesRef.current.draftShellVisible) {
      activeCaptureMilestonesRef.current.draftShellVisible = true
      trace.mark("receipt.draft_shell_visible", {
        receiptAssetId,
        receiptDraftId: matchedDraft.id,
        analysisStatus: matchedDraft.analysisStatus ?? null,
        status: matchedDraft.status,
      })
    }

    const previousAnalysisStatus = lastAnalysisStatusByReceiptAssetRef.current[receiptAssetId]
    if (matchedDraft.analysisStatus && previousAnalysisStatus !== matchedDraft.analysisStatus) {
      trace.mark("receipt.analysis_status_transition", {
        receiptAssetId,
        receiptDraftId: matchedDraft.id,
        previousStatus: previousAnalysisStatus ?? null,
        nextStatus: matchedDraft.analysisStatus,
      })
      lastAnalysisStatusByReceiptAssetRef.current[receiptAssetId] = matchedDraft.analysisStatus
    }

    const editableFieldsReady =
      analysisOpen &&
      pendingReceiptItems.some((candidate) => candidate.receiptAssetId === receiptAssetId) &&
      (Boolean(matchedDraft.receiptAnalysisId) || matchedDraft.analysisStatus === "failed")

    if (editableFieldsReady && !activeCaptureMilestonesRef.current.editableFieldsVisible) {
      activeCaptureMilestonesRef.current.editableFieldsVisible = true
      trace.mark("receipt.editable_fields_visible", {
        receiptAssetId,
        receiptDraftId: matchedDraft.id,
        analysisStatus: matchedDraft.analysisStatus ?? null,
        status: matchedDraft.status,
        lineItemCount: matchedDraft.lineItems?.length ?? 0,
      })
    }

    const previewReady = Boolean(
      matchedDraft.receiptAsset?.previewStoragePath ||
        matchedDraft.receiptAsset?.originalStoragePath ||
        matchedDraft.receiptAsset?.storagePath ||
        matchedDraft.receiptAsset?.dataUrl
    )
    if (previewReady && !activeCaptureMilestonesRef.current.previewReady) {
      activeCaptureMilestonesRef.current.previewReady = true
      trace.mark("receipt.preview_ready", {
        receiptAssetId,
        receiptDraftId: matchedDraft.id,
        hasPreviewPath: Boolean(matchedDraft.receiptAsset?.previewStoragePath),
        hasOriginalPath: Boolean(
          matchedDraft.receiptAsset?.originalStoragePath || matchedDraft.receiptAsset?.storagePath
        ),
      })
    }
  }, [analysisOpen, pendingReceiptItems, receiptDrafts])

  function clearDraftSyncStateForDraftIds(workspaceId: string, draftIds: string[]): void {
    const queueKeys = draftIds.map((draftId) => `${workspaceId}:${draftId}`)
    for (const queueKey of queueKeys) {
      const existingTimer = draftSyncTimersRef.current[queueKey]
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      delete draftSyncTimersRef.current[queueKey]
      delete draftSyncQueueRef.current[queueKey]
    }
  }

  function clearCaptureTraceForReceiptAsset(receiptAssetId: string): void {
    if (activeCaptureReceiptAssetIdRef.current !== receiptAssetId) {
      return
    }

    activeCaptureReceiptAssetIdRef.current = null
    activeCaptureTraceRef.current = null
    delete lastAnalysisStatusByReceiptAssetRef.current[receiptAssetId]
    delete lastDraftIdByReceiptAssetRef.current[receiptAssetId]
  }

  function throwIfCaptureProcessAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw createReceiptCaptureAbortError()
    }
  }

  function throwIfReceiptSessionInactive(receiptAssetId: string): void {
    if (!activeWorkspaceId) {
      throw createReceiptCaptureAbortError()
    }
    if (canceledCapturesRef.current.has(receiptAssetId)) {
      throw createReceiptCaptureAbortError()
    }
    if (activeProcessAbortControllerRef.current?.signal.aborted) {
      throw createReceiptCaptureAbortError()
    }
  }

  function resetReceiptCapture(
    receiptAssetId: string,
    draftId: string,
    options: {
      terminalState?: "committed" | "dismissed" | "canceled"
      clearTrace?: boolean
    } = {}
  ): void {
    if (!activeWorkspaceId) return

    canceledCapturesRef.current.add(receiptAssetId)
    if (options.terminalState !== "committed") {
      activeProcessAbortControllerRef.current?.abort()
      activeProcessAbortControllerRef.current = null
    }
    clearDraftSyncStateForDraftIds(activeWorkspaceId, [draftId])
    setExpenseCategoriesByItemId((current) => {
      if (!(receiptAssetId in current)) return current
      const next = { ...current }
      delete next[receiptAssetId]
      return next
    })
    delete pendingUploadFilesRef.current[receiptAssetId]
    setUploadFailedReceiptAssetIds((current) => {
      if (!current.has(receiptAssetId)) return current
      const next = new Set(current)
      next.delete(receiptAssetId)
      return next
    })
    if (options.clearTrace !== false) {
      clearCaptureTraceForReceiptAsset(receiptAssetId)
    }
  }

  async function discardReceiptCaptureArtifacts(
    workspaceId: string,
    receiptAssetId: string
  ): Promise<void> {
    // If createReceiptAsset is still in-flight for this asset, wait for it to
    // settle before deleting. Without this, a fast cancel causes deleteReceiptAsset
    // to run against a record that doesn't exist yet — it succeeds silently, then
    // createReceiptAsset completes and writes an orphaned Firestore record.
    const pending = pendingCreateAssetRef.current
    if (pending?.receiptAssetId === receiptAssetId) {
      await pending.promise.catch(() => {})
      pendingCreateAssetRef.current = null
    }

    const cleanupResults = await Promise.allSettled([
      clearReceiptMediaForAsset(workspaceId, receiptAssetId),
      deleteReceiptAsset(workspaceId, receiptAssetId),
    ])

    const failedCleanup = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    if (failedCleanup) {
      throw failedCleanup.reason
    }
  }

  async function processReceiptFile(
    file: File,
    captureSource: "camera" | "gallery" | "upload" = "upload"
  ) {
    if (!file || !activeWorkspaceId) return

    // File type validation before any processing.
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    const fileTypeLower = file.type.toLowerCase()
    const fileNameLower = file.name.toLowerCase()
    const isAllowedType =
      ALLOWED_TYPES.includes(fileTypeLower) ||
      fileNameLower.endsWith(".jpg") ||
      fileNameLower.endsWith(".jpeg") ||
      fileNameLower.endsWith(".png") ||
      fileNameLower.endsWith(".webp") ||
      fileNameLower.endsWith(".heic")
    if (!isAllowedType) {
      setError("Unsupported file type. Please upload a JPEG, PNG, WebP, or HEIC image.")
      return
    }
    const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024 // 30 MB
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("This image is too large. Please use an image under 30 MB.")
      return
    }

    setUploading(true)
    setError(null)
    setMessage(null)
    activeProcessAbortControllerRef.current?.abort()
    const captureAbortController = new AbortController()
    activeProcessAbortControllerRef.current = captureAbortController
    const trace = createProfileTrace("receipt_capture", {
      workspaceId: activeWorkspaceId,
      fileName: file.name,
      captureSource,
    })
    let decodedReceiptImage: DecodedReceiptImage | null = null
    let optimisticReceiptAssetId: string | null = null
    let optimisticReceiptAsset: ReceiptAsset | null = null
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
      throwIfCaptureProcessAborted(captureAbortController)

      // Normalize EXIF orientation before quality analysis and OCR so the
      // image arrives upright regardless of camera rotation metadata.
      decodedReceiptImage = await withProfileStep(
        trace,
        "receipt.exif_normalize",
        () => normalizeExifOrientation(file, decodedReceiptImage!),
        {}
      )
      throwIfCaptureProcessAborted(captureAbortController)

      // Perceptual hash check: detect near-duplicate uploads before any
      // network calls are made. Warn the user but do not hard block.
      const imageHash = decodedReceiptImage ? computeImageHash(decodedReceiptImage) : ""
      if (imageHash) {
        const nearMatch = findNearMatchByHash(activeWorkspaceId, imageHash)
        if (nearMatch) {
          trace.mark("receipt.duplicate_hash_detected", { receiptAssetId: nearMatch.receiptAssetId })
          const proceed = window.confirm(
            "This receipt looks like it may have already been uploaded. Upload anyway?"
          )
          if (!proceed) {
            decodedReceiptImage.close()
            decodedReceiptImage = null
            setUploading(false)
            return
          }
        }
      }

      const quality = await withProfileStep(
        trace,
        "receipt.quality_check",
        () => analyzeReceiptImageQuality(file, decodedReceiptImage ?? undefined),
        { sizeBytes: file.size }
      )
      throwIfCaptureProcessAborted(captureAbortController)

      const clientReceiptAssetId = createClientReceiptAssetId()
      trace.mark("receipt.preview_prepare_local", { receiptAssetId: clientReceiptAssetId })
      optimisticReceiptAsset = createReceiptPreviewAsset(file, {
        captureSource,
        quality,
        receiptAsset: {
          id: clientReceiptAssetId,
        },
      })
      optimisticReceiptAssetId = optimisticReceiptAsset.id
      activeCaptureTraceRef.current = trace
      activeCaptureReceiptAssetIdRef.current = optimisticReceiptAsset.id
      activeCaptureMilestonesRef.current = {
        draftShellVisible: false,
        editableFieldsVisible: false,
        previewReady: false,
      }
      canceledCapturesRef.current.delete(optimisticReceiptAsset.id)
      lastAnalysisStatusByReceiptAssetRef.current[optimisticReceiptAsset.id] = undefined
      lastDraftIdByReceiptAssetRef.current[optimisticReceiptAsset.id] = undefined
      const optimisticDraft = buildOptimisticReceiptDraft(
        activeWorkspaceId,
        optimisticReceiptAsset,
        "single",
        ""
      )
      useReceiptDraftsStore.getState().applyDraft(activeWorkspaceId, optimisticDraft)

      const originalUploadFile = await withProfileStep(
        trace,
        "receipt.upload_prepare",
        () => prepareReceiptUploadFile(file, decodedReceiptImage ?? undefined),
        {
          originalSizeBytes: file.size,
        }
      )
      throwIfCaptureProcessAborted(captureAbortController)
      trace.mark("receipt.upload_file_ready", {
        originalSizeBytes: file.size,
        originalUploadSizeBytes: originalUploadFile.size,
        uploadMimeType: originalUploadFile.type || "image/jpeg",
      })

      // Compute storage paths client-side — same formula as the backend.
      // No API call needed; the asset ID was generated locally and both sides
      // derive the same paths from it.
      const clientOriginalStoragePath = buildClientReceiptStoragePath(
        activeWorkspaceId,
        clientReceiptAssetId,
        file.name
      )
      const storedReceiptAsset: ReceiptAsset = {
        ...optimisticReceiptAsset,
        originalStoragePath: clientOriginalStoragePath,
        storagePath: clientOriginalStoragePath,
        previewStoragePath: buildClientReceiptDerivedPath(
          activeWorkspaceId,
          clientReceiptAssetId,
          "preview"
        ),
        thumbnailStoragePath: buildClientReceiptDerivedPath(
          activeWorkspaceId,
          clientReceiptAssetId,
          "thumb"
        ),
        mimeType: originalUploadFile.type || "image/jpeg",
        sizeBytes: originalUploadFile.size,
      }

      // Record the image hash so future uploads of the same receipt are detected.
      if (imageHash) {
        saveImageHash(activeWorkspaceId, clientReceiptAssetId, imageHash)
      }

      // Create the Firestore asset record concurrently with OCR (not awaited).
      // OCR takes 2-4s; this completes well before the background storage upload starts.
      // The promise is tracked in pendingCreateAssetRef so that discardReceiptCaptureArtifacts
      // can await it before deleting — preventing the orphaned-asset race on fast cancel.
      pendingCreateAssetRef.current = {
        receiptAssetId: clientReceiptAssetId,
        promise: createReceiptAsset(
          activeWorkspaceId,
          {
            id: clientReceiptAssetId,
            fileName: file.name,
            mimeType: originalUploadFile.type || "image/jpeg",
            sizeBytes: originalUploadFile.size,
            captureSource,
            quality: quality.quality,
            blurScore: quality.blurScore,
            glareScore: quality.glareScore,
            qualityStatus: quality.qualityStatus,
            qualityWarnings: quality.warnings,
            width: quality.width,
            height: quality.height,
          },
          profile("receipt.asset_create.network_request", { receiptAssetId: clientReceiptAssetId }),
          captureAbortController.signal
        ).catch((err) => {
          if (!isAbortError(err)) {
            trace.error("receipt.asset_create_failed", err, { receiptAssetId: clientReceiptAssetId })
          }
        }),
      }

      setOcrStatus("Analyzing receipt...")
      patchDraftLocally(activeWorkspaceId, storedReceiptAsset.id, {
        analysisStatus: "analyzing",
        receiptAsset: storedReceiptAsset,
        parseWarnings: ["Analyzing receipt..."],
      })

      try {
        throwIfReceiptSessionInactive(storedReceiptAsset.id)

        const analyzed = await withProfileStep(
          trace,
          "receipt.analysis_request",
          () =>
            analyzeReceiptApi(
              activeWorkspaceId,
              storedReceiptAsset.id,
              originalUploadFile,
              profile("receipt.analysis_request.network_request", {
                receiptAssetId: storedReceiptAsset.id,
              }),
              captureAbortController.signal
            ),
          {
            receiptAssetId: storedReceiptAsset.id,
          }
        )
        throwIfReceiptSessionInactive(storedReceiptAsset.id)

        // Draft is already persisted in Firestore by analyzeReceipt.
        const persistedDraft: ReceiptDraft = {
          ...analyzed.draft,
          receiptAsset: storedReceiptAsset,
        }
        // Derive mode from what Textract actually found, not a pre-capture default.
        // Two or more line items → offer multi-category workflow.
        // Zero or one → single expense, no mode selection needed.
        const detectedMode: ReceiptDraftAllocationMode =
          (persistedDraft.lineItems?.length ?? 0) >= 2 ? "multiple" : "single"
        const modePatch = buildModePatch(persistedDraft, detectedMode, "")
        useReceiptDraftsStore.getState().applyDraft(activeWorkspaceId, persistedDraft)
        patchDraftLocally(activeWorkspaceId, persistedDraft.id, modePatch)

        if (optimisticReceiptAsset?.dataUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(optimisticReceiptAsset.dataUrl)
        }

        // Sync the user's mode/category selection back to Firestore (background).
        if (Object.keys(modePatch).length > 0) {
          void updateDraft(activeWorkspaceId, persistedDraft.id, modePatch).catch((err) => {
            trace.error("receipt.mode_patch_sync_failed", err, {
              receiptDraftId: persistedDraft.id,
            })
          })
        }

        // Storage upload, preview and thumbnail all happen in the background.
        // The user is already looking at the pre-filled form by this point.
        // Store the source file so the user can retry the upload if it fails.
        pendingUploadFilesRef.current[storedReceiptAsset.id] = file
        const backgroundDecodedReceiptImage = decodedReceiptImage
        decodedReceiptImage = null
        void (async (
          workspaceId: string,
          sourceFile: File,
          originalAsset: ReceiptAsset,
          uploadFile: File
        ) => {
          try {
            throwIfReceiptSessionInactive(originalAsset.id)

            // Upload the original image and render preview/thumbnail canvas files
            // simultaneously — they are independent of each other. Canvas renders
            // take ~200–400ms and overlap entirely with the original upload (800ms–3s),
            // so preview/thumbnail uploads can begin as soon as the original upload lands.
            const [, previewFile, thumbnailFile] = await Promise.all([
              withProfileStep(
                trace,
                "receipt.upload_original",
                () =>
                  uploadReceiptAssetToStorage(
                    uploadFile,
                    originalAsset.originalStoragePath ?? originalAsset.storagePath ?? "",
                    { resolveDownloadUrl: false }
                  ),
                {
                  receiptAssetId: originalAsset.id,
                  originalStoragePath:
                    originalAsset.originalStoragePath ?? originalAsset.storagePath ?? null,
                  originalUploadSizeBytes: uploadFile.size,
                }
              ),
              prepareReceiptPreviewFile(sourceFile, backgroundDecodedReceiptImage ?? undefined),
              prepareReceiptThumbnailFile(sourceFile, backgroundDecodedReceiptImage ?? undefined),
            ])
            throwIfReceiptSessionInactive(originalAsset.id)

            const [previewResult, thumbnailResult] = await Promise.allSettled([
              uploadReceiptAssetToStorage(previewFile, originalAsset.previewStoragePath ?? ""),
              uploadReceiptAssetToStorage(thumbnailFile, originalAsset.thumbnailStoragePath ?? ""),
            ])
            throwIfReceiptSessionInactive(originalAsset.id)

            const version = originalAsset.version ?? 1
            const cacheWrites: Promise<unknown>[] = []
            if (previewResult.status === "fulfilled") {
              cacheWrites.push(
                saveReceiptMediaFromFile(
                  workspaceId,
                  originalAsset.id,
                  "preview",
                  version,
                  previewFile
                )
              )
            }
            if (thumbnailResult.status === "fulfilled") {
              cacheWrites.push(
                saveReceiptMediaFromFile(
                  workspaceId,
                  originalAsset.id,
                  "thumbnail",
                  version,
                  thumbnailFile
                )
              )
            }
            await Promise.all(cacheWrites)

            delete pendingUploadFilesRef.current[originalAsset.id]
            trace.mark("receipt.cache_ready", {
              receiptAssetId: originalAsset.id,
              version,
            })
          } catch (backgroundError) {
            if (isAbortError(backgroundError)) {
              delete pendingUploadFilesRef.current[originalAsset.id]
              return
            }
            trace.error("receipt.media_background_failed", backgroundError, {
              receiptAssetId: originalAsset.id,
            })
            // Surface a non-blocking warning so the user can retry the upload.
            setUploadFailedReceiptAssetIds((current) => new Set([...current, originalAsset.id]))
          } finally {
            backgroundDecodedReceiptImage?.close()
          }
        })(activeWorkspaceId, file, storedReceiptAsset, originalUploadFile)

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
        if (isAbortError(analysisError)) {
          throw analysisError
        }
        trace.error("receipt.analysis_failed", analysisError, {
          receiptAssetId: storedReceiptAsset.id,
        })

        const fallbackStatus = "Receipt analysis unavailable. Reading receipt text locally..."
        setOcrStatus(fallbackStatus)
        const resolvedOcrText = await withProfileStep(
          trace,
          "receipt.ocr",
          () =>
            recognizeReceiptText(file, ({ status, progress }) => {
              const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))
              setOcrStatus(`${status} (${percent}%)`)
            }),
          {}
        )

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
              vehicleExpenseMode: extracted.vehicleExpenseMode,
              completion: {
                missingFields: extracted.missingFields,
                readyToCommit: extracted.missingFields.length === 0,
              },
              notes: "",
              receiptAssetId: storedReceiptAsset.id,
              receiptAnalysisId: undefined,
              analysisStatus: "failed",
              lineItems: [],
              allocations: [],
              fieldConfidence:
                resolvedOcrText.trim().length > 0 ? { total: 0.75, merchant: 0.7 } : {},
              receiptAsset: storedReceiptAsset,
            }
            // Local OCR never produces structured line items, so single mode is always correct.
            return applyDraftMode(nextDraft, "single", "")
          },
          {}
        )
        await withProfileStep(
          trace,
          "receipt.draft_create",
          () => createDraft(activeWorkspaceId, draftPayload),
          { qualityStatus: quality.qualityStatus }
        )
        setExpanded(false)
        setAnalysisOpen(true)
        setMessage(
          "Receipt draft created with local OCR fallback. Review the extracted fields below before saving."
        )
        trace.mark("receipt.capture.complete", {
          mode: "fallback_ocr",
          receiptAssetId: storedReceiptAsset.id,
        })
      }
    } catch (err) {
      if (isAbortError(err) || (err instanceof Error && /canceled/i.test(err.message))) {
        trace.mark("receipt.capture.canceled")
        if (optimisticReceiptAsset?.dataUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(optimisticReceiptAsset.dataUrl)
        }
        if (optimisticReceiptAssetId) {
          removeDraftsForReceiptAsset(activeWorkspaceId, optimisticReceiptAssetId)
          resetReceiptCapture(optimisticReceiptAssetId, optimisticReceiptAssetId, {
            terminalState: "canceled",
          })
          void discardReceiptCaptureArtifacts(
            activeWorkspaceId,
            optimisticReceiptAssetId
          ).catch((cleanupError) => {
            console.warn("receipt capture cleanup failed after cancel", cleanupError)
          })
        }
        return
      }

      trace.error("receipt.capture_failed", err)
      if (optimisticReceiptAsset?.dataUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(optimisticReceiptAsset.dataUrl)
      }
      if (optimisticReceiptAssetId) {
        removeDraftsForReceiptAsset(activeWorkspaceId, optimisticReceiptAssetId)
        resetReceiptCapture(optimisticReceiptAssetId, optimisticReceiptAssetId, {
          terminalState: "canceled",
        })
        void discardReceiptCaptureArtifacts(
          activeWorkspaceId,
          optimisticReceiptAssetId
        ).catch((cleanupError) => {
          console.warn("receipt capture cleanup failed after error", cleanupError)
        })
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
      // Only clear uploading state if no newer upload has already taken over the
      // controller slot. Without this guard, a fast re-upload that starts while
      // this one is still winding down would have its loading indicator cleared
      // prematurely by this finally block.
      if (activeProcessAbortControllerRef.current === captureAbortController) {
        activeProcessAbortControllerRef.current = null
        setOcrStatus(null)
        setUploading(false)
      }
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

  const VALID_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

  async function commitReceiptExpense(item: ReceiptDraft) {
    if (!activeWorkspaceId) return

    const category =
      expenseCategoriesByItemId[item.receiptAssetId] || item.suggestedExpenseAccount || ""
    if (!category) {
      setError("Choose an expense category before saving this receipt.")
      return
    }

    const occurredAt = item.occurredAt
    if (!occurredAt) {
      setError("Please enter the receipt date before saving.")
      return
    }
    if (!VALID_DATE_RE.test(occurredAt)) {
      setError("Please enter a complete, valid date (YYYY-MM-DD) before saving.")
      return
    }
    const receiptDate = new Date(`${occurredAt}T12:00:00`)
    if (receiptDate > new Date()) {
      setError("The receipt date is in the future — please check the date before saving.")
      return
    }

    const amount = Number(item.amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Please enter a valid expense amount before saving.")
      return
    }

    // In multiple-category mode every line item must have an amount — that is
    // the entire point of the mode. Textract may not extract amounts for every
    // line (e.g. bundled items, poorly printed receipts). In that case the user
    // must fill them in manually before the allocation can be saved correctly.
    const currentAllocationMode = resolveAllocationMode(item)
    if (currentAllocationMode === "multiple") {
      const lineItems = item.lineItems ?? []
      const missingAmountIndexes = lineItems
        .map((li, index) => ({ li, index }))
        .filter(
          ({ li }) =>
            typeof li.amount !== "number" ||
            !Number.isFinite(li.amount) ||
            li.amount <= 0
        )
        .map(({ index }) => index + 1)

      if (missingAmountIndexes.length > 0) {
        setError(
          missingAmountIndexes.length === 1
            ? `Line item ${missingAmountIndexes[0]} is missing an amount. Enter the amount before saving.`
            : `Line items ${missingAmountIndexes.join(", ")} are missing amounts. Enter all amounts before saving.`
        )
        return
      }
    }

    // Historical-period gate: warn before updating prior-year P&L.
    const expenseYear = occurredAt.slice(0, 4)
    const currentYear = new Date().getFullYear().toString()
    if (expenseYear < currentYear && pendingHistoricalCommit?.id !== item.id) {
      setPendingHistoricalCommit(item)
      return
    }
    setPendingHistoricalCommit(null)

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    const clientMutationId = `receipt-draft:${item.id}`
    const periodId = getCalendarMonthBucketFromDate(occurredAt)
    const vendor = item.counterparty || item.description || "Receipt expense"
    const description = item.description || item.counterparty || "Receipt expense"

    const vehicleExpenseMode =
      item.vehicleExpenseMode ?? getVehicleExpenseModeForCategory(category)
    const allocations =
      currentAllocationMode === "multiple"
        ? buildAllocationsFromLineItems(item.lineItems, category)
        : []

    // Build a temporary expense so it appears in the grid before the server
    // responds. The tempId lets the store replace it with the canonical record
    // once the commit resolves.
    const nowIso = new Date().toISOString()
    const tempId = `tmp-${item.id}`
    const optimisticExpense = {
      tempId,
      clientMutationId,
      periodId,
      date: occurredAt,
      amount,
      vendor,
      description,
      account: category,
      receiptAssetId: item.receiptAssetId,
      receiptAnalysisId: item.receiptAnalysisId,
      createdFromReceipt: true,
      allocations,
      calculationMethod: "manual" as const,
      vehicleExpenseMode,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    }

    try {
      // Optimistically mark the draft committed and add the expense to the
      // grid — both happen before the network call so the UI responds instantly.
      patchDraftLocally(activeWorkspaceId, item.id, { status: "committed" })
      useExpensesStore.getState().addExpense(activeWorkspaceId, optimisticExpense)
      if (pendingReceiptItems.length <= 1) {
        setAnalysisOpen(false)
      }
      setExpanded(false)

      // Single atomic backend call: creates expense + marks draft committed
      // in one Firestore batch. No partial-commit ghost drafts.
      const { expense } = await commitReceiptDraftApi(activeWorkspaceId, item.id, {
        date: occurredAt,
        amount,
        vendor,
        description,
        account: category,
        periodId,
        clientMutationId,
        receiptAssetId: item.receiptAssetId,
        receiptAnalysisId: item.receiptAnalysisId,
        allocations,
        calculationMethod: "manual",
        vehicleExpenseMode,
      })

      // Replace the optimistic entry with the canonical server record.
      useExpensesStore.getState().replaceExpense(activeWorkspaceId, tempId, expense)

      // Write the updated expense list back to the repository cache so the
      // receipts library finds this expense immediately without waiting for
      // its next TTL-driven backend refresh.
      const storeEntry = useExpensesStore.getState().byWorkspaceId[activeWorkspaceId]
      if (storeEntry) {
        expenseRepository.prime(activeWorkspaceId, periodId, storeEntry.expenses, {
          lastSuccessfulSyncAt: storeEntry.lastSuccessfulSyncAt ?? Date.now(),
          localUpdatedAt: Date.now(),
        })
      }

      updateExpenseMemory({
        vendor: item.counterparty || item.description || "",
        description: item.description || item.counterparty || "",
        account: category,
      })

      setMessage("Receipt saved as a business expense.")
      resetReceiptCapture(item.receiptAssetId, item.id, { terminalState: "committed" })
    } catch (err) {
      // Remove the optimistic expense and restore the draft so the user can retry.
      useExpensesStore.getState().removeExpense(activeWorkspaceId, tempId)
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

    resetReceiptCapture(item.receiptAssetId, item.id, {
      terminalState: "dismissed",
    })
    removeDraftsForReceiptAsset(activeWorkspaceId, item.receiptAssetId)
    try {
      await discardReceiptCaptureArtifacts(activeWorkspaceId, item.receiptAssetId)
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

  // Clears a stuck draft and reopens the capture panel so the user can retake
  // the photo. A draft is "stuck" when it never progressed past analysisStatus:
  // "analyzing" — typically because the app was closed mid-OCR.
  async function retryStuckDraft(item: ReceiptDraft) {
    if (!activeWorkspaceId) return

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    resetReceiptCapture(item.receiptAssetId, item.id, {
      terminalState: "canceled",
    })
    removeDraftsForReceiptAsset(activeWorkspaceId, item.receiptAssetId)

    if (pendingReceiptItems.length <= 1) {
      setAnalysisOpen(false)
    }

    try {
      await discardReceiptCaptureArtifacts(activeWorkspaceId, item.receiptAssetId)
    } catch (err) {
      // Cleanup failure is non-fatal — the user still gets to retry.
      console.warn("retryStuckDraft: cleanup failed", err)
    } finally {
      setWorkingItemId(null)
    }

    setExpanded(true)
  }

  // Retries the GCS upload for a draft whose background upload previously failed.
  // Uses the stored source File (kept in pendingUploadFilesRef) so the user does
  // not need to re-capture the photo. Clears the failure badge on success.
  async function retryReceiptUpload(item: ReceiptDraft) {
    if (!activeWorkspaceId) return

    const sourceFile = pendingUploadFilesRef.current[item.receiptAssetId]
    const asset = item.receiptAsset
    if (!sourceFile || !asset) return

    setUploadFailedReceiptAssetIds((current) => {
      const next = new Set(current)
      next.delete(item.receiptAssetId)
      return next
    })
    setWorkingItemId(item.id)

    void (async () => {
      try {
        throwIfReceiptSessionInactive(item.receiptAssetId)

        const [uploadFile, previewFile, thumbnailFile] = await Promise.all([
          prepareReceiptUploadFile(sourceFile),
          prepareReceiptPreviewFile(sourceFile),
          prepareReceiptThumbnailFile(sourceFile),
        ])
        throwIfReceiptSessionInactive(item.receiptAssetId)

        await uploadReceiptAssetToStorage(
          uploadFile,
          asset.originalStoragePath ?? asset.storagePath ?? "",
          { resolveDownloadUrl: false }
        )
        throwIfReceiptSessionInactive(item.receiptAssetId)

        const [previewResult, thumbnailResult] = await Promise.allSettled([
          uploadReceiptAssetToStorage(previewFile, asset.previewStoragePath ?? ""),
          uploadReceiptAssetToStorage(thumbnailFile, asset.thumbnailStoragePath ?? ""),
        ])
        throwIfReceiptSessionInactive(item.receiptAssetId)

        const version = asset.version ?? 1
        const cacheWrites: Promise<unknown>[] = []
        if (previewResult.status === "fulfilled") {
          cacheWrites.push(
            saveReceiptMediaFromFile(activeWorkspaceId, asset.id, "preview", version, previewFile)
          )
        }
        if (thumbnailResult.status === "fulfilled") {
          cacheWrites.push(
            saveReceiptMediaFromFile(activeWorkspaceId, asset.id, "thumbnail", version, thumbnailFile)
          )
        }
        await Promise.all(cacheWrites)

        delete pendingUploadFilesRef.current[item.receiptAssetId]
      } catch (err) {
        if (isAbortError(err)) {
          delete pendingUploadFilesRef.current[item.receiptAssetId]
          return
        }
        setUploadFailedReceiptAssetIds((current) => new Set([...current, item.receiptAssetId]))
        setError("Receipt image upload failed. Check your connection and try again.")
      } finally {
        setWorkingItemId(null)
      }
    })()
  }

  function persistReceiptItemPatch(item: ReceiptDraft, patch: ReceiptDraftPatch) {
    if (!activeWorkspaceId) return

    setError(null)
    patchDraftLocally(activeWorkspaceId, item.id, patch)

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
      expenseCategoriesByItemId[item.receiptAssetId] ||
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
                <p className="text-xl font-semibold text-foreground">Add a receipt image</p>
                <p className="text-sm text-muted-foreground">
                  Use the camera or upload an image from your library to begin receipt analysis.
                </p>
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
                  {pendingReceiptItems.length > 0 ? (
                    <div className="flex justify-end">
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
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
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
              const editableItem = item
              const cardKey = editableItem.id
              const isStuck = stuckDraftIds.has(editableItem.id)
              const allocationMode = resolveAllocationMode(editableItem)
              const isMultiCategory = allocationMode === "multiple"
              const clientDuplicate = findDuplicateExpense(editableItem, expenses)
              const serverResult = serverDuplicateByDraftId[editableItem.id]
              const hasExactDuplicate = clientDuplicate != null || (serverResult?.exact ?? false)
              const hasNearDuplicate = !hasExactDuplicate && (serverResult?.near ?? false)
              const duplicateConfirmed = confirmedDuplicateDraftIds.has(editableItem.id)
              const lineItemsTotal = sumLineItems(editableItem.lineItems)
              const fc = editableItem.fieldConfidence ?? {}
              const selectedCategory =
                expenseCategoriesByItemId[editableItem.receiptAssetId] ||
                getSuggestedExpenseCategoryForImport(editableItem, getAccountForVendor) ||
                editableItem.suggestedExpenseAccount ||
                ""
              const liveAllocations =
                isMultiCategory && editableItem.lineItems?.length
                  ? buildAllocationsFromLineItems(editableItem.lineItems, selectedCategory)
                  : editableItem.allocations ?? []
              return (
                <div key={cardKey} className="overflow-hidden rounded-xl border p-4">
                  {hasExactDuplicate && !duplicateConfirmed ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <Badge variant="outline">Possible duplicate</Badge>
                      <span>A matching expense already exists for this exact date and amount.</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-amber-800 hover:bg-amber-100"
                        onClick={() =>
                          setConfirmedDuplicateDraftIds((prev) => new Set([...prev, editableItem.id]))
                        }
                      >
                        Save Anyway
                      </Button>
                    </div>
                  ) : hasExactDuplicate && duplicateConfirmed ? (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <span>Saving as a new expense (duplicate override active).</span>
                    </div>
                  ) : hasNearDuplicate ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">Similar expense</Badge>
                      <span>A similar expense exists within a few days of this date. Verify before saving.</span>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {editableItem.counterparty || editableItem.description || "Receipt draft"}
                        </p>
                        <Badge variant="outline">receipt</Badge>
                        {editableItem.analysisStatus ? (
                          <Badge variant="secondary">{editableItem.analysisStatus}</Badge>
                        ) : null}
                      </div>

                      {/* Receipt Mode selector is only meaningful when multiple line
                          items were detected. For single-item receipts the category
                          picker spans the full width and no mode decision is needed. */}
                      <div className={`grid gap-4 ${(editableItem.lineItems?.length ?? 0) >= 2 ? "sm:grid-cols-2" : ""}`}>
                        {(editableItem.lineItems?.length ?? 0) >= 2 ? (
                          <div className="space-y-1">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Receipt Mode
                            </p>
                            {/* Segmented toggle instead of Select — avoids Radix portal/Dialog
                                interaction issues on mobile where Select dropdowns are unreliable
                                inside a full-screen DismissableLayer context. */}
                            <div className="flex overflow-hidden rounded-md border border-input">
                              <button
                                type="button"
                                className={`flex-1 px-3 py-2 text-sm transition-colors ${
                                  allocationMode === "single"
                                    ? "bg-foreground text-background"
                                    : "bg-background text-foreground hover:bg-muted"
                                }`}
                                onClick={() =>
                                  persistReceiptItemPatch(
                                    editableItem,
                                    buildModePatch(editableItem, "single", selectedCategory)
                                  )
                                }
                              >
                                One category
                              </button>
                              <button
                                type="button"
                                className={`flex-1 border-l border-input px-3 py-2 text-sm transition-colors ${
                                  allocationMode === "multiple"
                                    ? "bg-foreground text-background"
                                    : "bg-background text-foreground hover:bg-muted"
                                }`}
                                onClick={() =>
                                  persistReceiptItemPatch(
                                    editableItem,
                                    buildModePatch(editableItem, "multiple", selectedCategory)
                                  )
                                }
                              >
                                Multiple categories
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Category
                          </p>
                          <ExpenseCategoryPicker
                            workspaceId={activeWorkspaceId}
                            value={selectedCategory}
                            onSelect={(category) => {
                              setExpenseCategoriesByItemId((current) => ({
                                ...current,
                                [editableItem.receiptAssetId]: category,
                              }))
                              persistReceiptItemPatch(editableItem, {
                                suggestedExpenseAccount: category,
                                vehicleExpenseMode:
                                  getVehicleExpenseModeForCategory(category),
                              })
                            }}
                            placeholder="Choose expense category"
                            dialogTitle="Choose Draft Category"
                            customDialogTitle="New Draft Category"
                          />
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

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Merchant
                          </p>
                          <Input
                            value={editableItem.counterparty || ""}
                            onChange={(event) =>
                              persistReceiptItemPatch(editableItem, {
                                counterparty: event.target.value,
                              })
                            }
                          />
                          {typeof fc.merchant === "number" && fc.merchant < 0.65 ? (
                            <p className="text-[11px] text-amber-600">
                              Merchant name may be inaccurate.
                            </p>
                          ) : null}
                        </div>
                        {/* In multiple-category mode the description lives inside each
                            line item. When the user switches to one category,
                            buildModePatch populates this field from the line items. */}
                        {!isMultiCategory ? (
                          <div className="space-y-1">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Description
                            </p>
                            <Input
                              value={editableItem.description || ""}
                              onChange={(event) =>
                                persistReceiptItemPatch(editableItem, {
                                  description: event.target.value,
                                })
                              }
                            />
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Total
                          </p>
                          <Input
                            type="number"
                            step="0.01"
                            value={editableItem.amount ?? ""}
                            onChange={(event) =>
                              persistReceiptItemPatch(editableItem, {
                                amount:
                                  event.target.value.trim() === ""
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                          />
                          {typeof fc.total === "number" && fc.total < 0.65 ? (
                            <p className="text-[11px] text-amber-600">
                              Low confidence — verify this amount.
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Date
                          </p>
                          <Input
                            type="date"
                            value={editableItem.occurredAt ?? ""}
                            onChange={(event) => {
                              const val = event.target.value
                              // Only persist complete dates — partial values corrupt Firestore.
                              const isComplete = /^\d{4}-\d{2}-\d{2}$/.test(val)
                              persistReceiptItemPatch(editableItem, {
                                occurredAt: isComplete ? val : null,
                              })
                            }}
                          />
                          {typeof fc.date === "number" && fc.date < 0.65 ? (
                            <p className="text-[11px] text-amber-600">
                              Date may be incorrect — double-check.
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {isMultiCategory && editableItem.lineItems?.length ? (
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
                              Math.abs((editableItem.amount ?? 0) - lineItemsTotal) > 0.009 ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    persistReceiptItemPatch(editableItem, {
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
                            {editableItem.lineItems.map((lineItem, lineItemIndex) => {
                              const showQuantity =
                                typeof lineItem.quantity === "number" && lineItem.quantity > 1

                              return (
                                <div
                                  key={`${cardKey}-line-item-${lineItemIndex}`}
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
                                        void updateReceiptLineItem(editableItem, lineItemIndex, {
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
                                          void updateReceiptLineItem(editableItem, lineItemIndex, {
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
                                        void updateReceiptLineItem(editableItem, lineItemIndex, {
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
                                    <ExpenseCategoryPicker
                                      workspaceId={activeWorkspaceId}
                                      value={lineItem.category ?? selectedCategory}
                                      onSelect={(category) =>
                                        void updateReceiptLineItem(editableItem, lineItemIndex, {
                                          category,
                                        })
                                      }
                                      placeholder="Choose category"
                                      dialogTitle="Choose Line Item Category"
                                      customDialogTitle="New Line Item Category"
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>{formatOccurredAt(editableItem.occurredAt)}</span>
                        <span>{formatCurrency(editableItem.amount ?? 0)}</span>
                        {editableItem.receiptAnalysisId ? <span>analysis ready</span> : null}
                        {editableItem.receiptAsset?.fileName ? (
                          <span>{editableItem.receiptAsset.fileName}</span>
                        ) : null}
                      </div>

                      {editableItem.receiptAsset?.originalStoragePath ||
                      editableItem.receiptAsset?.storagePath ? (
                        <ReceiptViewerTrigger
                          workspaceId={activeWorkspaceId}
                          receiptAssetId={editableItem.receiptAssetId}
                          asset={editableItem.receiptAsset}
                          label="View uploaded receipt"
                          variant="ghost"
                          className="px-0 text-xs text-sky-700 hover:text-sky-600"
                        />
                      ) : null}

                      {!isStuck && editableItem.parseWarnings.length > 0 ? (
                        <p className="text-xs text-amber-700">
                          {editableItem.parseWarnings.join(" • ")}
                        </p>
                      ) : null}

                      {editableItem.analysisStatus === "failed" ? (
                        <p className="text-xs text-destructive">
                          Receipt analysis failed, so this draft may rely on fallback OCR.
                        </p>
                      ) : null}

                      {isStuck ? (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Receipt analysis didn&apos;t complete — the app was likely closed before it finished.
                          Dismiss this draft or retake the photo to try again.
                        </div>
                      ) : null}

                      {!isStuck && uploadFailedReceiptAssetIds.has(editableItem.receiptAssetId) ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          <span>Receipt image failed to upload — the photo may not be viewable.</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={workingItemId === editableItem.id}
                            onClick={() => void retryReceiptUpload(editableItem)}
                          >
                            Retry Upload
                          </Button>
                        </div>
                      ) : null}

                      {!isStuck && isMultiCategory && liveAllocations?.length ? (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <p className="text-sm font-medium">Allocations</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {liveAllocations.map((allocation, index) => (
                              <Badge key={`${cardKey}-allocation-${index}`} variant="outline">
                                {allocation.category}: {formatCurrency(allocation.amount)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {isStuck ? (
                          <>
                            <Button
                              type="button"
                              onClick={() => retryStuckDraft(editableItem)}
                              disabled={workingItemId === editableItem.id}
                            >
                              Retake Photo
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => dismissReceiptDraft(editableItem)}
                              disabled={workingItemId === editableItem.id}
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              onClick={() => commitReceiptExpense(editableItem)}
                              disabled={
                                workingItemId === editableItem.id ||
                                (hasExactDuplicate && !duplicateConfirmed)
                              }
                            >
                              <Check className="h-4 w-4" />
                              Save Receipt Expense
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => dismissReceiptDraft(editableItem)}
                              disabled={workingItemId === editableItem.id}
                            >
                              Cancel
                            </Button>
                            <Badge variant="secondary">
                              <ReceiptText className="h-3 w-3" />
                              Draft
                            </Badge>
                          </>
                        )}
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

      {/* Historical period confirmation */}
      {pendingHistoricalCommit ? (
        <Dialog open onOpenChange={() => setPendingHistoricalCommit(null)}>
          <DialogContent className="max-w-sm">
            <div className="space-y-4 p-2">
              <p className="text-base font-semibold">Update Historical Records?</p>
              <p className="text-sm text-muted-foreground">
                This expense is dated{" "}
                <span className="font-medium">
                  {formatOccurredAt(pendingHistoricalCommit.occurredAt)}
                </span>
                , which is in a prior tax year. Saving it will update your historical Profit &amp;
                Loss statement.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    const item = pendingHistoricalCommit
                    setPendingHistoricalCommit(null)
                    void commitReceiptExpense(item)
                  }}
                >
                  Update {pendingHistoricalCommit.occurredAt?.slice(0, 4)} P&amp;L
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingHistoricalCommit(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
