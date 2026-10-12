//expenses grid

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { MessageCircle, MoreVertical } from "lucide-react"
import {
  useExpensesData,
  useExpensesRenderState,
} from "@/lib/stores/useExpensesStore"
import { useSettingsData } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { formatCurrency, parseLocalDate } from "@/lib/helpers"
import { thBase, tdBase } from "@/lib/tableStyles"
import { cn } from "@/lib/utils"
import AttachReceiptDialog from "@/components/attach-receipt-dialog"
import { useExpenseFocusStore } from "@/lib/stores/useExpenseFocusStore"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import { GridSkeleton } from "@/components/loading-skeletons"
import { needsReceiptForAuditDefense, RECEIPT_REQUIRED_THRESHOLD } from "@shared/receiptRequirements"
import {
  ExpenseDetails,
  ExpenseFieldEditor,
  deleteExpenseWithConfirm,
  expenseNeedsAttention,
  type EditableExpenseField,
} from "@/components/expense-cell-editors"

const formatShortDate = (iso: string) =>
  parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

function getEditableCellClasses(armed: boolean, alignment: "center" | "right" = "center") {
  return cn(
    "w-full rounded-md px-0.5 py-1 transition-colors focus:outline-none",
    alignment === "right" ? "text-right" : "text-center",
    armed
      ? "bg-emerald-100 text-foreground ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:ring-emerald-400/50"
      : "hover:bg-accent"
  )
}

export default function ExpensesGrid() {
  const gridRootRef = useRef<HTMLDivElement>(null)
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspaceId =
    workspaceState.status === "ready"
      ? workspaceState.activeWorkspaceId
      : null
  const activeWorkspaceType =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace.type : null
  const expenses = useExpensesData(activeWorkspaceId)
  const {
    isHydrating: expensesHydrating,
    isRevalidating: expensesRevalidating,
    lastSuccessfulSyncAt: expensesLastSuccessfulSyncAt,
  } = useExpensesRenderState(activeWorkspaceId)
  const settings = useSettingsData(activeWorkspaceId)

  // Which editor is open. The editors (expense-cell-editors.tsx, shared with
  // the home page's expense categories) hold their own input values.
  const [popoverState, setPopoverState] = useState<{
    id: string
    field: EditableExpenseField
  } | null>(null)
  const [armedCell, setArmedCell] = useState<{
    id: string
    field: EditableExpenseField
  } | null>(null)
  const [attachReceiptExpenseId, setAttachReceiptExpenseId] = useState<string | null>(null)
  const [notesPopoverExpenseId, setNotesPopoverExpenseId] = useState<string | null>(null)

  const customExpenseCategories =
    settings?.independent?.customExpenseCategories ?? []
  const hasRenderableExpenses =
    expenses.length > 0 || expensesLastSuccessfulSyncAt !== null

  const openEditor = useCallback((id: string, field: EditableExpenseField) => {
    setArmedCell(null)
    setPopoverState({ id, field })
  }, [])

  const closeEditor = useCallback(() => setPopoverState(null), [])

  const armOrOpenEditor = useCallback(
    (id: string, field: EditableExpenseField) => {
      if (armedCell?.id === id && armedCell.field === field) {
        openEditor(id, field)
        return
      }

      setPopoverState(null)
      setArmedCell({ id, field })
    },
    [armedCell, openEditor]
  )

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (
        target.closest('[data-expenses-grid-root="true"]') ||
        target.closest('[data-grid-popover="expenses"]')
      ) {
        return
      }

      setArmedCell(null)
      setPopoverState(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setArmedCell(null)
      setPopoverState(null)
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  // Wires a shared editor to the grid's arm-then-open taps.
  const editorProps = (expense: any, field: EditableExpenseField, className: string) => ({
    expense,
    field,
    customExpenseCategories,
    workspaceType: activeWorkspaceType,
    independentSettings: settings?.independent ?? null,
    workspaceId: activeWorkspaceId,
    isOpen: !!popoverState && popoverState.id === expense.id && popoverState.field === field,
    onClose: closeEditor,
    onTriggerClick: () => armOrOpenEditor(expense.id, field),
    onSaved: closeEditor,
    triggerClassName: className,
  })

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [expenses]
  )

  // "View expense" (useExpenseFocusStore): once the row is rendered, scroll
  // to it and flash it briefly. Waits a tick so AllRecordsSection has
  // un-hidden the grid before scrolling.
  const highlightExpenseId = useExpenseFocusStore((s) => s.highlightExpenseId)
  const [flashExpenseId, setFlashExpenseId] = useState<string | null>(null)
  useEffect(() => {
    if (!highlightExpenseId || !sorted.some((e) => e.id === highlightExpenseId)) return
    const scrollTimer = window.setTimeout(() => {
      const row = gridRootRef.current?.querySelector(
        `[data-expense-id="${CSS.escape(highlightExpenseId)}"]`
      )
      row?.scrollIntoView({ behavior: "smooth", block: "center" })
      setFlashExpenseId(highlightExpenseId)
      useExpenseFocusStore.getState().setHighlight(null)
    }, 150)
    return () => window.clearTimeout(scrollTimer)
  }, [highlightExpenseId, sorted])
  useEffect(() => {
    if (!flashExpenseId) return
    const clearTimer = window.setTimeout(() => setFlashExpenseId(null), 2500)
    return () => window.clearTimeout(clearTimer)
  }, [flashExpenseId])

  const totalAmount = useMemo(() => {
    return sorted.reduce((acc, e) => acc + (e.amount ?? 0), 0)
  }, [sorted])

  if (workspaceState.status !== "ready" || (expensesHydrating && !hasRenderableExpenses)) {
    return <GridSkeleton label="Loading expenses…" />
  }

  return (
    <div
      ref={gridRootRef}
      data-expenses-grid-root="true"
      className="relative overflow-hidden rounded-lg border bg-card shadow-sm"
    >
      <SyncStatusIndicator visible={expensesRevalidating} label="Syncing expenses" />

      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="min-w-[26rem] w-full table-fixed border-separate border-spacing-0 border border-border divide-y divide-border sm:min-w-full">
          <thead className="sticky top-0 bg-muted border-b border-border">
            <tr className="divide-x divide-border">
              <th className={`${thBase} w-8 text-center`}></th>
              <th className={`${thBase} w-[3.75rem] text-center`}>Date</th>
              <th className={`${thBase} w-[6.5rem] text-center`}>Vendor</th>
              <th className={`${thBase} w-[5.25rem] text-center`}>Amount</th>
              <th className={`${thBase} w-[7.75rem] text-center`}>Category</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-300">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center text-muted-foreground py-8 border border-border"
                >
                  No expenses yet.
                </td>
              </tr>
            ) : (
              sorted.map((e, index) => (
                <tr
                  key={
                    e.id ??
                    `${e.date ?? "no-date"}-${e.vendor ?? "no-vendor"}-${e.amount ?? 0}-${index}`
                  }
                  data-expense-id={e.id}
                  className={cn(
                    "divide-x divide-border transition-colors duration-700",
                    flashExpenseId != null && flashExpenseId === e.id
                      ? "bg-emerald-100 dark:bg-emerald-500/15"
                      : "bg-card even:bg-secondary/55"
                  )}
                >
                  {/* NOTES BUBBLE — always interactive so a receipt can be
                      attached to any expense after the fact, regardless of
                      how it was created (manual, CSV/Venmo import, or a
                      confirmed Plaid transaction). */}
                  <td className={`${tdBase} w-8 px-1 py-1.5 text-center align-middle`}>
                    <Popover
                      open={notesPopoverExpenseId === e.id}
                      onOpenChange={(open) => setNotesPopoverExpenseId(open ? e.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="relative inline-flex text-muted-foreground hover:text-foreground"
                          title={
                            e.flaggedReason === "bank_reversed"
                              ? "Your bank removed this transaction after it was recorded — please review"
                              : needsReceiptForAuditDefense(e.amount ?? 0, e.receiptAssetId)
                              ? `Missing receipt — expenses over ${formatCurrency(RECEIPT_REQUIRED_THRESHOLD)} generally need one for audit defense`
                              : "View details"
                          }
                        >
                          <MessageCircle
                            className={cn(
                              "h-5 w-5",
                              !e.description && !e.receiptAssetId && !(Array.isArray(e.allocations) && e.allocations.length > 0)
                                ? "opacity-30"
                                : undefined
                            )}
                            aria-hidden="true"
                          />
                          {expenseNeedsAttention(e) ? (
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
                          ) : null}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-md">
                        <ExpenseDetails
                          expense={e}
                          workspaceId={activeWorkspaceId}
                          onAttachReceipt={() => setAttachReceiptExpenseId(e.id)}
                          onReceiptViewerClose={() => setNotesPopoverExpenseId(null)}
                        />
                      </PopoverContent>
                    </Popover>
                  </td>

                  {/* DATE */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle whitespace-nowrap`}>
                    {formatShortDate(e.date)}
                  </td>

                  {/* VENDOR (popover editor) */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle`}>
                    <ExpenseFieldEditor
                      {...editorProps(e, "vendor", getEditableCellClasses(armedCell?.id === e.id && armedCell?.field === "vendor"))}
                    />
                  </td>

                  {/* AMOUNT (popover editor) */}
                  <td className={`${tdBase} px-1 py-1.5 text-center align-middle whitespace-nowrap tabular-nums`}>
                    <ExpenseFieldEditor
                      {...editorProps(e, "amount", getEditableCellClasses(armedCell?.id === e.id && armedCell?.field === "amount"))}
                    />
                  </td>

                  {/* CATEGORY (popover editor) */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle`}>
                    <div className="relative min-h-7 pr-5">
                      <ExpenseFieldEditor
                        {...editorProps(
                          e,
                          "account",
                          cn(getEditableCellClasses(armedCell?.id === e.id && armedCell?.field === "account"), "min-w-0")
                        )}
                      />

                      <div className="absolute right-0 top-1/2 -translate-y-1/2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="shrink-0 rounded p-0.5 sm:p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                              <MoreVertical size={16} />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            side="top"
                            align="end"
                            className="w-32 p-2 z-50"
                            onOpenAutoFocus={(evt) => evt.preventDefault()}
                          >
                            <Button
                              variant="destructive"
                              className="w-full"
                              onClick={() => void deleteExpenseWithConfirm(activeWorkspaceId, e.id)}
                            >
                              Delete
                            </Button>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>

          <tfoot className="border-t border-border bg-secondary/70">
            <tr className="divide-x divide-border text-[13px] font-medium text-foreground sm:text-sm">
              <td className="px-2 py-1.5"></td>
              <td className="px-2 py-1.5 font-semibold text-center">Totals</td>
              <td className="px-2 py-1.5"></td>
              <td className="px-2 py-1.5 text-center tabular-nums text-foreground/80">
                {formatCurrency(totalAmount)}
              </td>
              <td className="px-2 py-1.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <AttachReceiptDialog
        open={attachReceiptExpenseId != null}
        onOpenChange={(open) => !open && setAttachReceiptExpenseId(null)}
        workspaceId={activeWorkspaceId}
        expenseId={attachReceiptExpenseId ?? ""}
        vendorLabel={sorted.find((e) => e.id === attachReceiptExpenseId)?.vendor}
      />
    </div>
  )
}
