// /shared/processingFees.ts
// ------------------------------------------------------------
// Processing fees: when a customer pays $100 by card and Square deposits
// $97, the entry records the full $100 as income (what the processor reports
// on a 1099-K) and the $3 as a fee on that income line. Every income total
// stays the full sale; the fee is counted as an expense under "Payment
// Processing Fees", so profit is unchanged — the money just sits in the
// right buckets.
//
// Turned on per workspace (independent.trackProcessingFees). Lines that
// already carry a fee keep counting it if the setting is turned off later.
// ------------------------------------------------------------
import type { EntryType, PaymentMethod } from "./schemas/entry"

export const PROCESSING_FEE_EXPENSE_CATEGORY = "Payment Processing Fees"

// Card / POS (Square, Stripe, Clover…), Cash App and Venmo business
// payments are the sources that keep a cut. Cash, checks, Zelle and Apple
// Cash don't.
const FEE_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>(["card", "pos", "cash_app", "venmo"])

export function supportsProcessingFee(paymentMethod: PaymentMethod | string | null | undefined): boolean {
  return FEE_PAYMENT_METHODS.has(paymentMethod as PaymentMethod)
}

export function isProcessingFeeTrackingOn(
  independentSettings: { trackProcessingFees?: boolean } | null | undefined
): boolean {
  return independentSettings?.trackProcessingFees === true
}

// Any income line; refund lines simply have no fee.
type FeeCarrier = object

export function getBreakdownFee(breakdown: FeeCarrier | null | undefined): number {
  const fee = Number((breakdown as { fee?: unknown } | null | undefined)?.fee ?? 0)
  return Number.isFinite(fee) && fee > 0 ? fee : 0
}

export function sumBreakdownFees(breakdowns: FeeCarrier[] | null | undefined): number {
  return round2((breakdowns ?? []).reduce((sum, item) => sum + getBreakdownFee(item), 0))
}

/** Fees on one entry. Refund entries carry none. */
export function getEntryProcessingFees(entry: Pick<EntryType, "workspace" | "kind" | "independent">): number {
  if (entry.workspace !== "independent" || entry.kind === "refund") return 0
  return sumBreakdownFees(entry.independent?.incomeBreakdowns)
}

export function sumEntryProcessingFees(entries: Array<Pick<EntryType, "workspace" | "kind" | "independent">>): number {
  return round2(entries.reduce((sum, entry) => sum + getEntryProcessingFees(entry), 0))
}

export type ProcessingFeeItem = {
  id: string
  date: string
  label: string
  description: string
  amount: number
}

/** One P&L expense line per income line that carries a fee. */
export function buildProcessingFeeItems(
  entries: Array<Pick<EntryType, "id" | "date" | "notes" | "workspace" | "kind" | "independent">>,
  paymentLabels: Partial<Record<PaymentMethod, string>>
): ProcessingFeeItem[] {
  const items: ProcessingFeeItem[] = []
  for (const entry of entries) {
    if (entry.workspace !== "independent" || entry.kind === "refund") continue
    const note = (entry.notes ?? "").trim()
    for (const [index, breakdown] of (entry.independent?.incomeBreakdowns ?? []).entries()) {
      const amount = round2(getBreakdownFee(breakdown))
      if (amount <= 0) continue
      const paymentLabel = paymentLabels[breakdown.paymentMethod] ?? "Income"
      items.push({
        id: `${entry.id ?? entry.date}-${index}-fee`,
        date: entry.date,
        label: note || paymentLabel,
        description: `${paymentLabel} processing fee`,
        amount,
      })
    }
  }
  return items
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
