"use client"

import { useEffect, useMemo, useState } from "react"
import { ReceiptText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import ReceiptThumbnail from "@/components/receipt-thumbnail"
import ReceiptViewerTrigger from "@/components/receipt-viewer-trigger"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useReceiptDraftsStore } from "@/lib/stores/useReceiptDraftsStore"
import * as expenseRepository from "@/lib/domain/expenseRepository"
import { getCalendarMonthBucketFromDate } from "@shared/payPeriods"
import type { ReceiptDraft } from "@shared/schemas/receiptDraft"

function getCurrentMonthValue(): string {
  return getCalendarMonthBucketFromDate(new Date())
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const plainDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (plainDate) {
    const parsed = new Date(
      Number(plainDate[1]),
      Number(plainDate[2]) - 1,
      Number(plainDate[3])
    )
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function getReceiptLifecycleLabel(item: ReceiptDraft): string {
  if (item.status === "committed") return "Saved to expense"
  if (item.status === "dismissed") return "Dismissed"
  if (item.analysisStatus === "analyzing") {
    return "Analyzing"
  }
  if (item.completion.readyToCommit) return "Ready to review"
  return "Draft"
}

export default function ReceiptsLibrary() {
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthValue)
  const [monthExpenses, setMonthExpenses] = useState<any[]>([])
  const [expensesLoading, setExpensesLoading] = useState(false)
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const receiptDraftsEntry = useReceiptDraftsStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const hydrateDraftsFromCacheOnce = useReceiptDraftsStore(
    (state) => state.hydrateFromCacheOnce
  )
  const refreshDrafts = useReceiptDraftsStore((state) => state.refreshFromBackend)

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    void hydrateDraftsFromCacheOnce(activeWorkspaceId)
  }, [activeWorkspaceId, activeWorkspace?.type, hydrateDraftsFromCacheOnce])

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    void refreshDrafts(activeWorkspaceId, { force: false })
  }, [activeWorkspaceId, activeWorkspace?.type, refreshDrafts])

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    let canceled = false
    setExpensesLoading(true)

    void (async () => {
      try {
        const cached = await expenseRepository.readCachedSnapshot(
          activeWorkspaceId,
          selectedMonth
        )
        if (canceled) return

        const hasCachedSnapshot =
          cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null

        if (hasCachedSnapshot) {
          setMonthExpenses(cached.data)
          setExpensesLoading(false)
        }

        const resolved = await expenseRepository.ensureLoaded(
          activeWorkspaceId,
          selectedMonth,
          { forceBackend: true }
        )
        if (canceled) return

        setMonthExpenses(resolved.data)
      } catch {
        if (canceled) return
        setMonthExpenses([])
      } finally {
        if (canceled) return
        setExpensesLoading(false)
      }
    })()

    return () => {
      canceled = true
    }
  }, [activeWorkspaceId, activeWorkspace?.type, selectedMonth])

  const draftsByReceiptAssetId = useMemo(() => {
    return new Map(
      (receiptDraftsEntry?.drafts ?? [])
        .filter((draft) => typeof draft.receiptAssetId === "string" && draft.receiptAssetId.length > 0)
        .map((draft) => [draft.receiptAssetId, draft])
    )
  }, [receiptDraftsEntry?.drafts])

  const draftsByCommittedExpenseId = useMemo(() => {
    return new Map(
      (receiptDraftsEntry?.drafts ?? [])
        .filter(
          (draft) =>
            typeof draft.committedExpenseId === "string" &&
            draft.committedExpenseId.length > 0
        )
        .map((draft) => [draft.committedExpenseId as string, draft])
    )
  }, [receiptDraftsEntry?.drafts])

  const visibleReceipts = useMemo(() => {
    return [...monthExpenses]
      .filter(
        (expense) =>
          typeof expense.receiptAssetId === "string" &&
          expense.receiptAssetId.length > 0 &&
          typeof expense.date === "string" &&
          expense.date.startsWith(`${selectedMonth}-`)
      )
      .sort((left, right) => {
        const leftTs = Date.parse(left.updatedAt || left.createdAt || left.date || "")
        const rightTs = Date.parse(right.updatedAt || right.createdAt || right.date || "")
        return rightTs - leftTs
      })
      .map((expense) => {
        const draft =
          draftsByCommittedExpenseId.get(expense.id) ??
          draftsByReceiptAssetId.get(expense.receiptAssetId)

        return {
          expense,
          draft,
        }
      })
  }, [draftsByCommittedExpenseId, draftsByReceiptAssetId, monthExpenses, selectedMonth])

  const monthLabel = useMemo(() => {
    const [year, month] = selectedMonth.split("-")
    const parsed = new Date(Number(year), Number(month) - 1, 1)
    return parsed.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })
  }, [selectedMonth])

  if (activeWorkspace?.type !== "independent" || !activeWorkspaceId) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Receipts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Receipts attached to expenses appear here. To add a receipt, attach one when creating an expense.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <Badge variant="outline">{visibleReceipts.length} receipts</Badge>
          </div>
        </div>
      </div>

      {expensesLoading ? (
        <div className="rounded-xl border border-dashed border-border/80 px-5 py-8 text-center text-sm text-muted-foreground">
          Loading receipts for {monthLabel}...
        </div>
      ) : visibleReceipts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-5 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <ReceiptText className="h-6 w-6" />
          </div>
          <p className="mt-4 text-base font-medium text-foreground">No receipts for {monthLabel}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a receipt by creating an expense and using the &quot;Attach Receipt&quot; option.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleReceipts.map(({ expense, draft }) => {
            const merchant =
              expense.vendor ||
              draft?.counterparty ||
              draft?.description ||
              draft?.receiptAsset?.fileName ||
              "Receipt"
            const savedCategory = expense.account ?? draft?.suggestedExpenseAccount ?? null
            const occurredAtLabel = formatDate(expense.date || draft?.occurredAt)

            return (
              <div
                key={expense.id}
                className="rounded-xl border border-border/80 bg-card px-5 py-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-medium text-foreground">{merchant}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {savedCategory
                        ? `Saved to ${savedCategory}`
                        : draft
                          ? getReceiptLifecycleLabel(draft)
                          : "Saved to expense"}
                    </p>
                    {occurredAtLabel ? (
                      <p className="text-sm text-muted-foreground">{occurredAtLabel}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <ReceiptThumbnail
                      workspaceId={activeWorkspaceId}
                      receiptAssetId={expense.receiptAssetId}
                      asset={draft?.receiptAsset}
                      alt={draft?.receiptAsset?.fileName || "Receipt preview"}
                    />
                    {expense.receiptAssetId ? (
                      <ReceiptViewerTrigger
                        workspaceId={activeWorkspaceId}
                        receiptAssetId={expense.receiptAssetId}
                        asset={draft?.receiptAsset}
                        title={merchant}
                        variant="outline"
                        label="View receipt"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
