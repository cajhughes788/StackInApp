import type { EntryType, IncomeCategory, PaymentMethod } from "./schemas/entry"

export const incomeCategoryValues = [
  "services",
  "tips",
  "products",
  "other",
] as const

export const paymentMethodValues = [
  "cash",
  "card",
  "venmo",
  "apple_cash",
  "zelle",
  "pos",
  "other",
] as const

export type IncomeBreakdownLike = {
  paymentMethod: PaymentMethod
  services?: number
  tips?: number
  products?: number
  other?: number
}

export type CategorizedIncomeTotals = {
  services: number
  tips: number
  products: number
  other: number
  total: number
}

export function getIncomeBreakdownTotal(
  breakdown: Pick<IncomeBreakdownLike, "services" | "tips" | "products" | "other">
) {
  return (
    Number(breakdown.services ?? 0) +
    Number(breakdown.tips ?? 0) +
    Number(breakdown.products ?? 0) +
    Number(breakdown.other ?? 0)
  )
}

export function aggregateIncomeBreakdowns(
  breakdowns: IncomeBreakdownLike[] | undefined | null
) {
  return (breakdowns ?? []).reduce(
    (acc, item) => {
      acc.services += Number(item.services ?? 0)
      acc.tips += Number(item.tips ?? 0)
      acc.products += Number(item.products ?? 0)
      acc.other += Number(item.other ?? 0)
      acc.total += getIncomeBreakdownTotal(item)
      return acc
    },
    {
      services: 0,
      tips: 0,
      products: 0,
      other: 0,
      total: 0,
    }
  )
}

export function getIndependentCategorizedIncomeTotals(
  independent: EntryType["independent"] | undefined
): CategorizedIncomeTotals {
  const base = aggregateIncomeBreakdowns(independent?.incomeBreakdowns)

  return {
    services: Number(base.services ?? 0),
    tips: Number(base.tips ?? 0),
    products: Number(base.products ?? 0),
    other: Number(base.other ?? 0),
    total: Number(base.total ?? 0),
  }
}

export function getIncomeBreakdownTotalForPaymentMethod(
  independent: EntryType["independent"] | undefined,
  paymentMethod: PaymentMethod
) {
  if (!independent) return 0

  return (independent.incomeBreakdowns ?? [])
    .filter((item) => item.paymentMethod === paymentMethod)
    .reduce((sum, item) => sum + getIncomeBreakdownTotal(item), 0)
}

export function getIncomeBreakdownTotalForPaymentMethodAndCategory(
  independent: EntryType["independent"] | undefined,
  paymentMethod: PaymentMethod,
  category: IncomeCategory
) {
  if (!independent) return 0

  return (independent.incomeBreakdowns ?? [])
    .filter((item) => item.paymentMethod === paymentMethod)
    .reduce((sum, item) => sum + Number(item[category] ?? 0), 0)
}

export function getIndependentCashSalesTotal(
  independent: EntryType["independent"] | undefined
) {
  return (
    getIncomeBreakdownTotalForPaymentMethodAndCategory(independent, "cash", "services") +
    getIncomeBreakdownTotalForPaymentMethodAndCategory(independent, "cash", "products") +
    getIncomeBreakdownTotalForPaymentMethodAndCategory(independent, "cash", "other")
  )
}

// "Other" income that isn't custom income. The entry form and recurring rules
// mirror every customIncome item into an "other" breakdown line (so totals
// include it); whatever "other" money is left over came from somewhere else —
// mainly bank deposits confirmed with "Paid via: Other". Clamped at 0.
export function getCustomIncomeMirrors(
  independent: EntryType["independent"] | undefined
): IncomeBreakdownLike[] {
  return (independent?.customIncome ?? [])
    .filter((item) => Number(item.amount ?? 0) > 0)
    .map((item) => ({ paymentMethod: "other" as PaymentMethod, [item.category ?? "other"]: Number(item.amount) }))
}

export function getNonCustomOtherIncome(
  independent: EntryType["independent"] | undefined
): CategorizedIncomeTotals {
  const other = aggregateIncomeBreakdowns(
    (independent?.incomeBreakdowns ?? []).filter((item) => item.paymentMethod === "other")
  )
  const mirrored = aggregateIncomeBreakdowns(getCustomIncomeMirrors(independent))
  const services = Math.max(0, other.services - mirrored.services)
  const tips = Math.max(0, other.tips - mirrored.tips)
  const products = Math.max(0, other.products - mirrored.products)
  const otherCategory = Math.max(0, other.other - mirrored.other)
  return { services, tips, products, other: otherCategory, total: services + tips + products + otherCategory }
}
