// /shared/tax/engine.ts

import { d, ZERO, clampNonNegative, max, min } from "./math"
import { calculateFederalTax } from "./federal"
import { calculateLocalTaxes } from "./locals"
import { calculateStateTaxes } from "./registry"
import { getStateCalculationMeta } from "./state"
import type { FilingStatus, PaycheckResult, TaxBreakdown, TaxContext, TaxProfileInput } from "./types"

/**
 * calculateNetPay()
 *
 * Unified paycheck calculator shared between backend and frontend.
 * Computes:
 *   - Pre-tax deductions (401k, insurance)
 *   - Federal, state, Social Security, and Medicare taxes
 *   - Post-tax deductions (Roth 401k, etc.)
 *   - Final net pay
 *
 * Returns a full PaycheckResult for display or storage.
 */

export function calculateNetPay(profile: TaxProfileInput): PaycheckResult {
  const gross = d(profile.grossIncome || 0)
  const freq = profile.payFrequency
  const dependents = profile.dependents || 0
  const filingStatus = normalizeStatus(profile.filingStatus)
  const state = profile.state || "Default"

  // ---------------------
  // 1. PRE-TAX DEDUCTIONS
  // ---------------------
  let pretaxDeductions = ZERO
  const customDeductions = d(profile.customDeductions || 0)

  // Traditional 401(k)
  if (profile.retirement401kType === "traditional") {
    if (profile.retirement401kPercent) {
      pretaxDeductions = pretaxDeductions.add(
        gross.mul(d(profile.retirement401kPercent)).div(100)
      )
    }
    if (profile.retirement401kFlat) {
      pretaxDeductions = pretaxDeductions.add(d(profile.retirement401kFlat))
    }
  }

  // Pre-tax insurance
  if (profile.insurancePreTax && profile.insurancePremium) {
    pretaxDeductions = pretaxDeductions.add(d(profile.insurancePremium))
  }

  const taxableIncome = clampNonNegative(gross.sub(pretaxDeductions))

  // ---------------------
  // 2. FEDERAL & STATE TAXES
  // ---------------------
  const federal = d(
    calculateFederalTax({
      grossIncome: taxableIncome.toNumber(),
      payFrequency: freq,
      filingStatus,
      dependents,
      federalMultipleJobsCheckbox: profile.federalMultipleJobsCheckbox,
      federalStep3Credits: profile.federalStep3Credits,
      federalOtherIncome: profile.federalOtherIncome,
      federalDeductions: profile.federalDeductions,
      federalExempt: profile.federalExempt,
      additionalFederalWithholding: profile.additionalFederalWithholding,
    })
  )
  
  let stateTax = ZERO
  let localTax = ZERO
  const taxContext: TaxContext = {
    grossIncome: gross.toNumber(),
    taxableIncome: taxableIncome.toNumber(),
            filingStatus,
            dependents,
            payFrequency: freq,
            state: profile.state,
            residenceState: profile.residenceState,
    workState: profile.workState,
    residenceCounty: profile.residenceCounty,
    workCounty: profile.workCounty,
    residenceCity: profile.residenceCity,
    workCity: profile.workCity,
    postalCode: profile.postalCode,
    schoolDistrictId: profile.schoolDistrictId,
    localTaxJurisdictionIds: profile.localTaxJurisdictionIds,
    ohioSchoolDistrictNumber: profile.ohioSchoolDistrictNumber,
    ohioSchoolDistrictIncomeTaxRate: profile.ohioSchoolDistrictIncomeTaxRate,
    ohioMunicipalIncomeTaxRate: profile.ohioMunicipalIncomeTaxRate,
    ohioJeddJedzIncomeTaxRate: profile.ohioJeddJedzIncomeTaxRate,
    oregonMetroLocation: profile.oregonMetroLocation,
    oregonMultnomahCountyLocation: profile.oregonMultnomahCountyLocation,
    oregonMetroWithholdingElection: profile.oregonMetroWithholdingElection,
    oregonPfaWithholdingElection: profile.oregonPfaWithholdingElection,
    newYorkLocality: profile.newYorkLocality,
    newYorkWithholdingExemptions: profile.newYorkWithholdingExemptions,
    pennsylvaniaResidentPsdCode: profile.pennsylvaniaResidentPsdCode,
    pennsylvaniaResidentEitRate: profile.pennsylvaniaResidentEitRate,
    pennsylvaniaWorkPsdCode: profile.pennsylvaniaWorkPsdCode,
    pennsylvaniaWorkNonResidentEitRate: profile.pennsylvaniaWorkNonResidentEitRate,
    reciprocityElection: profile.reciprocityElection,
    multiStateWorker: profile.multiStateWorker,
            profile,
  }
  const stateCalculation = calculateStateTaxes(taxContext)
  const localCalculation = calculateLocalTaxes(taxContext)
  stateTax = d(stateCalculation.stateTax)
  localTax = d(localCalculation.localTax)


  // ---------------------
  // 3. FICA (Social Security + Medicare)
  // ---------------------
  const ssRate = d(0.062) // Social Security 6.2%
  const medicareRate = d(0.0145) // Medicare 1.45%
  const annualGross = gross.mul(getPeriodsPerYear(freq))
  const socialSecurityWageBase = d(184500)
  const annualSocialSecurity = min(annualGross, socialSecurityWageBase).mul(ssRate)
  const additionalMedicareThreshold = d(getAdditionalMedicareThreshold(filingStatus))
  const annualMedicare = annualGross.mul(medicareRate).add(
    max(annualGross.sub(additionalMedicareThreshold), ZERO).mul(d(0.009))
  )
  const socialSecurity = annualSocialSecurity.div(getPeriodsPerYear(freq)).toDecimalPlaces(2)
  const medicare = annualMedicare.div(getPeriodsPerYear(freq)).toDecimalPlaces(2)
  const fica = socialSecurity.add(medicare)

  console.log(
    "[tax-engine.fica] breakdown",
    JSON.stringify({
      state: profile.state ?? null,
      residenceState: profile.residenceState ?? null,
      workState: profile.workState ?? null,
      filingStatus,
      payFrequency: freq,
      grossIncome: gross.toNumber(),
      pretaxDeductions: pretaxDeductions.toNumber(),
      taxableIncome: taxableIncome.toNumber(),
      retirement401kType: profile.retirement401kType ?? null,
      retirement401kPercent: profile.retirement401kPercent ?? null,
      retirement401kFlat: profile.retirement401kFlat ?? null,
      insurancePremium: profile.insurancePremium ?? null,
      insurancePreTax: profile.insurancePreTax ?? null,
      periodsPerYear: getPeriodsPerYear(freq),
      annualGross: annualGross.toNumber(),
      socialSecurityWageBase: socialSecurityWageBase.toNumber(),
      annualSocialSecurity: annualSocialSecurity.toNumber(),
      annualMedicare: annualMedicare.toNumber(),
      additionalMedicareThreshold: additionalMedicareThreshold.toNumber(),
      socialSecurity: socialSecurity.toNumber(),
      medicare: medicare.toNumber(),
      fica: fica.toNumber(),
      simplifiedFicaCheck: Number(
        gross.mul(d(0.0765)).toDecimalPlaces(2).toString()
      ),
    })
  )

  // ---------------------
  // 4. POST-TAX DEDUCTIONS
  // ---------------------
  let posttaxDeductions = ZERO

  // Roth 401(k)
  if (profile.retirement401kType === "roth") {
    if (profile.retirement401kPercent) {
      posttaxDeductions = posttaxDeductions.add(
        gross.mul(d(profile.retirement401kPercent)).div(100)
      )
    }
    if (profile.retirement401kFlat) {
      posttaxDeductions = posttaxDeductions.add(d(profile.retirement401kFlat))
    }
  }

  // Post-tax insurance (if not pre-tax)
  if (!profile.insurancePreTax && profile.insurancePremium) {
    posttaxDeductions = posttaxDeductions.add(d(profile.insurancePremium))
  }

  // ---------------------
  // 5. ADDITIONAL WITHHOLDING
  // ---------------------
  const addFed = d(profile.additionalFederalWithholding || 0)
  const addState = d(profile.additionalStateWithholding || 0)

  // ---------------------
  // 6. TOTAL TAXES & NET PAY
  // ---------------------
  const totalTaxes = federal.add(stateTax).add(localTax).add(fica)
  const totalDeductions = pretaxDeductions
    .add(totalTaxes)
    .add(posttaxDeductions)
    .add(customDeductions)
    .add(addFed)
    .add(addState)

  const netIncome = clampNonNegative(gross.sub(totalDeductions))

  // ---------------------
  // 7. ASSEMBLE BREAKDOWN
  // ---------------------
  const breakdown: TaxBreakdown = {
    federal: federal.toNumber(),
    state: stateTax.toNumber(),
    local: localTax.toNumber(),
    socialSecurity: socialSecurity.toNumber(),
    medicare: medicare.toNumber(),
    fica: fica.toNumber(),
    customDeductions: customDeductions.toNumber(),
    pretaxDeductions: {
      traditional401k:
        profile.retirement401kType === "traditional"
          ? pretaxDeductions.toNumber()
          : 0,
      insurancePreTax:
        profile.insurancePreTax && profile.insurancePremium
          ? d(profile.insurancePremium).toNumber()
          : 0,
    },
    posttaxDeductions: {
      roth401k:
        profile.retirement401kType === "roth"
          ? posttaxDeductions.toNumber()
          : 0,
      insurancePostTax:
        !profile.insurancePreTax && profile.insurancePremium
          ? d(profile.insurancePremium).toNumber()
          : 0,
    },
  }

  // ---------------------
  // 8. RETURN FINAL RESULT
  // ---------------------
  return {
    grossIncome: gross.toNumber(),
    taxableIncome: taxableIncome.toNumber(),
    netIncome: netIncome.toNumber(),
    breakdown,
    metadata: {
      state: getStateCalculationMeta(state),
    },
  }
}

function normalizeStatus(status: string): FilingStatus {
  // Canonical values used throughout your app and tables
  const canonical: FilingStatus[] = [
    "single",
    "marriedJoint",
    "marriedSeparate",
    "headOfHousehold",
  ];

  if (canonical.includes(status as FilingStatus)) {
    return status as FilingStatus;
  }

  //Never silently default — fail loudly to catch data mismatches early
  throw new Error(`Unknown filingStatus: ${status}`);
}

function getPeriodsPerYear(freq: TaxProfileInput["payFrequency"]): number {
  switch (freq) {
    case "weekly":
      return 52
    case "biweekly":
      return 26
    case "semi-monthly":
      return 24
    case "monthly":
      return 12
    case "annual":
      return 1
  }
}

function getAdditionalMedicareThreshold(status: FilingStatus): number {
  switch (status) {
    case "marriedJoint":
      return 250000
    case "marriedSeparate":
      return 125000
    case "single":
    case "headOfHousehold":
      return 200000
  }
}
