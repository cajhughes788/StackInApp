// /shared/tax/math.ts

import Decimal from "decimal.js-light"

// High precision for payroll math; half-up is standard for currency when we DO round.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

// Type alias based on the library’s declared input type
type DecValue = string | number | Decimal

// Helper to ensure all inputs are wrapped as Decimal instances
export const d = (n: DecValue) => new Decimal(n)

// Core operations (always return Decimal)
export const add = (a: DecValue, b: DecValue) => d(a).add(b)
export const sub = (a: DecValue, b: DecValue) => d(a).sub(b)
export const mul = (a: DecValue, b: DecValue) => d(a).mul(b)
export const div = (a: DecValue, b: DecValue) => d(a).div(b)

export const min = (...vals: DecValue[]) => vals.map(d).reduce((m, x) => (x.lt(m) ? x : m))
export const max = (...vals: DecValue[]) => vals.map(d).reduce((m, x) => (x.gt(m) ? x : m))

// Only use this at DISPLAY boundaries (UI or final formatting), never inside calculations.
export const roundCurrency = (x: DecValue): number =>
  Number(d(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString())

// Utilities
export const ZERO = d(0)
export const toNumber = (x: DecValue) => Number(d(x).toString())
export const percentOf = (base: DecValue, pct: DecValue) => d(base).mul(d(pct)).div(100)

// Guard against negative values where not allowed (e.g., taxable wages)
export const clampNonNegative = (x: DecValue) => (d(x).isneg() ? ZERO : d(x))

