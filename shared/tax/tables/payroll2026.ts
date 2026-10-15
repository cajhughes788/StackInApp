// /shared/tax/tables/payroll2026.ts

import type { PayrollYearParams } from "../types"

/**
 * 2026 federal payroll withholding parameters.
 *
 * Sources:
 * - IRS Publication 15-T (2026), Worksheet 1A and the annual percentage-method
 *   schedules for 2020-and-later Forms W-4 (standard and Step 2 checkbox)
 * - SSA 2026 contribution and benefit base ($184,500)
 * - 2026 Form W-4 Step 3: $2,200 per qualifying child under 17, $500 per
 *   other dependent (One Big Beautiful Bill Act)
 * - Additional Medicare Tax: employers withhold 0.9% on wages over $200,000
 *   in the year regardless of filing status (the $250k/$125k thresholds only
 *   apply on the employee's return)
 */
export const PAYROLL_2026: PayrollYearParams = {
  year: 2026,
  socialSecurityRate: 0.062,
  socialSecurityWageBase: 184_500,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareWithholdingThreshold: 200_000,
  childTaxCredit: 2_200,
  otherDependentCredit: 500,
  worksheet1AAdjustment: { marriedJoint: 12_900, other: 8_600 },
  standardSchedules: {
    marriedJoint: [
      { atLeast: 0, lessThan: 19_300, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 19_300, lessThan: 44_100, baseWithholding: 0, rate: 0.10, baseThreshold: 19_300 },
      { atLeast: 44_100, lessThan: 120_100, baseWithholding: 2_480, rate: 0.12, baseThreshold: 44_100 },
      { atLeast: 120_100, lessThan: 230_700, baseWithholding: 11_600, rate: 0.22, baseThreshold: 120_100 },
      { atLeast: 230_700, lessThan: 422_850, baseWithholding: 35_932, rate: 0.24, baseThreshold: 230_700 },
      { atLeast: 422_850, lessThan: 531_750, baseWithholding: 82_048, rate: 0.32, baseThreshold: 422_850 },
      { atLeast: 531_750, lessThan: 788_000, baseWithholding: 116_896, rate: 0.35, baseThreshold: 531_750 },
      { atLeast: 788_000, lessThan: null, baseWithholding: 206_583.5, rate: 0.37, baseThreshold: 788_000 },
    ],
    single: [
      { atLeast: 0, lessThan: 7_500, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 7_500, lessThan: 19_900, baseWithholding: 0, rate: 0.10, baseThreshold: 7_500 },
      { atLeast: 19_900, lessThan: 57_900, baseWithholding: 1_240, rate: 0.12, baseThreshold: 19_900 },
      { atLeast: 57_900, lessThan: 113_200, baseWithholding: 5_800, rate: 0.22, baseThreshold: 57_900 },
      { atLeast: 113_200, lessThan: 209_275, baseWithholding: 17_966, rate: 0.24, baseThreshold: 113_200 },
      { atLeast: 209_275, lessThan: 263_725, baseWithholding: 41_024, rate: 0.32, baseThreshold: 209_275 },
      { atLeast: 263_725, lessThan: 648_100, baseWithholding: 58_448, rate: 0.35, baseThreshold: 263_725 },
      { atLeast: 648_100, lessThan: null, baseWithholding: 192_979.25, rate: 0.37, baseThreshold: 648_100 },
    ],
    marriedSeparate: [
      { atLeast: 0, lessThan: 7_500, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 7_500, lessThan: 19_900, baseWithholding: 0, rate: 0.10, baseThreshold: 7_500 },
      { atLeast: 19_900, lessThan: 57_900, baseWithholding: 1_240, rate: 0.12, baseThreshold: 19_900 },
      { atLeast: 57_900, lessThan: 113_200, baseWithholding: 5_800, rate: 0.22, baseThreshold: 57_900 },
      { atLeast: 113_200, lessThan: 209_275, baseWithholding: 17_966, rate: 0.24, baseThreshold: 113_200 },
      { atLeast: 209_275, lessThan: 263_725, baseWithholding: 41_024, rate: 0.32, baseThreshold: 209_275 },
      { atLeast: 263_725, lessThan: 648_100, baseWithholding: 58_448, rate: 0.35, baseThreshold: 263_725 },
      { atLeast: 648_100, lessThan: null, baseWithholding: 192_979.25, rate: 0.37, baseThreshold: 648_100 },
    ],
    headOfHousehold: [
      { atLeast: 0, lessThan: 15_550, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 15_550, lessThan: 33_250, baseWithholding: 0, rate: 0.10, baseThreshold: 15_550 },
      { atLeast: 33_250, lessThan: 83_000, baseWithholding: 1_770, rate: 0.12, baseThreshold: 33_250 },
      { atLeast: 83_000, lessThan: 121_250, baseWithholding: 7_740, rate: 0.22, baseThreshold: 83_000 },
      { atLeast: 121_250, lessThan: 217_300, baseWithholding: 16_155, rate: 0.24, baseThreshold: 121_250 },
      { atLeast: 217_300, lessThan: 271_750, baseWithholding: 39_207, rate: 0.32, baseThreshold: 217_300 },
      { atLeast: 271_750, lessThan: 656_150, baseWithholding: 56_631, rate: 0.35, baseThreshold: 271_750 },
      { atLeast: 656_150, lessThan: null, baseWithholding: 191_171, rate: 0.37, baseThreshold: 656_150 },
    ],
  },
  step2Schedules: {
    marriedJoint: [
      { atLeast: 0, lessThan: 16_100, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 16_100, lessThan: 28_500, baseWithholding: 0, rate: 0.10, baseThreshold: 16_100 },
      { atLeast: 28_500, lessThan: 66_500, baseWithholding: 1_240, rate: 0.12, baseThreshold: 28_500 },
      { atLeast: 66_500, lessThan: 121_800, baseWithholding: 5_800, rate: 0.22, baseThreshold: 66_500 },
      { atLeast: 121_800, lessThan: 217_875, baseWithholding: 17_966, rate: 0.24, baseThreshold: 121_800 },
      { atLeast: 217_875, lessThan: 272_325, baseWithholding: 41_024, rate: 0.32, baseThreshold: 217_875 },
      { atLeast: 272_325, lessThan: 400_450, baseWithholding: 58_448, rate: 0.35, baseThreshold: 272_325 },
      { atLeast: 400_450, lessThan: null, baseWithholding: 103_291.75, rate: 0.37, baseThreshold: 400_450 },
    ],
    single: [
      { atLeast: 0, lessThan: 8_050, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 8_050, lessThan: 14_250, baseWithholding: 0, rate: 0.10, baseThreshold: 8_050 },
      { atLeast: 14_250, lessThan: 33_250, baseWithholding: 620, rate: 0.12, baseThreshold: 14_250 },
      { atLeast: 33_250, lessThan: 60_900, baseWithholding: 2_900, rate: 0.22, baseThreshold: 33_250 },
      { atLeast: 60_900, lessThan: 108_938, baseWithholding: 8_983, rate: 0.24, baseThreshold: 60_900 },
      { atLeast: 108_938, lessThan: 136_163, baseWithholding: 20_512, rate: 0.32, baseThreshold: 108_938 },
      { atLeast: 136_163, lessThan: 328_350, baseWithholding: 29_224, rate: 0.35, baseThreshold: 136_163 },
      { atLeast: 328_350, lessThan: null, baseWithholding: 96_489.63, rate: 0.37, baseThreshold: 328_350 },
    ],
    marriedSeparate: [
      { atLeast: 0, lessThan: 8_050, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 8_050, lessThan: 14_250, baseWithholding: 0, rate: 0.10, baseThreshold: 8_050 },
      { atLeast: 14_250, lessThan: 33_250, baseWithholding: 620, rate: 0.12, baseThreshold: 14_250 },
      { atLeast: 33_250, lessThan: 60_900, baseWithholding: 2_900, rate: 0.22, baseThreshold: 33_250 },
      { atLeast: 60_900, lessThan: 108_938, baseWithholding: 8_983, rate: 0.24, baseThreshold: 60_900 },
      { atLeast: 108_938, lessThan: 136_163, baseWithholding: 20_512, rate: 0.32, baseThreshold: 108_938 },
      { atLeast: 136_163, lessThan: 328_350, baseWithholding: 29_224, rate: 0.35, baseThreshold: 136_163 },
      { atLeast: 328_350, lessThan: null, baseWithholding: 96_489.63, rate: 0.37, baseThreshold: 328_350 },
    ],
    headOfHousehold: [
      { atLeast: 0, lessThan: 12_075, baseWithholding: 0, rate: 0, baseThreshold: 0 },
      { atLeast: 12_075, lessThan: 20_925, baseWithholding: 0, rate: 0.10, baseThreshold: 12_075 },
      { atLeast: 20_925, lessThan: 45_800, baseWithholding: 885, rate: 0.12, baseThreshold: 20_925 },
      { atLeast: 45_800, lessThan: 64_925, baseWithholding: 3_870, rate: 0.22, baseThreshold: 45_800 },
      { atLeast: 64_925, lessThan: 112_950, baseWithholding: 8_077.5, rate: 0.24, baseThreshold: 64_925 },
      { atLeast: 112_950, lessThan: 140_175, baseWithholding: 19_603.5, rate: 0.32, baseThreshold: 112_950 },
      { atLeast: 140_175, lessThan: 332_375, baseWithholding: 28_315.5, rate: 0.35, baseThreshold: 140_175 },
      { atLeast: 332_375, lessThan: null, baseWithholding: 95_585.5, rate: 0.37, baseThreshold: 332_375 },
    ],
  },
}
