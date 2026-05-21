import type { IncomeCategory, PaymentMethod } from "@shared/schemas/entry"

export type BreakdownDraft = {
  selected: IncomeCategory[]
  services: string
  tips: string
  products: string
  other: string
}

export const breakdownCategories: IncomeCategory[] = [
  "services",
  "tips",
  "products",
  "other",
]

export const categoryLabels: Record<IncomeCategory, string> = {
  services: "Services",
  tips: "Tips",
  products: "Products",
  other: "Other",
}

export const paymentCategoryConfig: Record<
  "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales",
  {
    paymentMethod: PaymentMethod
    categories: IncomeCategory[]
    defaultCategory: IncomeCategory
    label: string
  }
> = {
  venmo: {
    paymentMethod: "venmo",
    categories: ["services", "tips", "products", "other"],
    defaultCategory: "services",
    label: "Venmo",
  },
  appleCash: {
    paymentMethod: "apple_cash",
    categories: ["services", "tips", "products", "other"],
    defaultCategory: "services",
    label: "Apple Pay",
  },
  zelle: {
    paymentMethod: "zelle",
    categories: ["services", "tips", "products", "other"],
    defaultCategory: "services",
    label: "Zelle",
  },
  posSales: {
    paymentMethod: "pos",
    categories: ["services", "products", "other"],
    defaultCategory: "services",
    label: "POS Sales",
  },
  cashSales: {
    paymentMethod: "cash",
    categories: ["services", "products", "other"],
    defaultCategory: "services",
    label: "Cash Sales",
  },
}

export function emptyBreakdownDraft(): BreakdownDraft {
  return {
    selected: [],
    services: "",
    tips: "",
    products: "",
    other: "",
  }
}

export function parseMoney(raw: string) {
  if (raw === "" || raw == null) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function draftSum(draft: BreakdownDraft) {
  return (
    parseMoney(draft.services) +
    parseMoney(draft.tips) +
    parseMoney(draft.products) +
    parseMoney(draft.other)
  )
}

export function formatDraftAmount(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) {
    return ""
  }

  return Number(value.toFixed(2)).toString()
}

function getAutoAssignedCategory(
  selected: IncomeCategory[],
  editedCategory?: IncomeCategory
) {
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const category = selected[index]
    if (category !== editedCategory) {
      return category
    }
  }

  return selected[selected.length - 1]
}

export function rebalanceBreakdownDraft(
  draft: BreakdownDraft,
  total: number,
  categories: IncomeCategory[],
  editedCategory?: IncomeCategory
): BreakdownDraft {
  const selected = draft.selected.filter((category) =>
    categories.includes(category)
  )

  if (total <= 0 || selected.length === 0) {
    return emptyBreakdownDraft()
  }

  const nextDraft: BreakdownDraft = {
    selected,
    services: "",
    tips: "",
    products: "",
    other: "",
  }

  for (const category of breakdownCategories) {
    if (selected.includes(category)) {
      nextDraft[category] = draft[category]
    }
  }

  if (selected.length === 1) {
    nextDraft[selected[0]] = formatDraftAmount(total)
    return nextDraft
  }

  const autoCategory = getAutoAssignedCategory(selected, editedCategory)
  const fixedCategories = selected.filter((category) => category !== autoCategory)
  const fixedSum = fixedCategories.reduce(
    (sum, category) => sum + parseMoney(nextDraft[category]),
    0
  )
  const remainder = total - fixedSum
  nextDraft[autoCategory] = formatDraftAmount(Math.max(0, remainder))
  return nextDraft
}
