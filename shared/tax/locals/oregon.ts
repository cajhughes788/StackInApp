import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createLocalCalculationResult } from "./strategyUtils"
import type { FilingStatus, LocalTaxStrategy, TaxContext, TaxProfileInput } from "../types"

type PayrollFrequency = TaxProfileInput["payFrequency"]
type OregonWithholdingElection = "auto" | "opt_in" | "opt_out"

const OREGON_STATEWIDE_TRANSIT_RATE = 0.001
const METRO_RATE = 0.01
const METRO_AUTO_THRESHOLD = 200000
const PFA_LOWER_RATE = 0.015
const PFA_UPPER_RATE = 0.03
const PFA_AUTO_THRESHOLD = 200000
const PFA_UPPER_THRESHOLD = 400000
const NON_JOINT_THRESHOLD = 125000
const NON_JOINT_UPPER_THRESHOLD = 250000

function getPeriodsPerYear(payFrequency: PayrollFrequency): number {
  switch (payFrequency) {
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

function getOregonStateContext(context: TaxContext): {
  primaryState: string
  residenceState: string
  workState: string
} {
  return {
    primaryState: normalizeStateKey(context.state ?? ""),
    residenceState: normalizeStateKey(context.residenceState ?? context.state ?? ""),
    workState: normalizeStateKey(context.workState ?? context.state ?? ""),
  }
}

function annualizeWages(context: TaxContext): number {
  return d(context.taxableIncome).mul(getPeriodsPerYear(context.payFrequency)).toNumber()
}

function deannualizeTax(context: TaxContext, annualTax: number): number {
  return d(annualTax)
    .div(getPeriodsPerYear(context.payFrequency))
    .toDecimalPlaces(2)
    .toNumber()
}

function getElection(
  election: OregonWithholdingElection | undefined
): OregonWithholdingElection {
  return election ?? "auto"
}

function isAutoWithholdingActive(
  annualizedWages: number,
  threshold: number,
  election: OregonWithholdingElection
): boolean {
  if (election === "opt_out") {
    return false
  }

  if (election === "opt_in") {
    return true
  }

  return annualizedWages >= threshold
}

function calculateOregonStatewideTransitTax(context: TaxContext): number {
  const { primaryState, residenceState, workState } = getOregonStateContext(context)
  const isOregonResident = residenceState === "Oregon"
  const worksInOregon = workState === "Oregon"

  if (
    primaryState !== "Oregon" &&
    !isOregonResident &&
    !worksInOregon
  ) {
    return 0
  }

  if (!isOregonResident && !worksInOregon) {
    return 0
  }

  return d(context.taxableIncome)
    .mul(OREGON_STATEWIDE_TRANSIT_RATE)
    .toDecimalPlaces(2)
    .toNumber()
}

function calculateMetroTax(context: TaxContext): number {
  if (!context.oregonMetroLocation) {
    return 0
  }

  const election = getElection(context.oregonMetroWithholdingElection)
  const annualizedWages = annualizeWages(context)

  if (!isAutoWithholdingActive(annualizedWages, METRO_AUTO_THRESHOLD, election)) {
    return 0
  }

  const annualTax = Math.max(annualizedWages - METRO_AUTO_THRESHOLD, 0) * METRO_RATE
  return deannualizeTax(context, annualTax)
}

function calculatePfaTax(context: TaxContext): number {
  if (!context.oregonMultnomahCountyLocation) {
    return 0
  }

  const election = getElection(context.oregonPfaWithholdingElection)
  const annualizedWages = annualizeWages(context)

  if (!isAutoWithholdingActive(annualizedWages, PFA_AUTO_THRESHOLD, election)) {
    return 0
  }

  const lowerBand = Math.max(Math.min(annualizedWages, PFA_UPPER_THRESHOLD) - PFA_AUTO_THRESHOLD, 0)
  const upperBand = Math.max(annualizedWages - PFA_UPPER_THRESHOLD, 0)
  const annualTax = lowerBand * PFA_LOWER_RATE + upperBand * PFA_UPPER_RATE

  return deannualizeTax(context, annualTax)
}

function needsSingleFilerWarning(
  filingStatus: FilingStatus,
  annualizedWages: number
): boolean {
  return (
    filingStatus !== "marriedJoint" &&
    annualizedWages > NON_JOINT_THRESHOLD
  )
}

export function calculateOregonLocalTax(context: TaxContext): number {
  return d(calculateOregonStatewideTransitTax(context))
    .add(calculateMetroTax(context))
    .add(calculatePfaTax(context))
    .toDecimalPlaces(2)
    .toNumber()
}

export const oregonLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "Oregon",
  applies: (context) => {
    const { primaryState, residenceState, workState } = getOregonStateContext(context)
    return (
      primaryState === "Oregon" ||
      residenceState === "Oregon" ||
      workState === "Oregon"
    )
  },
  calculate: (context) => {
    const warnings: string[] = []
    const annualizedWages = annualizeWages(context)
    const metroElection = getElection(context.oregonMetroWithholdingElection)
    const pfaElection = getElection(context.oregonPfaWithholdingElection)

    if (context.oregonMetroLocation && metroElection === "auto" && needsSingleFilerWarning(context.filingStatus, annualizedWages)) {
      warnings.push(
        "Metro SHS automatic payroll withholding starts at $200,000 of annual wages, but single, head-of-household, and married-separate filers can owe Metro tax sooner on the final return."
      )
    }

    if (context.oregonMultnomahCountyLocation && pfaElection === "auto" && needsSingleFilerWarning(context.filingStatus, annualizedWages)) {
      warnings.push(
        "Multnomah County PFA automatic payroll withholding starts at $200,000 of annual wages, but non-joint filers can owe PFA tax once Oregon taxable income exceeds $125,000."
      )
    }

    if (context.oregonMetroLocation && metroElection === "opt_in" && annualizedWages <= NON_JOINT_THRESHOLD) {
      warnings.push(
        "Metro SHS withholding is being applied because the employee opted in, even though annualized wages are below the usual non-joint Metro tax threshold."
      )
    }

    if (context.oregonMultnomahCountyLocation && pfaElection === "opt_in" && annualizedWages <= NON_JOINT_THRESHOLD) {
      warnings.push(
        "Multnomah County PFA withholding is being applied because the employee opted in, even though annualized wages are below the usual non-joint PFA tax threshold."
      )
    }

    if (context.oregonMetroLocation && metroElection === "opt_out" && annualizedWages >= METRO_AUTO_THRESHOLD) {
      warnings.push(
        "Metro SHS withholding is suppressed because the employee opted out, even though the default employer threshold would otherwise trigger withholding."
      )
    }

    if (context.oregonMultnomahCountyLocation && pfaElection === "opt_out" && annualizedWages >= PFA_AUTO_THRESHOLD) {
      warnings.push(
        "Multnomah County PFA withholding is suppressed because the employee opted out, even though the default employer threshold would otherwise trigger withholding."
      )
    }

    if (context.oregonMetroLocation && !context.workState) {
      warnings.push(
        "Metro SHS withholding is modeled from the explicit Metro work-location toggle because county alone does not reliably identify the Metro district boundary."
      )
    }

    if (context.oregonMultnomahCountyLocation && annualizedWages > NON_JOINT_UPPER_THRESHOLD && context.filingStatus !== "marriedJoint" && pfaElection === "auto") {
      warnings.push(
        "Multnomah County PFA final tax for non-joint filers reaches the 3% bracket once Oregon taxable income exceeds $250,000, which can happen before the default employer withholding reaches its upper payroll threshold."
      )
    }

    return createLocalCalculationResult("Oregon statewide transit and Portland-area local payroll withholding", {
      localTax: calculateOregonLocalTax(context),
      warnings,
    })
  },
}
