// Keyword → expense category heuristic, shared by the CSV/Venmo importer
// (frontend/lib/imports/csvImportParsers.ts) and the Plaid transaction
// classifier (shared/plaidClassification.ts) so both use one keyword list
// instead of maintaining separate copies.
export function suggestExpenseCategoryFromText(text: string | null): string | null {
  const normalized = (text ?? "").toLowerCase()
  if (!normalized) return null
  if (normalized.includes("uber") || normalized.includes("lyft") || normalized.includes("shell") || normalized.includes("chevron")) {
    return "Vehicle & Transportation"
  }
  if (normalized.includes("supply") || normalized.includes("sally") || normalized.includes("cosmoprof") || normalized.includes("amazon")) {
    return "Supplies"
  }
  if (normalized.includes("rent") || normalized.includes("booth")) {
    return "Rent / Booth Rent"
  }
  if (normalized.includes("ad") || normalized.includes("meta") || normalized.includes("instagram")) {
    return "Marketing & Advertising"
  }
  if (normalized.includes("quickbooks") || normalized.includes("glossgenius") || normalized.includes("vagaro") || normalized.includes("square")) {
    return "Software & Subscriptions"
  }
  return null
}

// Narrower than the "Vehicle & Transportation" category match above — used
// only to flag likely gas-station purchases (see shared/plaidClassification.ts
// and plaid-pending-transactions-panel.tsx), since fuel is the one vehicle
// cost that's already baked into the standard mileage rate and would be
// double-counted if also confirmed as its own expense. Deliberately excludes
// rideshare (uber/lyft), parking, and tolls, which are deductible either way.
const FUEL_STATION_KEYWORDS = [
  "shell",
  "chevron",
  "exxon",
  "mobil",
  "bp",
  "arco",
  "texaco",
  "marathon",
  "valero",
  "sunoco",
  "citgo",
  "speedway",
  "wawa",
  "sheetz",
  "casey's",
  "quiktrip",
  "circle k",
  "76 ",
  "gas station",
  "fuel",
]

export function isLikelyFuelPurchase(text: string | null): boolean {
  const normalized = (text ?? "").toLowerCase()
  if (!normalized) return false
  return FUEL_STATION_KEYWORDS.some((keyword) => normalized.includes(keyword))
}
