"use client"

// The expenses grid's tap-to-edit pop-ups and its details bubble, shared with
// the home page's expense categories (expense-categories-overview.tsx) so a
// day under a category edits the same way its grid cell does. Each editor
// saves one field of one expense. Opening/closing is controlled by the
// caller: the grid arms a cell on the first tap and opens it on the second, a
// category row opens on the first tap.

import { FieldError } from "@/components/ui/field-error"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { PopoverTrigger, Popover } from "@/components/ui/popover"
import { GridEditorPopoverContent } from "@/components/grid-editor-popover-content"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import * as expensesService from "@/lib/domain/expenseService"
import {
  findExpenseCategoryGuideEntry,
  getVisibleExpenseCategoryOptions,
  normalizeExpenseCategoryLabel,
  resolveExpenseCategoryLabel,
} from "@/lib/expenseCategories"
import { formatCurrency } from "@/lib/helpers"
import { toast } from "@/hooks/use-toast"
import ReceiptViewerTrigger from "@/components/receipt-viewer-trigger"
import { needsReceiptForAuditDefense, RECEIPT_REQUIRED_THRESHOLD } from "@shared/receiptRequirements"
import type { ExpenseCategoryVisibilityContext } from "@shared/expenseCategories"

export type EditableExpenseField = "amount" | "account" | "vendor"

// The expenses store types expenses loosely (see useExpensesStore.ts).
type Expense = any

type VisibilityContext = NonNullable<ExpenseCategoryVisibilityContext>

/** Open/close wiring every editor takes from its caller. */
export type ExpenseEditorControl = {
  workspaceId: string | null
  isOpen: boolean
  /** The pop-up asked to close (tap outside, Escape). */
  onClose: () => void
  /** The trigger was tapped. */
  onTriggerClick: () => void
  /** A save finished — the caller closes the pop-up (and disarms). */
  onSaved: () => void
  triggerClassName: string
  /** Trigger content; defaults to the grid's plain value. */
  trigger?: ReactNode
}

function currentFieldValue(expense: Expense, field: EditableExpenseField): string {
  if (field === "amount") return String(expense.amount ?? "")
  if (field === "account") return expense.account ?? ""
  return expense.vendor ?? ""
}

/** Vendor, amount or category of one expense. */
export function ExpenseFieldEditor({
  expense,
  field,
  customExpenseCategories,
  workspaceType,
  independentSettings,
  workspaceId,
  isOpen,
  onClose,
  onTriggerClick,
  onSaved,
  triggerClassName,
  trigger,
}: ExpenseEditorControl & {
  expense: Expense
  field: EditableExpenseField
  customExpenseCategories: string[]
  workspaceType: VisibilityContext["workspaceType"]
  independentSettings: VisibilityContext["independentSettings"]
}) {
  const [value, setValue] = useState(() => currentFieldValue(expense, field))
  const [fieldError, setFieldError] = useState<string | null>(null)
  // Each opening starts from the expense's current value.
  useEffect(() => {
    if (isOpen) {
      setValue(currentFieldValue(expense, field))
      setFieldError(null)
    }
  }, [isOpen])
  const changeValue = (next: string) => {
    setValue(next)
    setFieldError(null)
  }

  const expenseCategoryOptions = useMemo(
    () =>
      field === "account"
        ? getVisibleExpenseCategoryOptions(
            customExpenseCategories,
            { workspaceType, independentSettings },
            { includeCategories: value ? [value] : [] }
          )
        : [],
    [field, customExpenseCategories, workspaceType, independentSettings, value]
  )
  const categorySuggestions = useMemo(() => {
    if (field !== "account") return []
    const query = value.trim().toLowerCase()
    if (!query) return expenseCategoryOptions
    return expenseCategoryOptions.filter((option) => option.toLowerCase().includes(query))
  }, [expenseCategoryOptions, field, value])
  const selectedCategoryEntry = useMemo(
    () => (field === "account" ? findExpenseCategoryGuideEntry(value) : null),
    [field, value]
  )

  const handleSave = async () => {
    if (!workspaceId) return

    let patch: any = {}

    if (field === "amount") {
      const num = Number(value)
      if (isNaN(num)) {
        setFieldError("Enter a number.")
        return
      }
      patch.amount = num
    }

    if (field === "account") {
      const normalizedAccount = resolveExpenseCategoryLabel(value, customExpenseCategories)
      if (!normalizedAccount) {
        setFieldError("Choose one of the categories below.")
        return
      }
      patch.account = normalizedAccount
    }

    if (field === "vendor") {
      patch.vendor = value.trim()
    }

    try {
      await expensesService.updateExpense(workspaceId, expense.id, patch)
      onSaved()
    } catch (error) {
      toast({
        title: "Couldn't save your change",
        description: error instanceof Error ? error.message : "Could not save your change. Please try again.",
        variant: "destructive",
      })
    }
  }

  const defaultTrigger =
    field === "amount" ? (
      formatCurrency(expense.amount ?? 0)
    ) : (
      <span className="block truncate text-center">
        {(field === "vendor" ? expense.vendor : expense.account) || (
          <span className="text-muted-foreground italic">{field === "vendor" ? "No vendor" : "No category"}</span>
        )}
      </span>
    )

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName} onClick={onTriggerClick}>
          {trigger ?? defaultTrigger}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent
        data-grid-popover="expenses"
        side="top"
        align="end"
        className={`${field === "account" ? "w-64" : "w-56"} space-y-3 p-3 z-50`}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {field === "vendor" ? (
          <>
            <div className="text-sm font-medium">Edit Vendor</div>
            <Input value={value} onChange={(evt) => changeValue(evt.target.value)} />
          </>
        ) : null}

        {field === "amount" ? (
          <>
            <div className="text-sm font-medium">Edit Amount</div>
            <Input inputMode="decimal" className="text-right" value={value} onChange={(evt) => changeValue(evt.target.value)} aria-invalid={!!fieldError} />
            <FieldError message={fieldError} />
          </>
        ) : null}

        {field === "account" ? (
          <>
            <div className="text-sm font-medium">Edit Category</div>
            <Input
              value={value}
              onChange={(evt) => changeValue(evt.target.value)}
              placeholder="Start typing to choose a category"
              aria-invalid={!!fieldError}
            />
            <FieldError message={fieldError} />
            <div className="max-h-44 overflow-y-auto rounded-md border border-border">
              {categorySuggestions.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                  onClick={() => changeValue(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              {selectedCategoryEntry
                ? `Saving as ${normalizeExpenseCategoryLabel(selectedCategoryEntry.category)}`
                : "Choose one of your available expense categories."}
            </div>
          </>
        ) : null}

        <Button className="w-full" onClick={handleSave}>
          Save
        </Button>
      </GridEditorPopoverContent>
    </Popover>
  )
}

/** Whether an expense's details bubble has something to flag. */
export function expenseNeedsAttention(expense: Expense): boolean {
  return expense.flaggedReason === "bank_reversed" || needsReceiptForAuditDefense(expense.amount ?? 0, expense.receiptAssetId)
}

/** The grid's details bubble: bank-reversed flag, description, category split,
 * and the receipt (view, or attach with the audit-defense hint). */
export function ExpenseDetails({
  expense,
  workspaceId,
  onAttachReceipt,
  onReceiptViewerClose,
}: {
  expense: Expense
  workspaceId: string | null
  onAttachReceipt: () => void
  onReceiptViewerClose?: () => void
}) {
  const e = expense
  return (
    <div className="space-y-3">
      {e.flaggedReason === "bank_reversed" && workspaceId ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Your bank removed this transaction after it was recorded — it may have been reversed,
            a hold that never settled, or a duplicate. Review it and delete this expense if it
            didn&apos;t actually happen.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void expensesService.updateExpense(workspaceId, e.id, { flaggedReason: null })}
          >
            Got it, clear this flag
          </Button>
        </div>
      ) : null}
      {e.description ? <p className="whitespace-pre-wrap text-sm">{e.description}</p> : null}
      {Array.isArray(e.allocations) && e.allocations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Category breakdown</p>
          <div className="space-y-1">
            {e.allocations.map((allocation: any, allocationIndex: number) => (
              <div
                key={`${e.id ?? "expense"}-allocation-${allocationIndex}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{allocation.category}</span>
                <span className="shrink-0 font-medium">{formatCurrency(allocation.amount ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {e.receiptAssetId && workspaceId ? (
        <ReceiptViewerTrigger
          workspaceId={workspaceId}
          receiptAssetId={e.receiptAssetId}
          title={e.vendor || e.description || "Receipt"}
          label="View Receipt"
          variant="outline"
          className="w-full"
          onClose={onReceiptViewerClose}
        />
      ) : (
        <div className="space-y-1.5">
          {needsReceiptForAuditDefense(e.amount ?? 0, e.receiptAssetId) ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Over {formatCurrency(RECEIPT_REQUIRED_THRESHOLD)} — a receipt is recommended for audit defense.
            </p>
          ) : null}
          <Button variant="outline" className="w-full" onClick={onAttachReceipt}>
            Attach Receipt
          </Button>
        </div>
      )}
    </div>
  )
}

/** The grid's Delete — confirms, deletes, toasts on failure. */
export async function deleteExpenseWithConfirm(workspaceId: string | null, id: string) {
  if (!workspaceId) return
  if (!confirm("Delete this expense?")) return
  try {
    await expensesService.deleteExpense(workspaceId, id)
  } catch (error) {
    toast({
      title: "Delete failed",
      description: error instanceof Error ? error.message : "Failed to delete expense. Nothing was removed from the backend.",
      variant: "destructive",
    })
  }
}
