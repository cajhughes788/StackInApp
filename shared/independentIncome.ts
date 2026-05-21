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
