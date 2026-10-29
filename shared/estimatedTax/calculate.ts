// /shared/estimatedTax/calculate.ts
// ------------------------------------------------------------
// Federal tax a self-employed person owes for a year, worked the way the
// IRS forms do it, line by line, so every number can be checked and shown:
//
//   Schedule SE  → self-employment tax and its deductible half
//   Form 8959    → Additional Medicare Tax
//   1040         → AGI, standard deduction, QBI deduction (Form 8995),
//                  tax from the brackets, child tax credit
//   Form 1040-ES → the penalty-free (safe harbor) payment target
//
// Deliberately simple and conservative: standard deduction only, no
// credits besides the nonrefundable child tax credit, ordinary income only.
// Anything outside that is reported in `unsupported` so the caller shows
// "talk to a tax pro" instead of a confident wrong number. Pure — no I/O.
// ------------------------------------------------------------
import type { TaxBracket } from "../tax/types"
import type { EstimatedTaxYear, FilingStatus } from "./types"
import { findTippedOccupation, NO_TIPPED_OCCUPATION } from "./tippedOccupations"

export type FederalEstimateInput = {
  filingStatus: FilingStatus
  // Schedule C net profit across all of the person's businesses (can be a
  // loss). Income minus expenses, as on the P&L.
  selfEmploymentProfit: number
  // W-2 wages (box 1). Also used as Social Security wages for the wage
  // base, which matches for most people (no pre-tax 401(k) adjustments).
  w2Wages?: number
  // Other ordinary income (interest, unemployment…). Optional.
  otherIncome?: number
  qualifyingChildren?: number
  // Tips received in the business (already part of the profit) and the
  // person's line of work, for the "no tax on tips" deduction.
  tips?: { amount: number; occupationCode: string | null }
  // Tips from W-2 jobs reported to the employer (already part of w2Wages)
  // and the job's line of work — what the employer reports on the W-2
  // (Box 12 code TP, Box 14b). "000" or "none" = they don't qualify.
  w2Tips?: { amount: number; occupationCode: string | null }
}

export type TipsDeductionStatus =
  | "applied"
  | "no_tips"
  | "occupation_not_chosen"
  | "not_tipped_occupation"
  // Possibly a specified service business: left out, a tax pro can confirm.
  | "specified_service"
  | "married_separately"
  | "phased_out"
  | "not_this_year"

export type UnsupportedReason =
  // Above the §199A threshold the QBI deduction depends on wages paid,
  // property and business type.
  | "qbi_above_threshold"

export type FederalEstimate = {
  year: number
  filingStatus: FilingStatus
  lines: {
    // Schedule SE
    netEarningsFromSelfEmployment: number
    socialSecurityTaxableEarnings: number
    socialSecurityTax: number
    medicareTax: number
    selfEmploymentTax: number
    selfEmploymentTaxDeduction: number
    // Form 8959
    additionalMedicareTax: number
    // 1040
    totalIncome: number
    adjustedGrossIncome: number
    standardDeduction: number
    tipsDeduction: number
    taxableIncomeBeforeQbi: number
    qualifiedBusinessIncome: number
    qbiDeduction: number
    taxableIncome: number
    incomeTaxBeforeCredits: number
    childTaxCredit: number
    incomeTax: number
  }
  // Income tax + self-employment tax + Additional Medicare Tax.
  totalTax: number
  marginalRate: number
  tipsDeductionStatus: TipsDeductionStatus
  unsupported: UnsupportedReason[]
}

// Half-up to the cent. toPrecision first so binary float noise (46,175 ×
// 0.029 = 1,339.0749999…) rounds the way a person working the form would.
export function round2(value: number): number {
  return Math.round(Number((value * 100).toPrecision(15))) / 100
}

/** Tax from a bracket table (each `upTo` is the top of that bracket). */
export function taxFromBrackets(taxableIncome: number, brackets: TaxBracket[]): number {
  let tax = 0
  let lower = 0
  for (const bracket of brackets) {
    const upper = bracket.upTo ?? Infinity
    if (taxableIncome <= lower) break
    tax += (Math.min(taxableIncome, upper) - lower) * bracket.rate
    lower = upper
  }
  return round2(tax)
}

export function marginalRateFor(taxableIncome: number, brackets: TaxBracket[]): number {
  for (const bracket of brackets) {
    if (bracket.upTo == null || taxableIncome < bracket.upTo) return bracket.rate
  }
  return brackets[brackets.length - 1]?.rate ?? 0
}

/** Schedule SE (short method: one business, wages counted for the base). */
export function computeSelfEmploymentTax(table: EstimatedTaxYear, profit: number, w2Wages = 0) {
  const se = table.selfEmployment
  const netEarnings = round2(Math.max(0, profit) * se.netEarningsFactor)
  if (netEarnings < se.minimumNetEarnings) {
    return { netEarnings: 0, socialSecurityTaxableEarnings: 0, socialSecurityTax: 0, medicareTax: 0, total: 0, deduction: 0 }
  }
  // Social Security stops at the wage base, which W-2 wages use up first.
  const socialSecurityTaxableEarnings = round2(Math.min(netEarnings, Math.max(0, se.socialSecurityWageBase - Math.max(0, w2Wages))))
  const socialSecurityTax = round2(socialSecurityTaxableEarnings * se.socialSecurityRate)
  const medicareTax = round2(netEarnings * se.medicareRate)
  const total = round2(socialSecurityTax + medicareTax)
  return {
    netEarnings,
    socialSecurityTaxableEarnings,
    socialSecurityTax,
    medicareTax,
    total,
    deduction: round2(total / 2),
  }
}

/** Form 8959: 0.9% on wages plus self-employment earnings over the
 * threshold (wages use up the threshold first). */
export function computeAdditionalMedicareTax(
  table: EstimatedTaxYear,
  filingStatus: FilingStatus,
  w2Wages: number,
  netEarnings: number
): number {
  const threshold = table.additionalMedicare.threshold[filingStatus]
  const wages = Math.max(0, w2Wages)
  const wagesOver = Math.max(0, wages - threshold)
  const selfEmploymentOver = Math.max(0, netEarnings - Math.max(0, threshold - wages))
  return round2((wagesOver + selfEmploymentOver) * table.additionalMedicare.rate)
}

/** Form 8995 (below the threshold only). */
export function computeQbiDeduction(
  table: EstimatedTaxYear,
  filingStatus: FilingStatus,
  qualifiedBusinessIncome: number,
  taxableIncomeBeforeQbi: number
): { deduction: number; aboveThreshold: boolean } {
  const q = table.qbi
  const aboveThreshold = taxableIncomeBeforeQbi > q.threshold[filingStatus]
  if (qualifiedBusinessIncome <= 0 || taxableIncomeBeforeQbi <= 0) return { deduction: 0, aboveThreshold }
  let deduction = qualifiedBusinessIncome * q.rate
  // Above the threshold the deduction is held to a share of W-2 wages the
  // business pays and its property. A one-person business usually has
  // neither, so the limit is taken as $0 (the cautious case): the
  // deduction phases out to nothing across the phase-in range. Paying
  // employees or owning business property would leave some of it.
  if (aboveThreshold) {
    const phasedIn = Math.min(1, (taxableIncomeBeforeQbi - q.threshold[filingStatus]) / q.phaseInRange[filingStatus])
    deduction *= 1 - phasedIn
  }
  // §199A(i) minimum, for at least $1,000 of QBI.
  if (qualifiedBusinessIncome >= q.minimumDeductionQbiFloor) deduction = Math.max(deduction, q.minimumDeduction)
  // Never more than 20% of taxable income (conservative: the minimum is
  // held to this limit too).
  deduction = Math.min(deduction, taxableIncomeBeforeQbi * q.rate)
  return { deduction: round2(deduction), aboveThreshold }
}

/** "No tax on tips" (Schedule 1-A): qualified tips — business tips up to
 * the business's net income, plus W-2 tips — up to the cap, then reduced
 * $100 for each full $1,000 of modified AGI over the threshold (§224(b)(2);
 * Schedule 1-A drops a partial $1,000). Income tax only. The status
 * describes the business tips (the card's note); W-2 tips follow what the
 * employer reports on the W-2. */
export function computeTipsDeduction(
  table: EstimatedTaxYear,
  filingStatus: FilingStatus,
  tips: FederalEstimateInput["tips"],
  modifiedAgi: number,
  businessNetIncome: number,
  w2Tips?: FederalEstimateInput["w2Tips"]
): { deduction: number; status: TipsDeductionStatus } {
  const rules = table.tipsDeduction
  if (!rules) return { deduction: 0, status: "not_this_year" }
  const threshold = rules.phaseOutThreshold[filingStatus]

  // W-2 tips: qualify when the job's line of work is on the list (the
  // employer's Box 14b; it reports "000" when they don't).
  const w2Amount = Math.max(0, Number(w2Tips?.amount) || 0)
  const w2Code = w2Tips?.occupationCode ?? null
  const w2Qualified = w2Amount > 0 && w2Code && w2Code !== NO_TIPPED_OCCUPATION && findTippedOccupation(w2Code) ? w2Amount : 0

  // Business tips: the business's own line of work.
  const amount = Math.max(0, Number(tips?.amount) || 0)
  const code = tips?.occupationCode ?? null
  const occupation = code && code !== NO_TIPPED_OCCUPATION ? findTippedOccupation(code) : null
  let status: TipsDeductionStatus
  let businessQualified = 0
  if (amount <= 0) status = "no_tips"
  else if (!code) status = "occupation_not_chosen"
  else if (!occupation) status = "not_tipped_occupation"
  else if (occupation.specifiedServiceRisk) status = "specified_service"
  else {
    status = "applied"
    businessQualified = Math.max(0, Math.min(amount, Math.max(0, businessNetIncome)))
  }
  if (businessQualified + w2Qualified <= 0) return { deduction: 0, status }
  if (threshold == null) return { deduction: 0, status: "married_separately" }
  const allowed = Math.min(businessQualified + w2Qualified, rules.maxDeduction)
  if (allowed <= 0) return { deduction: 0, status: "no_tips" }
  const reduction = Math.floor(Math.max(0, modifiedAgi - threshold) / 1000) * 1000 * rules.phaseOutRate
  const deduction = round2(Math.max(0, allowed - reduction))
  if (deduction <= 0) return { deduction: 0, status: "phased_out" }
  return { deduction, status: businessQualified > 0 ? "applied" : status }
}

export function computeChildTaxCredit(
  table: EstimatedTaxYear,
  filingStatus: FilingStatus,
  children: number,
  adjustedGrossIncome: number,
  incomeTaxBeforeCredits: number
): number {
  const ctc = table.childTaxCredit
  if (children <= 0) return 0
  const over = Math.max(0, adjustedGrossIncome - ctc.phaseOutThreshold[filingStatus])
  const reduction = Math.ceil(over / 1000) * ctc.phaseOutPerThousand
  const credit = Math.max(0, children * ctc.perChild - reduction)
  // Nonrefundable part only: it can't take income tax below zero.
  return round2(Math.min(credit, incomeTaxBeforeCredits))
}

export function computeFederalEstimate(table: EstimatedTaxYear, input: FederalEstimateInput): FederalEstimate {
  const { filingStatus } = input
  const profit = Number(input.selfEmploymentProfit) || 0
  const w2Wages = Math.max(0, Number(input.w2Wages) || 0)
  const otherIncome = Number(input.otherIncome) || 0
  const children = Math.max(0, Math.floor(Number(input.qualifyingChildren) || 0))
  const federal = table.federal[filingStatus]

  const se = computeSelfEmploymentTax(table, profit, w2Wages)
  const additionalMedicareTax = computeAdditionalMedicareTax(table, filingStatus, w2Wages, se.netEarnings)

  const totalIncome = round2(profit + w2Wages + otherIncome)
  const adjustedGrossIncome = round2(totalIncome - se.deduction)
  // QBI is the business profit less the deductible part of SE tax.
  const qualifiedBusinessIncome = round2(Math.max(0, profit - se.deduction))
  // Comes off before the QBI deduction, whose limit uses taxable income
  // after it. Net business income is held to QBI (the cautious reading).
  const tipsResult = computeTipsDeduction(table, filingStatus, input.tips, adjustedGrossIncome, qualifiedBusinessIncome, input.w2Tips)
  const taxableIncomeBeforeQbi = round2(Math.max(0, adjustedGrossIncome - federal.standardDeduction - tipsResult.deduction))
  const qbi = computeQbiDeduction(table, filingStatus, qualifiedBusinessIncome, taxableIncomeBeforeQbi)
  const taxableIncome = round2(Math.max(0, taxableIncomeBeforeQbi - qbi.deduction))
  const incomeTaxBeforeCredits = taxFromBrackets(taxableIncome, federal.brackets)
  const childTaxCredit = computeChildTaxCredit(table, filingStatus, children, adjustedGrossIncome, incomeTaxBeforeCredits)
  const incomeTax = round2(incomeTaxBeforeCredits - childTaxCredit)

  const unsupported: UnsupportedReason[] = []
  if (qbi.aboveThreshold && qualifiedBusinessIncome > 0) unsupported.push("qbi_above_threshold")

  return {
    year: table.year,
    filingStatus,
    lines: {
      netEarningsFromSelfEmployment: se.netEarnings,
      socialSecurityTaxableEarnings: se.socialSecurityTaxableEarnings,
      socialSecurityTax: se.socialSecurityTax,
      medicareTax: se.medicareTax,
      selfEmploymentTax: se.total,
      selfEmploymentTaxDeduction: se.deduction,
      additionalMedicareTax,
      totalIncome,
      adjustedGrossIncome,
      standardDeduction: federal.standardDeduction,
      tipsDeduction: tipsResult.deduction,
      taxableIncomeBeforeQbi,
      qualifiedBusinessIncome,
      qbiDeduction: qbi.deduction,
      taxableIncome,
      incomeTaxBeforeCredits,
      childTaxCredit,
      incomeTax,
    },
    totalTax: round2(incomeTax + se.total + additionalMedicareTax),
    marginalRate: marginalRateFor(taxableIncome, federal.brackets),
    tipsDeductionStatus: tipsResult.status,
    unsupported,
  }
}

export type SafeHarborInput = {
  filingStatus: FilingStatus
  // Total tax on last year's return (Form 1040 line 24). Null = unknown.
  priorYearTax: number | null
  priorYearAgi: number | null
  // This year's estimated total tax, when there is one.
  currentYearTax: number | null
}

export type SafeHarborTarget = {
  // Total withholding + estimated payments for the year that avoids the
  // underpayment penalty. Null when neither basis is known.
  annualTarget: number | null
  basis: "prior_year" | "prior_year_high_income" | "current_year" | "no_prior_year_tax" | null
  priorYearTarget: number | null
  currentYearTarget: number | null
}

/** Form 1040-ES: the smaller of 90% of this year's tax or 100% (110% over
 * the AGI limit) of last year's. No prior-year tax at all → nothing is
 * required (assumes last year was a full 12-month year as a US resident). */
export function computeSafeHarborTarget(table: EstimatedTaxYear, input: SafeHarborInput): SafeHarborTarget {
  const sh = table.safeHarbor
  const priorYearTax = input.priorYearTax == null ? null : Math.max(0, input.priorYearTax)
  const highIncome = input.priorYearAgi != null && input.priorYearAgi > sh.highIncomeAgi[input.filingStatus]
  const priorYearTarget =
    priorYearTax == null ? null : round2(priorYearTax * (highIncome ? sh.priorYearShareHighIncome : sh.priorYearShare))
  const currentYearTarget = input.currentYearTax == null ? null : round2(Math.max(0, input.currentYearTax) * sh.currentYearShare)

  if (priorYearTax === 0) {
    return { annualTarget: 0, basis: "no_prior_year_tax", priorYearTarget: 0, currentYearTarget }
  }
  if (priorYearTarget == null && currentYearTarget == null) {
    return { annualTarget: null, basis: null, priorYearTarget, currentYearTarget }
  }
  if (currentYearTarget == null || (priorYearTarget != null && priorYearTarget <= currentYearTarget)) {
    return {
      annualTarget: priorYearTarget,
      basis: highIncome ? "prior_year_high_income" : "prior_year",
      priorYearTarget,
      currentYearTarget,
    }
  }
  return { annualTarget: currentYearTarget, basis: "current_year", priorYearTarget, currentYearTarget }
}
