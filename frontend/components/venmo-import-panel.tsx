"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/helpers"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useImportsStore } from "@/lib/stores/useImportsStore"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore"
import {
  parseImportCsvBySource,
  SUPPORTED_IMPORT_SOURCES,
  type SupportedImportSource,
} from "@/lib/imports/csvImportParsers"
import {
  categoryLabels,
  draftSum,
  emptyBreakdownDraft,
  parseMoney,
  paymentCategoryConfig,
  rebalanceBreakdownDraft,
  type BreakdownDraft,
} from "@/lib/incomeBreakdown"
import * as entriesService from "@/lib/domain/entriesService"
import * as expensesService from "@/lib/domain/expenseService"
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenseCategories"
import {
  findDuplicateExpense,
  findDuplicateIncomeEntry,
  getSuggestedExpenseCategoryForImport,
} from "@/lib/imports/reviewUtils"
import { debugError, debugLog, debugRender } from "@/lib/debugLoop"
import type { ImportBatch, ImportItem } from "@shared/schemas/import"
import type { EntryType, IncomeCategory, PaymentMethod } from "@shared/schemas/entry"

type ComparableExpense = {
  date?: string
  amount?: number
  vendor?: string
  description?: string
}

const EMPTY_ENTRIES: EntryType[] = []
const EMPTY_EXPENSES: ComparableExpense[] = []
const EMPTY_BATCHES: ImportBatch[] = []
const EMPTY_ITEMS: ImportItem[] = []
const VISIBLE_IMPORT_SOURCES = SUPPORTED_IMPORT_SOURCES.filter(
  (option) => option.source === "venmo_csv"
)

function statusVariant(
  status: ImportItem["status"]
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "committed") return "default"
  if (status === "rejected") return "destructive"
  if (status === "accepted") return "secondary"
  return "outline"
}

function formatOccurredAt(value: string | null | undefined): string {
  if (!value) return "Unknown date"
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatSourceLabel(source: SupportedImportSource): string {
  return SUPPORTED_IMPORT_SOURCES.find((option) => option.source === source)?.label ?? source
}

function getIncomeBreakdownConfig(item: ImportItem): {
  paymentMethod: PaymentMethod
  categories: IncomeCategory[]
  defaultCategory: IncomeCategory
  label: string
} {
  if (item.source === "stripe_csv" || item.source === "square_csv") {
    return paymentCategoryConfig.posSales
  }

  if (item.source === "venmo_csv") {
    return paymentCategoryConfig.venmo
  }

  return {
    paymentMethod: "other",
    categories: ["services", "tips", "products", "other"],
    defaultCategory: "services",
    label: "Imported income",
  }
}

function createInitialIncomeBreakdown(item: ImportItem): BreakdownDraft {
  const amount = Math.max(0, Number(item.amount ?? 0))
  const config = getIncomeBreakdownConfig(item)

  if (amount <= 0) {
    return emptyBreakdownDraft()
  }

  return {
    ...emptyBreakdownDraft(),
    selected: [config.defaultCategory],
    [config.defaultCategory]: amount.toFixed(2),
  }
}

export default function VenmoImportPanel() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const importsEntry = useImportsStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const entries = useEntriesStore((state) =>
    activeWorkspaceId
      ? state.byWorkspaceId[activeWorkspaceId]?.entries ?? EMPTY_ENTRIES
      : EMPTY_ENTRIES
  )
  const expenses = useExpensesStore((state) =>
    activeWorkspaceId
      ? state.byWorkspaceId[activeWorkspaceId]?.expenses ?? EMPTY_EXPENSES
      : EMPTY_EXPENSES
  )
  const createBatch = useImportsStore((state) => state.createBatch)
  const refreshBatches = useImportsStore((state) => state.refreshBatches)
  const refreshItems = useImportsStore((state) => state.refreshItems)
  const updateItem = useImportsStore((state) => state.updateItem)
  const hydrateExpenseMemoryStore = useExpenseMemoryStore(
    (state) => state.hydrateFromStorageOnce
  )
  const updateExpenseMemory = useExpenseMemoryStore(
    (state) => state.updateFromExpense
  )
  const getAccountForVendor = useExpenseMemoryStore(
    (state) => state.getAccountForVendor
  )

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] =
    useState<SupportedImportSource>("venmo_csv")
  const [uploading, setUploading] = useState(false)
  const [workingItemId, setWorkingItemId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bulkExpenseCategory, setBulkExpenseCategory] = useState<string>("")
  const [expenseCategoriesByItemId, setExpenseCategoriesByItemId] = useState<
    Record<string, string>
  >({})
  const [incomeBreakdownsByItemId, setIncomeBreakdownsByItemId] = useState<
    Record<string, BreakdownDraft>
  >({})
  const [editingIncomeItemId, setEditingIncomeItemId] = useState<string | null>(
    null
  )
  const [expanded, setExpanded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stateSummaryRef = useRef<string | null>(null)

  const batches = importsEntry?.batches ?? EMPTY_BATCHES
  const reviewableBatches = useMemo(
    () => batches.filter((batch) => batch.pendingCount > 0),
    [batches]
  )
  const reviewableBatchIds = useMemo(
    () => reviewableBatches.map((batch) => batch.id).join("|"),
    [reviewableBatches]
  )

  useEffect(() => {
    debugLog("venmo-import-panel", "refresh_batches_effect", {
      summary: `workspace=${activeWorkspaceId ?? "none"} type=${activeWorkspace?.type ?? "none"}`,
      workspaceId: activeWorkspaceId,
      workspaceType: activeWorkspace?.type ?? null,
    })
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    void refreshBatches(activeWorkspaceId)
  }, [activeWorkspaceId, activeWorkspace?.type, refreshBatches])

  useEffect(() => {
    debugLog("venmo-import-panel", "hydrate_expense_memory_effect", {
      summary: "hydrate_expense_memory",
    })
    hydrateExpenseMemoryStore()
  }, [hydrateExpenseMemoryStore])

  useEffect(() => {
    debugLog("venmo-import-panel", "selected_batch_effect", {
      summary: `reviewable=${reviewableBatches.map((batch) => batch.id).join(",") || "none"} current=${selectedBatchId ?? "none"}`,
      reviewableBatchIds,
      currentSelectedBatchId: selectedBatchId,
    })
    if (!reviewableBatches.length) {
      setSelectedBatchId((current) => {
        const next = current === null ? current : null
        debugLog("venmo-import-panel", "selected_batch_effect_apply", {
          summary: `reason=empty_reviewable previous=${current ?? "none"} next=${next ?? "none"}`,
          previousSelectedBatchId: current,
          nextSelectedBatchId: next,
        })
        return next
      })
      return
    }
    setSelectedBatchId((current) => {
      if (current && reviewableBatches.some((batch) => batch.id === current)) {
        debugLog("venmo-import-panel", "selected_batch_effect_apply", {
          summary: `reason=keep_existing previous=${current} next=${current}`,
          previousSelectedBatchId: current,
          nextSelectedBatchId: current,
        })
        return current
      }
      const next = reviewableBatches[0].id
      debugLog("venmo-import-panel", "selected_batch_effect_apply", {
        summary: `reason=select_first previous=${current ?? "none"} next=${next}`,
        previousSelectedBatchId: current,
        nextSelectedBatchId: next,
      })
      return next
    })
  }, [reviewableBatchIds, reviewableBatches, selectedBatchId])

  const hasSelectedBatchItems = selectedBatchId
    ? Boolean(importsEntry?.itemsByBatchId?.[selectedBatchId])
    : false

  useEffect(() => {
    debugLog("venmo-import-panel", "refresh_items_effect", {
      summary: `workspace=${activeWorkspaceId ?? "none"} batch=${selectedBatchId ?? "none"} hasItems=${hasSelectedBatchItems}`,
      workspaceId: activeWorkspaceId,
      selectedBatchId,
      hasSelectedBatchItems,
    })
    if (!activeWorkspaceId || !selectedBatchId || hasSelectedBatchItems) return
    void refreshItems(activeWorkspaceId, selectedBatchId)
  }, [activeWorkspaceId, selectedBatchId, hasSelectedBatchItems, refreshItems])

  const selectedBatch: ImportBatch | null = useMemo(
    () => reviewableBatches.find((batch) => batch.id === selectedBatchId) ?? null,
    [reviewableBatches, selectedBatchId]
  )

  const selectedItems = selectedBatchId
    ? importsEntry?.itemsByBatchId?.[selectedBatchId] ?? EMPTY_ITEMS
    : EMPTY_ITEMS

  const pendingItems = selectedItems.filter(
    (item) => item.status === "pending" || item.status === "needs_review"
  )
  const pendingIncomeItems = pendingItems.filter((item) => item.kind !== "expense")
  const pendingExpenseItems = pendingItems.filter((item) => item.kind === "expense")
  const renderSummary = [
    `workspace=${activeWorkspaceId ?? "none"}`,
    `status=${importsEntry?.status ?? "idle"}`,
    `batches=${batches.length}`,
    `reviewable=${reviewableBatches.length}`,
    `selectedBatch=${selectedBatchId ?? "none"}`,
    `selectedItems=${selectedItems.length}`,
    `pending=${pendingItems.length}`,
    `expanded=${expanded}`,
    `editingIncome=${editingIncomeItemId ?? "none"}`,
  ].join(" | ")

  debugRender("venmo-import-panel", {
    summary: renderSummary,
    workspaceId: activeWorkspaceId,
    workspaceType: activeWorkspace?.type ?? null,
    importsStatus: importsEntry?.status ?? "idle",
    batchesCount: batches.length,
    reviewableBatchCount: reviewableBatches.length,
    selectedBatchId,
    selectedItemsCount: selectedItems.length,
    pendingItemsCount: pendingItems.length,
    expanded,
  })

  useEffect(() => {
    if (stateSummaryRef.current === renderSummary) return
    debugLog("venmo-import-panel", "render_summary_changed", {
      previousSummary: stateSummaryRef.current,
      nextSummary: renderSummary,
    })
    stateSummaryRef.current = renderSummary
  }, [renderSummary])

  useEffect(() => {
    debugLog("venmo-import-panel", "auto_expand_effect", {
      summary: `pending=${pendingItems.length} expanded=${expanded}`,
      pendingItemsCount: pendingItems.length,
      expanded,
    })
    if (pendingItems.length > 0 && !expanded) {
      debugLog("venmo-import-panel", "auto_expand_pending_items", {
        pendingItemsCount: pendingItems.length,
      })
      setExpanded(true)
    }
  }, [pendingItems.length, expanded])

  useEffect(() => {
    debugLog("venmo-import-panel", "editing_income_cleanup_effect", {
      summary: `editingIncome=${editingIncomeItemId ?? "none"} pendingIds=${pendingItems.map((item) => item.id).join(",") || "none"}`,
      editingIncomeItemId,
      pendingItemIds: pendingItems.map((item) => item.id),
    })
    if (
      editingIncomeItemId &&
      !pendingItems.some((item) => item.id === editingIncomeItemId)
    ) {
      debugLog("venmo-import-panel", "editing_income_cleanup_apply", {
        summary: `clearing=${editingIncomeItemId}`,
        editingIncomeItemId,
      })
      setEditingIncomeItemId(null)
    }
  }, [editingIncomeItemId, pendingItems])

  useEffect(() => {
    debugLog("venmo-import-panel", "local_state_changed", {
      summary: `selectedBatch=${selectedBatchId ?? "none"} expanded=${expanded} editingIncome=${editingIncomeItemId ?? "none"} message=${message ? "set" : "empty"} error=${error ? "set" : "empty"} working=${workingItemId ?? "none"}`,
      selectedBatchId,
      expanded,
      editingIncomeItemId,
      hasMessage: Boolean(message),
      hasError: Boolean(error),
      workingItemId,
    })
  }, [
    editingIncomeItemId,
    error,
    expanded,
    message,
    selectedBatchId,
    workingItemId,
  ])

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !activeWorkspaceId) return

    setUploading(true)
    setError(null)
    setMessage(null)

    try {
      const text = await file.text()
      const payload = parseImportCsvBySource(selectedSource, file.name, text)
      debugLog("venmo-import-panel", "import_payload_preflight", {
        workspaceId: activeWorkspaceId,
        selectedSource,
        batchSource: payload.batch.source,
        itemCount: payload.items.length,
        distinctItemSources: Array.from(
          new Set(payload.items.map((item) => item.source))
        ),
        firstItemSources: payload.items.slice(0, 10).map((item) => item.source),
      })
      const batch = await createBatch(activeWorkspaceId, payload)
      setExpanded(true)
      setSelectedBatchId(batch.id)
      setMessage(`Imported ${payload.items.length} transactions for review.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import this CSV.")
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  async function markPersonal(item: ImportItem) {
    if (!activeWorkspaceId || !selectedBatchId) return
    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)
    try {
      await updateItem(activeWorkspaceId, selectedBatchId, item.id, {
        status: "rejected",
        userDecision: {
          isBusiness: false,
          finalKind: item.kind === "expense" ? "expense" : "income",
        },
        completion: {
          missingFields: [],
          readyToCommit: false,
        },
      })
      setMessage("Transaction marked as personal.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update import item.")
    } finally {
      setWorkingItemId(null)
    }
  }

  async function markAllPendingPersonal() {
    if (!activeWorkspaceId || !selectedBatchId || pendingItems.length === 0) return
    setWorkingItemId("bulk-personal")
    setError(null)
    setMessage(null)
    try {
      for (const item of pendingItems) {
        await updateItem(activeWorkspaceId, selectedBatchId, item.id, {
          status: "rejected",
          userDecision: {
            isBusiness: false,
            finalKind: item.kind === "expense" ? "expense" : "income",
          },
          completion: {
            missingFields: [],
            readyToCommit: false,
          },
        })
      }
      setMessage(`Marked ${pendingItems.length} pending transactions as personal.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pending items.")
    } finally {
      setWorkingItemId(null)
    }
  }

  function openIncomeEditor(item: ImportItem) {
    setIncomeBreakdownsByItemId((current) => ({
      ...current,
      [item.id]: current[item.id] ?? createInitialIncomeBreakdown(item),
    }))
    setEditingIncomeItemId(item.id)
    setError(null)
    setMessage(null)
  }

  function toggleIncomeBreakdownCategory(
    item: ImportItem,
    category: IncomeCategory,
    checked: boolean
  ) {
    const config = getIncomeBreakdownConfig(item)
    setIncomeBreakdownsByItemId((current) => {
      const draft = current[item.id] ?? createInitialIncomeBreakdown(item)
      const selected = checked
        ? [...draft.selected, category]
        : draft.selected.filter((value) => value !== category)

      return {
        ...current,
        [item.id]: rebalanceBreakdownDraft(
          {
            ...draft,
            selected,
            [category]: checked ? draft[category] : "",
          },
          Math.max(0, Number(item.amount ?? 0)),
          config.categories,
          checked ? category : undefined
        ),
      }
    })
  }

  function updateIncomeBreakdownAmount(
    item: ImportItem,
    category: IncomeCategory,
    value: string
  ) {
    const config = getIncomeBreakdownConfig(item)
    setIncomeBreakdownsByItemId((current) => {
      const draft = current[item.id] ?? createInitialIncomeBreakdown(item)
      return {
        ...current,
        [item.id]: rebalanceBreakdownDraft(
          {
            ...draft,
            [category]: value,
          },
          Math.max(0, Number(item.amount ?? 0)),
          config.categories,
          category
        ),
      }
    })
  }

  async function commitIncomeItem(item: ImportItem) {
    if (!activeWorkspaceId || !selectedBatchId) return

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    try {
      const amount = Number(item.amount ?? 0)
      const occurredAt = item.occurredAt
      if (!occurredAt || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("This income item is missing a usable date or amount.")
      }

      const draft =
        incomeBreakdownsByItemId[item.id] ?? createInitialIncomeBreakdown(item)
      const config = getIncomeBreakdownConfig(item)
      const selectedCategories = draft.selected.filter((category) =>
        config.categories.includes(category)
      )

      if (selectedCategories.length === 0) {
        throw new Error("Select the relevant categories before saving.")
      }

      if (Math.abs(draftSum(draft) - amount) > 0.009) {
        throw new Error(
          `${config.label} category amounts must add up to ${formatCurrency(amount)}.`
        )
      }

      const incomeBreakdown = {
        paymentMethod: config.paymentMethod,
        services: selectedCategories.includes("services")
          ? parseMoney(draft.services)
          : undefined,
        tips: selectedCategories.includes("tips") ? parseMoney(draft.tips) : undefined,
        products: selectedCategories.includes("products")
          ? parseMoney(draft.products)
          : undefined,
        other: selectedCategories.includes("other")
          ? parseMoney(draft.other)
          : undefined,
      }

      const entry = await entriesService.createEntry(activeWorkspaceId, {
        workspace: "independent",
        date: occurredAt,
        notes: [
          item.description,
          item.counterparty ? `Counterparty: ${item.counterparty}` : null,
          `Imported from ${formatSourceLabel(item.source as SupportedImportSource)}`,
        ]
          .filter(Boolean)
          .join(" | "),
        independent: {
          hours: 0,
          incomeBreakdowns: [incomeBreakdown],
          unreportedCash: 0,
          unreportedCashTips: 0,
          customIncome: [],
        },
      })

      await updateItem(activeWorkspaceId, selectedBatchId, item.id, {
        status: "committed",
        suggestedIncomeCategory: selectedCategories[0],
        userDecision: {
          isBusiness: true,
          finalKind: "income",
        },
        completion: {
          missingFields: [],
          readyToCommit: true,
        },
        committedEntryId: entry.id,
      })

      setIncomeBreakdownsByItemId((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      setEditingIncomeItemId((current) =>
        current === item.id ? null : current
      )
      setMessage("Saved imported income entry.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save imported income.")
    } finally {
      setWorkingItemId(null)
    }
  }

  function getSelectedExpenseCategory(item: ImportItem): string {
    return (
      expenseCategoriesByItemId[item.id] || item.suggestedExpenseAccount || ""
    )
  }

  async function commitExpenseItem(item: ImportItem) {
    if (!activeWorkspaceId || !selectedBatchId) return

    const expenseCategory = getSelectedExpenseCategory(item)
    if (!expenseCategory) {
      setError("Choose an expense category before saving this transaction.")
      return
    }

    setWorkingItemId(item.id)
    setError(null)
    setMessage(null)

    try {
      const amount = Number(item.amount ?? 0)
      const occurredAt = item.occurredAt
      if (!occurredAt || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("This expense item is missing a usable date or amount.")
      }

      const expense = await expensesService.createExpense(activeWorkspaceId, {
        date: occurredAt,
        amount,
        vendor: item.counterparty || item.description || "Imported expense",
        description:
          item.description ||
          item.counterparty ||
          `Imported from ${formatSourceLabel(item.source as SupportedImportSource)}`,
        account: expenseCategory,
        periodId: occurredAt.slice(0, 7),
        calculationMethod: "manual",
      })

      await updateItem(activeWorkspaceId, selectedBatchId, item.id, {
        status: "committed",
        suggestedExpenseAccount: expenseCategory,
        userDecision: {
          isBusiness: true,
          finalKind: "expense",
        },
        completion: {
          missingFields: [],
          readyToCommit: true,
        },
        committedExpenseId: expense.id,
      })

      updateExpenseMemory({
        vendor: item.counterparty || item.description || "",
        description: item.description || item.counterparty || "",
        account: expenseCategory,
      })

      setMessage("Saved imported transaction as a business expense.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save imported expense.")
    } finally {
      setWorkingItemId(null)
    }
  }

  async function saveAllPendingExpensesAs(category: string) {
    if (!pendingExpenseItems.length) return
    setWorkingItemId("bulk-expense")
    setError(null)
    setMessage(null)
    try {
      setExpenseCategoriesByItemId((current) => {
        const next = { ...current }
        for (const item of pendingExpenseItems) {
          next[item.id] = category
        }
        return next
      })
      for (const item of pendingExpenseItems) {
        if (findDuplicateExpense(item, expenses)) {
          continue
        }
        const expenseCategory = category
        const amount = Number(item.amount ?? 0)
        const occurredAt = item.occurredAt
        if (!occurredAt || !Number.isFinite(amount) || amount <= 0) {
          continue
        }
        const expense = await expensesService.createExpense(activeWorkspaceId!, {
          date: occurredAt,
          amount,
          vendor: item.counterparty || item.description || "Imported expense",
          description:
            item.description ||
            item.counterparty ||
            `Imported from ${formatSourceLabel(item.source as SupportedImportSource)}`,
          account: expenseCategory,
          periodId: occurredAt.slice(0, 7),
          calculationMethod: "manual",
        })
        await updateItem(activeWorkspaceId!, selectedBatchId!, item.id, {
          status: "committed",
          suggestedExpenseAccount: expenseCategory,
          userDecision: {
            isBusiness: true,
            finalKind: "expense",
          },
          completion: {
            missingFields: [],
            readyToCommit: true,
          },
          committedExpenseId: expense.id,
        })
        updateExpenseMemory({
          vendor: item.counterparty || item.description || "",
          description: item.description || item.counterparty || "",
          account: expenseCategory,
        })
      }
      setMessage("Processed pending expense items.")
    } finally {
      setWorkingItemId(null)
    }
  }

  if (activeWorkspace?.type !== "independent" || !activeWorkspaceId) {
    return null
  }

  return (
    <div className="rounded-xl border border-border/80 px-5 py-4">
      <button
        type="button"
        className="text-left text-base font-semibold text-emerald-600 transition hover:text-emerald-500 dark:text-emerald-300 dark:hover:text-emerald-200"
        onClick={() => setExpanded((current) => !current)}
      >
        Import Transactions
      </button>
      {expanded ? (
      <div className="mt-3 space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload CSVs to review business income and expenses before saving them.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Select
            value={selectedSource}
            onValueChange={(value) =>
              setSelectedSource(value as SupportedImportSource)
            }
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Choose import source" />
            </SelectTrigger>
            <SelectContent>
              {VISIBLE_IMPORT_SOURCES.map((option) => (
                <SelectItem key={option.source} value={option.source}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Importing..." : "Upload CSV"}
          </Button>
          {selectedBatch ? (
            <Badge variant="outline">{selectedBatch.pendingCount} pending</Badge>
          ) : null}
          {selectedBatch ? (
            <Badge variant="secondary">{selectedBatch.committedCount} saved</Badge>
          ) : null}
        </div>

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {selectedBatch && pendingItems.length > 0 ? (
          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">Batch Actions</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void markAllPendingPersonal()}
                disabled={workingItemId !== null}
              >
                Mark All Pending Personal
              </Button>
              {pendingExpenseItems.length > 0 ? (
                <>
                  <Select
                    value={bulkExpenseCategory}
                    onValueChange={setBulkExpenseCategory}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Expense category" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void saveAllPendingExpensesAs(bulkExpenseCategory)}
                    disabled={workingItemId !== null || !bulkExpenseCategory}
                  >
                    Save All Expenses
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {reviewableBatches.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {reviewableBatches.map((batch) => (
              <Button
                key={batch.id}
                type="button"
                variant={batch.id === selectedBatchId ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                {batch.label}
              </Button>
            ))}
          </div>
        ) : null}

        {!selectedBatch ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No pending imports. Upload a CSV to start reviewing transactions.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              Reviewing <span className="font-medium">{selectedBatch.label}</span> with{" "}
              <span className="font-medium">{selectedBatch.itemCount}</span> imported transactions.
            </div>

            {pendingItems.length === 0 ? (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                No pending items in this batch. Upload another file or switch batches above.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingItems.map((item) => {
                  const duplicateIncome =
                    item.kind !== "expense"
                      ? findDuplicateIncomeEntry(item, entries)
                      : null
                  const duplicateExpense =
                    item.kind === "expense"
                      ? findDuplicateExpense(item, expenses)
                      : null
                  const duplicate = duplicateIncome || duplicateExpense
                  const suggestedExpenseCategory =
                    item.kind === "expense"
                      ? getSuggestedExpenseCategoryForImport(
                          item,
                          getAccountForVendor
                        )
                      : ""
                  const incomeDraft =
                    incomeBreakdownsByItemId[item.id] ??
                    createInitialIncomeBreakdown(item)
                  const incomeConfig = getIncomeBreakdownConfig(item)
                  const isEditingIncome = editingIncomeItemId === item.id

                  return (
                  <div key={item.id} className="rounded-xl border p-4">
                    {duplicate ? (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <Badge variant="outline">Possible duplicate</Badge>
                        <span>
                          A matching {item.kind === "expense" ? "expense" : "entry"} already exists for this date and amount.
                        </span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {item.description || "Imported transaction"}
                          </p>
                          <Badge variant={statusVariant(item.status)}>
                            {item.status}
                          </Badge>
                          <Badge variant="outline">
                            {formatSourceLabel(item.source as SupportedImportSource)}
                          </Badge>
                          <Badge variant="outline">{item.kind}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatOccurredAt(item.occurredAt)}
                          {item.counterparty ? ` • ${item.counterparty}` : ""}
                        </p>
                        {item.parseWarnings.length > 0 ? (
                          <p className="text-xs text-amber-700">
                            {item.parseWarnings.join(" • ")}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-base font-semibold">
                        {formatCurrency(item.amount ?? 0)}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => markPersonal(item)}
                        disabled={workingItemId === item.id}
                      >
                        <X className="h-4 w-4" />
                        Personal
                      </Button>

                      {item.kind === "expense" ? (
                        <>
                          <Select
                            value={
                              getSelectedExpenseCategory(item) ||
                              suggestedExpenseCategory
                            }
                            onValueChange={(value) =>
                              setExpenseCategoriesByItemId((current) => ({
                                ...current,
                                [item.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger className="w-[220px]">
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
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => commitExpenseItem(item)}
                            disabled={
                              workingItemId === item.id ||
                              findDuplicateExpense(item, expenses) != null
                            }
                          >
                            <Check className="h-4 w-4" />
                            Save as Expense
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => openIncomeEditor(item)}
                          disabled={
                            workingItemId === item.id ||
                            findDuplicateIncomeEntry(item, entries) != null
                          }
                        >
                          <Check className="h-4 w-4" />
                          {isEditingIncome ? "Editing Split" : "Save as Business"}
                        </Button>
                      )}
                    </div>

                    {item.kind !== "expense" && isEditingIncome ? (
                      <div className="mt-4 space-y-3 rounded-lg border bg-muted/20 p-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            Select the relevant categories
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Choose one or more categories, then adjust the
                            amounts. The remaining selected category will
                            auto-balance to match the imported total.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {incomeConfig.categories.map((category) => (
                            <label
                              key={`${item.id}-${category}`}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={incomeDraft.selected.includes(category)}
                                onCheckedChange={(checked) =>
                                  toggleIncomeBreakdownCategory(
                                    item,
                                    category,
                                    checked === true
                                  )
                                }
                              />
                              <span>{categoryLabels[category]}</span>
                            </label>
                          ))}
                        </div>

                        {incomeDraft.selected.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {incomeConfig.categories
                              .filter((category) =>
                                incomeDraft.selected.includes(category)
                              )
                              .map((category) => (
                                <div key={`${item.id}-${category}-amount`}>
                                  <Label htmlFor={`${item.id}-${category}`}>
                                    {categoryLabels[category]} Amount
                                  </Label>
                                  <Input
                                    id={`${item.id}-${category}`}
                                    type="number"
                                    step="0.01"
                                    value={incomeDraft[category]}
                                    onChange={(event) =>
                                      updateIncomeBreakdownAmount(
                                        item,
                                        category,
                                        event.target.value
                                      )
                                    }
                                  />
                                </div>
                              ))}
                          </div>
                        ) : null}

                        <p className="text-xs text-muted-foreground">
                          Category split: {formatCurrency(draftSum(incomeDraft))} of{" "}
                          {formatCurrency(Number(item.amount ?? 0))}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => commitIncomeItem(item)}
                            disabled={
                              workingItemId === item.id ||
                              findDuplicateIncomeEntry(item, entries) != null
                            }
                          >
                            <Check className="h-4 w-4" />
                            Save Entry
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingIncomeItemId(null)}
                            disabled={workingItemId === item.id}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )})}
              </div>
            )}
          </div>
        )}
      </div>
      ) : null}
    </div>
  )
}
