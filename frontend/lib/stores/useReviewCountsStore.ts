import { create } from "zustand"

// How many bank transactions are waiting in each review list, per
// workspace — reported by plaid-pending-transactions-panel.tsx (expenses,
// including refunds) and plaid-income-review-panel.tsx (deposits), read by
// the home page's Income/Expenses toggle to badge the tab that isn't open.
// Without it, a notification covering both kinds lands on Expenses and the
// deposits sit unseen behind the Income tab.

export type ReviewTab = "income" | "expenses"

type ReviewCountsState = {
  byWorkspaceId: Record<string, Partial<Record<ReviewTab, number>>>
  setCount: (workspaceId: string, tab: ReviewTab, count: number) => void
}

export const useReviewCountsStore = create<ReviewCountsState>((set) => ({
  byWorkspaceId: {},
  setCount: (workspaceId, tab, count) =>
    set((state) => {
      if (state.byWorkspaceId[workspaceId]?.[tab] === count) return state
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...state.byWorkspaceId[workspaceId], [tab]: count },
        },
      }
    }),
}))
