// /shared/tax/tables/federal2026.ts

import type { FederalTaxYear } from "../types"

/**
 * 2026 IRS federal income tax schedules.
 *
 * Source:
 * - IRS tax year 2026 inflation adjustments / Revenue Procedure 2025-32
 * - IRS federal income tax rates and brackets page
 */
export const FEDERAL_2026: FederalTaxYear = {
  single: {
    standardDeduction: 16100,
    dependentCredit: 2000,
    brackets: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  marriedJoint: {
    standardDeduction: 32200,
    dependentCredit: 2000,
    brackets: [
      { upTo: 24800, rate: 0.10 },
      { upTo: 100800, rate: 0.12 },
      { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 },
      { upTo: 512450, rate: 0.32 },
      { upTo: 768700, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  marriedSeparate: {
    standardDeduction: 16100,
    dependentCredit: 2000,
    brackets: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 384350, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  headOfHousehold: {
    standardDeduction: 24150,
    dependentCredit: 2000,
    brackets: [
      { upTo: 17700, rate: 0.10 },
      { upTo: 67450, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201750, rate: 0.24 },
      { upTo: 256200, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
}
