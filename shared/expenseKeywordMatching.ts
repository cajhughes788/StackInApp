// Keyword → expense category heuristic, shared by the CSV/Venmo importer
// (frontend/lib/imports/csvImportParsers.ts) and the Plaid transaction
// classifier (shared/plaidClassification.ts) so both use one keyword list
// instead of maintaining separate copies.
//
// Matched as whole words, not substrings — a substring check sent "Adobe",
// "Road Runner" and "Shadow Ridge" to Marketing via "ad", and "Parent
// Portal" or "Current" to Rent via "rent". Multi-word phrases match as-is.
const EXPENSE_CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["Vehicle & Transportation", ["uber", "lyft", "shell", "chevron"]],
  ["Supplies", ["supply", "supplies", "sally", "cosmoprof", "amazon"]],
  ["Rent / Booth Rent", ["rent", "booth"]],
  ["Marketing & Advertising", ["ad", "ads", "meta", "instagram"]],
  ["Software & Subscriptions", ["quickbooks", "glossgenius", "vagaro", "square"]],
]

const EXPENSE_CATEGORY_PATTERNS: Array<[RegExp, string]> = EXPENSE_CATEGORY_KEYWORDS.map(([category, keywords]) => [
  new RegExp(`\\b(${keywords.map((keyword) => keyword.replace(/\s+/g, "\\s+")).join("|")})\\b`),
  category,
])

export function suggestExpenseCategoryFromText(text: string | null): string | null {
  const normalized = (text ?? "").toLowerCase()
  if (!normalized) return null
  for (const [pattern, category] of EXPENSE_CATEGORY_PATTERNS) {
    if (pattern.test(normalized)) return category
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
