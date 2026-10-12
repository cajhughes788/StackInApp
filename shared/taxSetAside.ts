// "Safe to spend" for self-employed workspaces: profit minus a flat share
// set aside for taxes. A rough rule of thumb, not a tax calculation — the
// UI labels it as an estimate. The share is editable in Settings
// (independent.taxSetAsidePercent).
export const TAX_SET_ASIDE_DEFAULT_PERCENT = 25

// Hidden for now (2026-10): a flat % isn't a real estimate — what a
// self-employed person owes varies widely (≈14% to 35%+ by income, filing
// status and state). Off: the home card shows "Keep about … after expenses"
// and Settings hides the % field. Flip on once there's a real estimate.
export const SHOW_TAX_SET_ASIDE = false

export function resolveTaxSetAsidePercent(percent: number | null | undefined): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return TAX_SET_ASIDE_DEFAULT_PERCENT
  return Math.min(100, Math.max(0, percent))
}

export function computeSafeToSpend(
  income: number,
  expenses: number,
  percent: number | null | undefined
): { profit: number; taxSetAside: number; safeToSpend: number } {
  const profit = income - expenses
  // Nothing to set aside on a loss.
  const taxSetAside = profit > 0 ? (profit * resolveTaxSetAsidePercent(percent)) / 100 : 0
  return { profit, taxSetAside, safeToSpend: profit - taxSetAside }
}
