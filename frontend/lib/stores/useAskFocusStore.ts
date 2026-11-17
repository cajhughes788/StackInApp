import { create } from "zustand"

// Ask 521's "Show me": where the answer came from. The page at `path` marks
// its spots (data-ask-spot="income") and lines (data-ask-line="<id>"); the
// AskFocusLayer finds them, scrolls to them and lights them up, with a strip
// saying what was asked. Cleared with the strip's ✕ or by leaving the page.

export type AskFocus = {
  // Pathname it's for, without the query ("/app/profitloss").
  path: string
  // The strip: "Venmo in October · $640".
  banner: string
  // A smaller line under it ("Some of this week is in October.").
  note: string | null
  // One spot to light (a total, a row).
  spot: string | null
  // Lines to light (statement lines, invoices, appointments).
  lines: string[]
  // Statement rows to open first ("income-tips", "expense-Supplies").
  open: string[]
  nonce: number
}

type AskFocusState = {
  focus: AskFocus | null
  show: (focus: Omit<AskFocus, "nonce">) => void
  clear: () => void
}

let nonce = 0

export const useAskFocusStore = create<AskFocusState>((set) => ({
  focus: null,
  show: (focus) => set({ focus: { ...focus, nonce: ++nonce } }),
  clear: () => set({ focus: null }),
}))
