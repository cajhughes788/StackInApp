// IRS documentation guidance: expenses at or below this threshold are
// generally defensible with just a bank/card statement; above it, the IRS
// expects an actual receipt to survive an audit. This is a soft nudge, not
// an enforced rule — nothing blocks confirming or saving an expense without
// one. Used to flag expenses in the grid and to prompt at Plaid confirm time.
export const RECEIPT_REQUIRED_THRESHOLD = 75

export function needsReceiptForAuditDefense(
  amount: number,
  receiptAssetId: string | null | undefined
): boolean {
  return amount > RECEIPT_REQUIRED_THRESHOLD && !receiptAssetId
}

// "Audit-ready" score: of the expenses over the threshold, how many have a
// receipt. null percent when nothing is over the threshold (nothing to score).
export function computeReceiptCoverage(
  expenses: ReadonlyArray<{ amount?: number | null; receiptAssetId?: string | null }>
): { needed: number; covered: number; missing: number; percent: number | null } {
  let needed = 0
  let covered = 0
  for (const expense of expenses) {
    if ((expense.amount ?? 0) <= RECEIPT_REQUIRED_THRESHOLD) continue
    needed += 1
    if (expense.receiptAssetId) covered += 1
  }
  return {
    needed,
    covered,
    missing: needed - covered,
    percent: needed > 0 ? Math.round((covered / needed) * 100) : null,
  }
}
