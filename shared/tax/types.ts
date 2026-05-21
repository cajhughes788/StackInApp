// /shared/tax/types.ts
import type Decimal from "decimal.js-light"

// Optional helper alias (useful for any type annotations later)
export type DecimalValue = string | number | Decimal

// ---------------------------
// Core Shared Tax Interfaces
// ---------------------------

// Describes a single tax bracket range.
export interface TaxBracket {
  upTo: number | null              // null means no upper limit (top bracket)
  rate: number                     // e.g., 0.22 for 22%
  baseTax?: number                 // optional cumulative base amount for withholding table references
  baseAt?: number                  // lower threshold (used in progressive calculation)
}

export type BracketTableByStatus = Partial<
  Record<FilingStatus, TaxBracket[]>
>

// Federal table definition per filing status
export interface FederalTaxTable {
  standardDeduction: number
  dependentCredit: number           // credit per dependent for annualized computation
  brackets: TaxBracket[]
}

// Maps all filing statuses to their corresponding tables
export interface FederalTaxYear {
  single: FederalTaxTable
  marriedJoint: FederalTaxTable
  marriedSeparate: FederalTaxTable
  headOfHousehold: FederalTaxTable
}

// --------------------------------------------
// 🔹 Updated: State-specific structure (2025+)
// --------------------------------------------
// Now supports per-filing-status maps for deduction, dependentDeduction, and dependentCredit.
// Each field may be a single number (applied to all) or a Record keyed by filing status.
// This enables states like GA or CA to vary deductions by Single / Married / HOH.
export interface StateTaxInfo {
  brackets?: TaxBracket[] | BracketTableByStatus
  flatRate?: number
  deduction?: number | Record<string, number>          // e.g., { single: 5400, marriedJoint: 7400 }
  dependentDeduction?: number | Record<string, number> // per-dependent income-level deduction
  dependentCredit?: number | Record<string, number>    // per-dependent tax credit
  displayName?: string
  notes?: string
}

export interface StateCalculationMeta {
  code: string
  displayName: string
  taxYear: number
  status: "exact" | "approximate" | "incomplete"
  supportsLocalTaxes: boolean
  needsResidenceLocation: boolean
  needsWorkLocation: boolean
  notes?: string[]
}

export type StateSupportLevel =
  | "no_wage_tax"
  | "dedicated"
  | "approximate"
  | "local_inputs_required"

// Enumerates all supported filing statuses
export type FilingStatus =
  | "single"
  | "marriedJoint"
  | "marriedSeparate"
  | "headOfHousehold"

// Unified input object for any tax calculation
export interface TaxProfileInput {
  grossIncome: number
  filingStatus: FilingStatus
  dependents?: number
  federalMultipleJobsCheckbox?: boolean
  federalStep3Credits?: number
  federalOtherIncome?: number
  federalDeductions?: number
  federalExempt?: boolean
  // Deprecated shared field kept only as a fallback for older saved profiles.
  stateWithholdingExemptions?: number
  marylandWithholdingExemptions?: number
  delawareWithholdingExemptions?: number
  hawaiiWithholdingExemptions?: number
  maineWithholdingExemptions?: number
  minnesotaWithholdingExemptions?: number
  nebraskaWithholdingExemptions?: number
  southCarolinaWithholdingExemptions?: number
  districtOfColumbiaWithholdingExemptions?: number
  vermontWithholdingExemptions?: number
  westVirginiaWithholdingExemptions?: number
  wisconsinWithholdingExemptions?: number
  alabamaExemptionCode?: "0" | "S" | "MS" | "M" | "H"
  arkansasExemptions?: number
  arkansasLowIncomeRates?: boolean
  idahoAllowances?: number
  idahoAdditionalWithholding?: number
  idahoExempt?: boolean
  iowaAllowanceAmount?: number
  iowaAdditionalWithholding?: number
  iowaExempt?: boolean
  iowaSpouseHasIncome?: boolean
  iowaMilitarySpouseExempt?: boolean
  kansasAllowanceRate?: "single" | "joint"
  kansasAdditionalWithholding?: number
  kansasExempt?: boolean
  louisianaDeductionClaim?: "0" | "1" | "2"
  mississippiExemptionAmount?: number
  mississippiSpouseEmployed?: boolean
  missouriSpouseDoesNotWork?: boolean
  newMexicoHigherSingleRate?: boolean
  newMexicoExempt?: boolean
  newMexicoMilitarySpouseExempt?: boolean
  newMexicoNativeAmericanExempt?: boolean
  oklahomaAllowances?: number
  oklahomaHigherSingleRate?: boolean
  oklahomaAdditionalWithholding?: number
  oklahomaExempt?: boolean
  oklahomaMilitarySpouseExempt?: boolean
  oklahomaMilitaryIncomeExempt?: boolean
  arizonaWithholdingPercent?: number
  arizonaExempt?: boolean
  californiaRegularAllowances?: number
  californiaEstimatedDeductionAllowances?: number
  connecticutWithholdingCode?: "A" | "B" | "C" | "D" | "E" | "F"
  connecticutAdditionalWithholding?: number
  connecticutReducedWithholding?: number
  connecticutNonresidentApportionmentPercent?: number
  connecticutFifteenDayExempt?: boolean
  coloradoDeductionAmount?: number
  districtOfColumbiaExempt?: boolean
  georgiaAllowanceCount?: number
  georgiaMarriedBothWorking?: boolean
  hawaiiHigherSingleRate?: boolean
  hawaiiCertifiedDisabled?: boolean
  hawaiiNonresidentMilitarySpouse?: boolean
  illinoisAllowanceLine1?: number
  illinoisAllowanceLine2?: number
  indianaPersonalExemptions?: number
  indianaDependentExemptions?: number
  indianaFirstTimeDependentExemptions?: number
  indianaAdoptedChildExemptions?: number
  indianaAdditionalStateWithholding?: number
  indianaAdditionalCountyWithholding?: number
  indianaNonresidentThirtyDayExempt?: boolean
  indianaNonresidentMilitarySpouseExempt?: boolean
  massachusettsExemptions?: number
  massachusettsBlindExemptions?: number
  massachusettsFullTimeStudentExempt?: boolean
  massachusettsMsrraExempt?: boolean
  massachusettsAdditionalWithholding?: number
  maineHigherSingleRate?: boolean
  michiganExemptions?: number
  montanaBothSpousesWorking?: boolean
  montanaExempt?: boolean
  nebraskaExempt?: boolean
  newJerseyRateTable?: "A" | "B" | "C" | "D" | "E"
  newJerseyAllowances?: number
  newJerseyExempt?: boolean
  newYorkAdditionalStateWithholding?: number
  newYorkExempt?: boolean
  northCarolinaAllowances?: number
  ohioExemptions?: number
  ohioAdditionalStateWithholding?: number
  ohioResidentMilitaryOutsideOhioExempt?: boolean
  ohioNonresidentMilitaryExempt?: boolean
  ohioNonresidentMilitarySpouseExempt?: boolean
  ohioStatutoryExempt?: boolean
  oregonAllowances?: number
  oregonAdditionalWithholding?: number
  oregonHigherSingleRate?: boolean
  oregonExempt?: boolean
  southCarolinaExempt?: boolean
  westVirginiaLowerRateElection?: boolean
  virginiaPersonalExemptions?: number
  virginiaAgeBlindExemptions?: number
  virginiaExempt?: boolean
  payFrequency: "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
  state?: string
  residenceState?: string
  workState?: string
  residenceCounty?: string
  workCounty?: string
  residenceCity?: string
  workCity?: string
  postalCode?: string
  schoolDistrictId?: string
  localTaxJurisdictionIds?: string[]
  ohioSchoolDistrictNumber?: string
  ohioSchoolDistrictIncomeTaxRate?: number
  ohioMunicipalIncomeTaxRate?: number
  ohioJeddJedzIncomeTaxRate?: number
  oregonMetroLocation?: boolean
  oregonMultnomahCountyLocation?: boolean
  oregonMetroWithholdingElection?: "auto" | "opt_in" | "opt_out"
  oregonPfaWithholdingElection?: "auto" | "opt_in" | "opt_out"
  newYorkLocality?: "new_york_city_resident" | "yonkers_resident" | "yonkers_nonresident"
  newYorkWithholdingExemptions?: number
  pennsylvaniaResidentPsdCode?: string
  pennsylvaniaResidentEitRate?: number
  pennsylvaniaWorkPsdCode?: string
  pennsylvaniaWorkNonResidentEitRate?: number
  rhodeIslandAllowances?: number
  rhodeIslandAdditionalWithholding?: number
  rhodeIslandExemptStatus?: "EXEMPT" | "EXEMPT-MS"
  reciprocityElection?: boolean
  multiStateWorker?: boolean
  retirement401kType?: "traditional" | "roth"
  retirement401kPercent?: number
  retirement401kFlat?: number
  insurancePremium?: number
  insurancePreTax?: boolean
  customDeductions?: number
  additionalFederalWithholding?: number
  additionalStateWithholding?: number
  // optional per-state program percentages (e.g., WA PFML)
  pfmlPercent?: number
  waCaresPercent?: number
}

export interface TaxContext {
  grossIncome: number
  taxableIncome: number
  filingStatus: FilingStatus
  dependents: number
  payFrequency: TaxProfileInput["payFrequency"]
  state?: string
  residenceState?: string
  workState?: string
  residenceCounty?: string
  workCounty?: string
  residenceCity?: string
  workCity?: string
  postalCode?: string
  schoolDistrictId?: string
  localTaxJurisdictionIds?: string[]
  ohioSchoolDistrictNumber?: string
  ohioSchoolDistrictIncomeTaxRate?: number
  ohioMunicipalIncomeTaxRate?: number
  ohioJeddJedzIncomeTaxRate?: number
  oregonMetroLocation?: boolean
  oregonMultnomahCountyLocation?: boolean
  oregonMetroWithholdingElection?: "auto" | "opt_in" | "opt_out"
  oregonPfaWithholdingElection?: "auto" | "opt_in" | "opt_out"
  newYorkLocality?: "new_york_city_resident" | "yonkers_resident" | "yonkers_nonresident"
  newYorkWithholdingExemptions?: number
  pennsylvaniaResidentPsdCode?: string
  pennsylvaniaResidentEitRate?: number
  pennsylvaniaWorkPsdCode?: string
  pennsylvaniaWorkNonResidentEitRate?: number
  reciprocityElection?: boolean
  multiStateWorker?: boolean
  profile: TaxProfileInput
}

export interface StateCalculationResult {
  stateTax: number
  localTax: number
  supportLevel: StateSupportLevel
  calculationMethod: string
  warnings?: string[]
}

export interface StateTaxStrategy {
  stateCode: string
  applies: (context: TaxContext) => boolean
  calculate: (context: TaxContext) => StateCalculationResult
}

export interface LocalCalculationResult {
  localTax: number
  calculationMethod: string
  warnings?: string[]
}

export interface LocalTaxStrategy {
  jurisdictionCode: string
  applies: (context: TaxContext) => boolean
  calculate: (context: TaxContext) => LocalCalculationResult
}

// Breakdown of taxes and deductions for reporting or previews
export interface TaxBreakdown {
  federal: number
  state: number
  local: number
  socialSecurity: number
  medicare: number
  fica: number                      // combined SS + Medicare
  customDeductions?: number
  pretaxDeductions?: Record<string, number>
  posttaxDeductions?: Record<string, number>
}

// Final unified result returned by calculateNetPay()
export interface PaycheckResult {
  grossIncome: number
  taxableIncome: number
  netIncome: number
  breakdown: TaxBreakdown
  metadata?: {
    state: StateCalculationMeta
  }
}
