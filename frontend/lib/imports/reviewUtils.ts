import type { EntryType } from "@shared/schemas/entry"
import type { ImportItem } from "@shared/schemas/import"
import type { ReceiptDraft } from "@shared/schemas/receiptDraft"

type ExpenseLike = {
  id?: string
  date?: string
  amount?: number
  vendor?: string
  description?: string
}

type ExpenseCandidateLike = Pick<
  ImportItem,
  "occurredAt" | "amount" | "counterparty" | "description"
> &
  Partial<Pick<ImportItem, "committedExpenseId">> &
  Partial<Pick<ReceiptDraft, "committedExpenseId">>

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function hasSameAmount(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false
  return Math.abs(Number(a) - Number(b)) < 0.01
}

export function findDuplicateIncomeEntry(
  item: ImportItem,
  entries: EntryType[]
): EntryType | null {
  const itemDate = item.occurredAt ?? ""
  const itemAmount = Number(item.amount ?? 0)
  const itemNeedle = normalizeText(item.counterparty || item.description)

  for (const entry of entries) {
    if (entry.workspace !== "independent") continue
    if ((entry.date ?? "") !== itemDate) continue
    if (!hasSameAmount(entry.totals?.dayTotal, itemAmount)) continue

    const notes = normalizeText(entry.notes)
    if (!itemNeedle || notes.includes(itemNeedle)) {
      return entry
    }
  }

  return null
}

export function findDuplicateExpense(
  item: ExpenseCandidateLike,
  expenses: ExpenseLike[]
): ExpenseLike | null {
  const itemDate = item.occurredAt ?? ""
  const itemAmount = Number(item.amount ?? 0)
  const itemNeedle = normalizeText(item.counterparty || item.description)

  for (const expense of expenses) {
    if (item.committedExpenseId && expense.id === item.committedExpenseId) continue
    if ((expense.date ?? "") !== itemDate) continue
    if (!hasSameAmount(expense.amount, itemAmount)) continue

    const vendor = normalizeText(expense.vendor)
    const description = normalizeText(expense.description)
    if (!itemNeedle || vendor.includes(itemNeedle) || description.includes(itemNeedle)) {
      return expense
    }
  }

  return null
}

type ExpenseCategoryCandidateLike = Pick<
  ReceiptDraft,
  "counterparty" | "description" | "suggestedExpenseAccount"
>

export function getSuggestedExpenseCategoryForImport(
  item: ExpenseCategoryCandidateLike,
  getAccountForVendor: (vendor: string) => string | undefined
): string {
  const vendorCandidate = item.counterparty || item.description || ""
  return getAccountForVendor(vendorCandidate) || item.suggestedExpenseAccount || ""
}
