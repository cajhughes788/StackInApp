export const CACHE_VERSIONS = {
  settings: 3,
  settingsHash: 2,
  settingsPending: 1,
  entries: 3,
  expenses: 2,
  taxProfile: 2,
  taxProfileHash: 2,
  payStubs: 2,
  profitLoss: 4,
  receiptDrafts: 1,
  receiptMedia: 1,
} as const

export type CacheDomain = keyof typeof CACHE_VERSIONS
