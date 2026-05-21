export const CACHE_VERSIONS = {
  settings: 2,
  settingsHash: 2,
  entries: 2,
  expenses: 2,
  taxProfile: 2,
  taxProfileHash: 2,
  payStubs: 2,
  profitLoss: 3,
  receiptDrafts: 1,
  receiptMedia: 1,
} as const

export type CacheDomain = keyof typeof CACHE_VERSIONS
