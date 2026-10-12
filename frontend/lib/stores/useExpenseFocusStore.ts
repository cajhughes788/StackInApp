import { create } from "zustand"

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
  focusExpense: (request: ExpenseFocusRequest) => void
  clearRequest: () => void
  setHighlight: (expenseId: string | null) => void
}

export const useExpenseFocusStore = create<ExpenseFocusState>((set) => ({
  request: null,
  highlightExpenseId: null,
  focusExpense: (request) => set({ request, highlightExpenseId: null }),
  clearRequest: () => set({ request: null }),
  setHighlight: (expenseId) => set({ highlightExpenseId: expenseId }),
}))
