import type { EntryType } from "./schemas/entry"
import { getIndependentCategorizedIncomeTotals } from "./independentIncome"

export function aggregateIndependentPnL(entries: EntryType[]) {
  let services = 0
  let tips = 0
  let products = 0
  let other = 0

  for (const entry of entries) {
    if (entry.workspace !== "independent") continue

    const totals = getIndependentCategorizedIncomeTotals(entry.independent)
    services += totals.services
    tips += totals.tips
    products += totals.products
    other += totals.other
  }

  return {
    income: {
      services,
      tips,
      products,
      other,
      total: services + tips + products + other,
    },
  }
}
