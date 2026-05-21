// /shared/constants.ts
/**
 * Pure constants — no schema imports
 * ---------------------------------------------------------
 * Safe to import anywhere, even inside shared/schemas
 * ---------------------------------------------------------
 */

export const CACHE_TTL = {
  SETTINGS: Infinity,
  TAX_PROFILE: Infinity,
  ENTRIES: Infinity,
  PAYSTUBS: Infinity,
  USER: Infinity,
  PENDING: Infinity,
  MODE: Infinity,
} as const

export const DEFAULT_CACHE_TTL = CACHE_TTL.SETTINGS
