//expenses grid

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GridEditorPopoverContent } from "@/components/grid-editor-popover-content"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MessageCircle, MoreVertical } from "lucide-react"
import { useExpensesStore } from "@/lib/stores/useExpensesStore"
import * as expensesService from "@/lib/domain/expenseService"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import {
  EXPENSE_CATEGORY_OPTIONS,
  findExpenseCategoryGuideEntry,
  normalizeExpenseCategoryLabel,
} from "@/lib/expenseCategories"
import { formatCurrency, parseLocalDate } from "@/lib/helpers"
import { thBase, tdBase } from "@/lib/tableStyles"
import { cn } from "@/lib/utils"
import ReceiptViewerTrigger from "@/components/receipt-viewer-trigger"

const formatShortDate = (iso: string) =>
  parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

type EditableExpenseField = "amount" | "account" | "vendor"

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
  const expensesEntry = useExpensesStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const expenses = expensesEntry?.expenses ?? []
  const expensesLoading =
    activeWorkspaceId != null
      ? (expensesEntry?.status ?? "idle") === "loading"
      : true
  const hasRenderableExpenses =
    expenses.length > 0 || (expensesEntry?.lastBackendSync ?? null) !== null

  // Track which popover is open + initial value
  const [popoverState, setPopoverState] = useState<{
    id: string
    field: EditableExpenseField
    value: string
  } | null>(null)
  const [armedCell, setArmedCell] = useState<{
    id: string
    field: EditableExpenseField
  } | null>(null)

  const openEditor = useCallback((id: string, field: EditableExpenseField, value: string) => {
    setArmedCell(null)
    setPopoverState({ id, field, value })
  }, [])

  const closeEditor = useCallback(() => setPopoverState(null), [])

  const armOrOpenEditor = useCallback(
    (id: string, field: EditableExpenseField, value: string) => {
      if (armedCell?.id === id && armedCell.field === field) {
        openEditor(id, field, value)
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

  const categorySuggestions = useMemo(() => {
    if (popoverState?.field !== "account") return []

    const query = popoverState.value.trim().toLowerCase()
    if (!query) return EXPENSE_CATEGORY_OPTIONS

    return EXPENSE_CATEGORY_OPTIONS.filter((option) =>
      option.toLowerCase().includes(query)
    )
  }, [popoverState])

  const selectedCategoryEntry = useMemo(() => {
    if (popoverState?.field !== "account") return null
    return findExpenseCategoryGuideEntry(popoverState.value)
  }, [popoverState])

  const handleSave = async () => {
    if (!popoverState) return
    if (!activeWorkspaceId) return

    const { id, field, value } = popoverState

    let patch: any = {}

    if (field === "amount") {
      const num = Number(value)
      if (isNaN(num)) {
        alert("Invalid amount")
        return
      }
      patch.amount = num
    }

    if (field === "account") {
      const normalizedAccountEntry = findExpenseCategoryGuideEntry(value)
      if (!normalizedAccountEntry) {
        alert("Please choose an expense category from the built-in list.")
        return
      }
      patch.account = normalizedAccountEntry.category
    }

    if (field === "vendor") {
      patch.vendor = value.trim()
    }

    await expensesService.updateExpense(activeWorkspaceId, id, patch)
    closeEditor()
  }

  const handleDelete = async (id: string) => {
    if (!activeWorkspaceId) return
    if (!confirm("Delete this expense?")) return
    try {
      await expensesService.deleteExpense(activeWorkspaceId, id)
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete expense. Nothing was removed from the backend."
      )
    }
  }

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [expenses]
  )

  const totalAmount = useMemo(() => {
    return sorted.reduce((acc, e) => acc + (e.amount ?? 0), 0)
  }, [sorted])

  if (workspaceState.status !== "ready" || (expensesLoading && !hasRenderableExpenses)) {
    return <div className="p-4 text-gray-400 text-sm">Loading expenses…</div>
  }

  return (
    <div
      ref={gridRootRef}
      data-expenses-grid-root="true"
      className="bg-card rounded-lg border shadow-sm overflow-hidden"
    >
      {expensesLoading ? (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Refreshing expenses…
        </div>
      ) : null}

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
                  className="bg-card even:bg-secondary/55 divide-x divide-border"
                >
                  {/* NOTES BUBBLE */}
                  <td className={`${tdBase} w-8 px-1 py-1.5 text-center align-middle`}>
                    {e.description || (e.receiptAssetId && activeWorkspaceId) ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            title="View details"
                          >
                            <MessageCircle className="h-5 w-5" aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-xs rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-md">
                          <div className="space-y-3">
                            {e.description ? (
                              <p className="whitespace-pre-wrap text-sm">{e.description}</p>
                            ) : null}
                            {Array.isArray(e.allocations) && e.allocations.length > 0 ? (
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Category Breakdown
                                </p>
                                <div className="space-y-1">
                                  {e.allocations.map((allocation: any, allocationIndex: number) => (
                                    <div
                                      key={`${e.id ?? "expense"}-allocation-${allocationIndex}`}
                                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-sm"
                                    >
                                      <span className="min-w-0 truncate">{allocation.category}</span>
                                      <span className="shrink-0 font-medium">
                                        {formatCurrency(allocation.amount ?? 0)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {e.receiptAssetId && activeWorkspaceId ? (
                              <ReceiptViewerTrigger
                                workspaceId={activeWorkspaceId}
                                receiptAssetId={e.receiptAssetId}
                                title={e.vendor || e.description || "Receipt"}
                                label="View Receipt"
                                variant="outline"
                                className="w-full"
                              />
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span
                        className="inline-flex text-muted-foreground opacity-30"
                        title="No notes"
                      >
                        <MessageCircle className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                  </td>

                  {/* DATE */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle whitespace-nowrap`}>
                    {formatShortDate(e.date)}
                  </td>

                  {/* VENDOR (popover editor) */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle`}>
                    <Popover
                      open={
                        !!popoverState &&
                        popoverState.id === e.id &&
                        popoverState.field === "vendor"
                      }
                      onOpenChange={(open) => {
                        if (!open) closeEditor()
                      }}
                    >
                      <PopoverTrigger asChild>
                          <button
                            className={getEditableCellClasses(
                            armedCell?.id === e.id && armedCell?.field === "vendor"
                            )}
                          onClick={() => armOrOpenEditor(e.id, "vendor", e.vendor ?? "")}
                        >
                          <span className="block truncate text-center">
                            {e.vendor || <span className="text-muted-foreground italic">No vendor</span>}
                          </span>
                        </button>
                      </PopoverTrigger>

                      <GridEditorPopoverContent
                        data-grid-popover="expenses"
                        side="top"
                        align="end"
                        className="w-56 space-y-3 p-3 z-50"
                        onOpenAutoFocus={(event) => event.preventDefault()}
                      >
                        <div className="text-sm font-medium">Edit Vendor</div>
                        <Input
                          value={popoverState?.value ?? ""}
                          onChange={(evt) =>
                            setPopoverState((s) =>
                              s ? { ...s, value: evt.target.value } : s
                            )
                          }
                        />
                        <Button className="w-full" onClick={handleSave}>
                          Save
                        </Button>
                      </GridEditorPopoverContent>
                    </Popover>
                  </td>

                  {/* AMOUNT (popover editor) */}
                  <td className={`${tdBase} px-1 py-1.5 text-center align-middle whitespace-nowrap tabular-nums`}>
                    <Popover
                      open={
                        !!popoverState &&
                        popoverState?.id === e.id &&
                        popoverState.field === "amount"
                      }
                      onOpenChange={(open) => {
                        if (!open) closeEditor()
                      }}
                    >
                      <PopoverTrigger asChild>
                          <button
                            className={getEditableCellClasses(
                            armedCell?.id === e.id && armedCell?.field === "amount"
                            )}
                          onClick={() =>
                            armOrOpenEditor(e.id, "amount", String(e.amount ?? ""))
                          }
                        >
                          {formatCurrency(e.amount ?? 0)}
                        </button>
                      </PopoverTrigger>

                      <GridEditorPopoverContent
                        data-grid-popover="expenses"
                        side="top"
                        align="end"
                        className="w-56 space-y-3 p-3 z-50"
                        onOpenAutoFocus={(event) => event.preventDefault()}
                      >
                        <div className="text-sm font-medium">Edit Amount</div>
                        <Input
                          inputMode="decimal"
                          className="text-right"
                          value={popoverState?.value ?? ""}
                          onChange={(evt) =>
                            setPopoverState((s) =>
                              s ? { ...s, value: evt.target.value } : s
                            )
                          }
                        />
                        <Button className="w-full" onClick={handleSave}>
                          Save
                        </Button>
                      </GridEditorPopoverContent>
                    </Popover>
                  </td>

                  {/* CATEGORY (popover editor) */}
                  <td className={`${tdBase} px-0.5 py-1.5 text-center align-middle`}>
                    <div className="relative min-h-7 pr-5">
                      <Popover
                        open={
                          !!popoverState &&
                          popoverState?.id === e.id &&
                          popoverState.field === "account"
                        }
                        onOpenChange={(open) => {
                          if (!open) closeEditor()
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={cn(
                              getEditableCellClasses(
                                armedCell?.id === e.id && armedCell?.field === "account"
                              ),
                              "min-w-0"
                            )}
                            onClick={() =>
                              armOrOpenEditor(e.id, "account", e.account ?? "")
                            }
                          >
                            <span className="block truncate text-center">
                              {e.account || (
                                <span className="text-muted-foreground italic">
                                  No category
                                </span>
                              )}
                            </span>
                          </button>
                        </PopoverTrigger>

                        <GridEditorPopoverContent
                          data-grid-popover="expenses"
                          side="top"
                          align="end"
                          className="w-64 space-y-3 p-3 z-50"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                        >
                          <div className="text-sm font-medium">Edit Category</div>
                          <Input
                            value={popoverState?.value ?? ""}
                            onChange={(evt) =>
                              setPopoverState((s) =>
                                s ? { ...s, value: evt.target.value } : s
                              )
                            }
                            placeholder="Start typing to choose a category"
                          />
                          <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                            {categorySuggestions.map((category) => (
                              <button
                                key={category}
                                type="button"
                                className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  setPopoverState((state) =>
                                    state ? { ...state, value: category } : state
                                  )
                                }}
                              >
                                {category}
                              </button>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {selectedCategoryEntry
                              ? `Saving as ${normalizeExpenseCategoryLabel(
                                  selectedCategoryEntry.category
                                )}`
                              : "Choose one of the built-in expense categories."}
                          </div>
                          <Button className="w-full" onClick={handleSave}>
                            Save
                          </Button>
                        </GridEditorPopoverContent>
                      </Popover>

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
                              onClick={() => handleDelete(e.id)}
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
              <td className="px-2 py-1.5 text-center tabular-nums text-slate-700 dark:text-white">
                {formatCurrency(totalAmount)}
              </td>
              <td className="px-2 py-1.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
