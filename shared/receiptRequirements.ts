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
