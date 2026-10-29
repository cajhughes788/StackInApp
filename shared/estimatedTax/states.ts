// /shared/estimatedTax/states.ts
// ------------------------------------------------------------
// State income tax for the self-employed estimate. A state is included
// only when its rules are simple enough to model exactly and every number
// is confirmed from that state's own revenue department for the year. Any
// other state shows "state not included yet" — never a guess, and never
// last year's numbers (the year table holds its own state list).
//
// Deliberately cautious, as with federal: no state credits, no state
// versions of the tips deduction, no county or city taxes (flagged).
// ------------------------------------------------------------
import { round2 } from "./calculate"
import type { FilingStatus } from "./types"

export type StateTaxRule =
  | { kind: "none"; source: string }
  | {
      kind: "flat"
      rate: number
      // federal_agi: rate × (federal AGI − deduction − exemptions).
      // pa_classes: Pennsylvania — rate × (business net profit, losses
      //   not offset against wages + wages); no deductions, and half of
      //   SE tax isn't deductible.
      base: "federal_agi" | "pa_classes"
      standardDeduction?: Record<FilingStatus, number>
      // federal_agi base only: the deductible half of self-employment tax
      // goes back onto AGI (Michigan Schedule 1, line 2).
      addBackSelfEmploymentTaxDeduction?: true
      // Per person on the return (2 when married filing jointly).
      personalExemption?: number
      dependentExemption?: number
      // No personal exemption above this federal AGI.
      exemptionAgiLimit?: Record<FilingStatus, number>
      localTaxNote?: string
      source: string
    }

export const US_STATES: Array<{ code: string; name: string }> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }))

export function stateName(code: string | null | undefined): string | null {
  return US_STATES.find((s) => s.code === code)?.name ?? null
}

const NO_WAGE_TAX = "No state tax on wages or business income."

// Tax year 2026.
export const STATE_TAX_2026: Record<string, StateTaxRule> = {
  AK: { kind: "none", source: NO_WAGE_TAX },
  FL: { kind: "none", source: NO_WAGE_TAX },
  NV: { kind: "none", source: NO_WAGE_TAX },
  // The interest and dividends tax was repealed for tax years after 2024.
  NH: { kind: "none", source: `${NO_WAGE_TAX} NH interest & dividends tax repealed after 2024.` },
  SD: { kind: "none", source: NO_WAGE_TAX },
  TN: { kind: "none", source: NO_WAGE_TAX },
  TX: { kind: "none", source: NO_WAGE_TAX },
  // Washington taxes only certain capital gains.
  WA: { kind: "none", source: `${NO_WAGE_TAX} WA taxes only certain capital gains.` },
  WY: { kind: "none", source: NO_WAGE_TAX },

  GA: {
    kind: "flat",
    rate: 0.0499,
    base: "federal_agi",
    standardDeduction: { single: 15_000, headOfHousehold: 15_000, marriedSeparate: 15_000, marriedJoint: 30_000 },
    dependentExemption: 5_000,
    source: "Georgia DOR, Important Tax Updates (HB 463, 2026): 4.99%; standard deduction $15,000 / $30,000 joint; $5,000 per dependent.",
  },
  IL: {
    kind: "flat",
    rate: 0.0495,
    base: "federal_agi",
    personalExemption: 2_925,
    dependentExemption: 2_925,
    exemptionAgiLimit: { single: 250_000, headOfHousehold: 250_000, marriedSeparate: 250_000, marriedJoint: 500_000 },
    source: "Illinois DOR, Bulletin FY 2026-15 and IL-700-T (2026): 4.95%; exemption $2,925 each, none over $250,000 AGI ($500,000 joint).",
  },
  KY: {
    kind: "flat",
    rate: 0.035,
    base: "federal_agi",
    // One deduction per return — conservative for married couples.
    standardDeduction: { single: 3_360, headOfHousehold: 3_360, marriedSeparate: 3_360, marriedJoint: 3_360 },
    localTaxNote: "Kentucky city and county occupational taxes aren't included.",
    source: "Kentucky DOR, 2026 standard deduction announcement and 2026 e-file handbook: 3.5%; standard deduction $3,360.",
  },
  MI: {
    kind: "flat",
    rate: 0.0425,
    base: "federal_agi",
    addBackSelfEmploymentTaxDeduction: true,
    personalExemption: 5_900,
    dependentExemption: 5_900,
    localTaxNote: "Michigan city income taxes (such as Detroit) aren't included.",
    source: "Michigan Treasury, 2026 tax year rate notice (Apr 2026) and 2026 withholding guide: 4.25%; exemption $5,900. Schedule 1 line 2 adds back the self-employment tax deduction.",
  },
  NC: {
    kind: "flat",
    rate: 0.0399,
    base: "federal_agi",
    standardDeduction: { single: 12_750, headOfHousehold: 19_125, marriedSeparate: 12_750, marriedJoint: 25_500 },
    source: "NCDOR, 2026 withholding tables and standard deduction chart: 3.99%; $12,750 / $25,500 joint / $19,125 head of household.",
  },
  PA: {
    kind: "flat",
    rate: 0.0307,
    base: "pa_classes",
    localTaxNote: "Pennsylvania local earned income tax isn't included.",
    source: "PA Department of Revenue, PIT rates and PA PIT Guide: 3.07%; no standard deduction or exemption; half of SE tax not deductible; business losses don't offset wages.",
  },
}

export type StateTaxResult =
  | { status: "not_chosen" }
  | { status: "not_included"; stateCode: string }
  | { status: "none"; stateCode: string; tax: 0 }
  | { status: "included"; stateCode: string; tax: number; taxableIncome: number; rate: number; localTaxNote: string | null }

export function computeStateTax(
  rules: Record<string, StateTaxRule> | null,
  stateCode: string | null,
  input: {
    filingStatus: FilingStatus
    federalAgi: number
    // The deductible half of self-employment tax, for states that add it back.
    selfEmploymentTaxDeduction?: number
    selfEmploymentProfit: number
    w2Wages: number
    qualifyingChildren: number
  }
): StateTaxResult {
  if (!stateCode) return { status: "not_chosen" }
  const rule = rules?.[stateCode]
  if (!rule) return { status: "not_included", stateCode }
  if (rule.kind === "none") return { status: "none", stateCode, tax: 0 }

  let taxableIncome: number
  if (rule.base === "pa_classes") {
    taxableIncome = Math.max(0, input.selfEmploymentProfit) + Math.max(0, input.w2Wages)
  } else {
    const people = input.filingStatus === "marriedJoint" ? 2 : 1
    const exemptionsAllowed =
      !rule.exemptionAgiLimit || input.federalAgi <= rule.exemptionAgiLimit[input.filingStatus]
    const exemptions = exemptionsAllowed
      ? (rule.personalExemption ?? 0) * people + (rule.dependentExemption ?? 0) * Math.max(0, input.qualifyingChildren)
      : 0
    const deduction = rule.standardDeduction?.[input.filingStatus] ?? 0
    const addBack = rule.addBackSelfEmploymentTaxDeduction ? Math.max(0, input.selfEmploymentTaxDeduction ?? 0) : 0
    taxableIncome = Math.max(0, input.federalAgi + addBack - deduction - exemptions)
  }
  taxableIncome = round2(taxableIncome)
  return {
    status: "included",
    stateCode,
    tax: round2(taxableIncome * rule.rate),
    taxableIncome,
    rate: rule.rate,
    localTaxNote: rule.localTaxNote ?? null,
  }
}
