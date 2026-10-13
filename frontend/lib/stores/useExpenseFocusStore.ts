import { create } from "zustand"

import { usePeriodSelectionStore } from "@/lib/stores/usePeriodSelectionStore"
import { getCalendarMonthBucketFromDate, listPeriodsBack } from "@shared/payPeriods"
import type { WorkspaceType } from "@shared/contracts/workspace"
import type { SettingsType } from "@shared/schemas/settings"

// "Show me this expense" — e.g. the Receipts page's View expense button.
// Held in app state rather than a URL for the same reason as deepLinkStore.ts
// (Capacitor answers extension-less URLs with the root index.html).
//
// Two steps, each consumed once:
// - `request`: the home page switches to the Expenses tab and the expense's
//   month, then clears it (so a later visit to home doesn't repeat it).
// - `highlightExpenseId`: set by the home page; the expenses grid opens,
//   scrolls the row into view, flashes it, then clears it.

export type ExpenseFocusRequest = {
  workspaceId: string
  expenseId: string
  // "YYYY-MM" calendar month the expense belongs to.
  month: string
}

type ExpenseFocusState = {
  request: ExpenseFocusRequest | null
  highlightExpenseId: string | null
  // Month ("YYYY-MM") the Receipts page should open on, set by links that
  // point at a specific month (Needs you's missing-receipts item). Consumed
  // once by ReceiptsLibrary.
  receiptsMonth: string | null
  setReceiptsMonth: (month: string | null) => void
  focusExpense: (request: ExpenseFocusRequest) => void
  clearRequest: () => void
  setHighlight: (expenseId: string | null) => void
}

export const useExpenseFocusStore = create<ExpenseFocusState>((set) => ({
  request: null,
  highlightExpenseId: null,
  receiptsMonth: null,
  setReceiptsMonth: (month) => set({ receiptsMonth: month }),
  focusExpense: (request) => set({ request, highlightExpenseId: null }),
  clearRequest: () => set({ request: null }),
  setHighlight: (expenseId) => set({ highlightExpenseId: expenseId }),
}))

// Points the home page at the expense's month (null selection = the current
// month). The Receipts page calls this BEFORE navigating, so home mounts on
// that month and loads only it — selecting it after mount would start a load
// of the current month and then the target month, and the two overlap.
export function selectExpenseMonth(
  workspaceId: string,
  workspaceType: WorkspaceType,
  workspaceCreatedAt: number | null,
  settings: SettingsType,
  month: string
): void {
  const periods = listPeriodsBack(settings, workspaceType, workspaceCreatedAt)
  const index = periods.findIndex((period) => getCalendarMonthBucketFromDate(period.start, settings) === month)
  if (index < 0) return
  const next = index === 0 ? null : periods[index]
  const current = usePeriodSelectionStore.getState().byWorkspaceId[workspaceId] ?? null
  // Same month already selected — leave it, so nothing reloads.
  if ((current?.periodId ?? null) === (next?.periodId ?? null)) return
  usePeriodSelectionStore.getState().setSelectedPeriod(workspaceId, next)
}
