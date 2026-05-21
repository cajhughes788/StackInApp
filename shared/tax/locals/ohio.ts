import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createLocalCalculationResult } from "./strategyUtils"
import type { LocalTaxStrategy, TaxContext } from "../types"

function getOhioSchoolDistrictContext(context: TaxContext): {
  primaryState: string
  residenceState: string
  workState: string
  residentInOhio: boolean
} {
  const primaryState = normalizeStateKey(context.state ?? "")
  const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
  const workState = normalizeStateKey(context.workState ?? context.state ?? "")

  return {
    primaryState,
    residenceState,
    workState,
    residentInOhio: residenceState === "Ohio",
  }
}

function toRateDecimal(value?: number): number {
  return value != null ? value / 100 : 0
}

export function calculateOhioLocalTax(context: TaxContext): number {
  const { primaryState, residenceState, workState, residentInOhio } =
    getOhioSchoolDistrictContext(context)

  if (
    primaryState !== "Ohio" &&
    residenceState !== "Ohio" &&
    workState !== "Ohio"
  ) {
    return 0
  }

  if (!residentInOhio) {
    return d(context.taxableIncome)
      .mul(toRateDecimal(context.ohioMunicipalIncomeTaxRate))
      .add(d(context.taxableIncome).mul(toRateDecimal(context.ohioJeddJedzIncomeTaxRate)))
      .toDecimalPlaces(2)
      .toNumber()
  }

  const rate = toRateDecimal(context.ohioSchoolDistrictIncomeTaxRate)
  const schoolDistrictTax = rate > 0
    ? d(context.taxableIncome).mul(rate)
    : d(0)
  const municipalTax = d(context.taxableIncome).mul(
    toRateDecimal(context.ohioMunicipalIncomeTaxRate)
  )
  const jeddJedzTax = d(context.taxableIncome).mul(
    toRateDecimal(context.ohioJeddJedzIncomeTaxRate)
  )

  return schoolDistrictTax
    .add(municipalTax)
    .add(jeddJedzTax)
    .toDecimalPlaces(2)
    .toNumber()
}

export const ohioLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "Ohio",
  applies: (context) => {
    const { primaryState, residenceState, workState } =
      getOhioSchoolDistrictContext(context)
    return (
      primaryState === "Ohio" ||
      residenceState === "Ohio" ||
      workState === "Ohio"
    )
  },
  calculate: (context) => {
    const { residentInOhio, workState } = getOhioSchoolDistrictContext(context)
    const worksInOhio = workState === "Ohio"
    const warnings: string[] = []

    if (residentInOhio && context.ohioSchoolDistrictIncomeTaxRate == null) {
      warnings.push(
        "Ohio school district withholding needs the employee's Ohio school district income tax rate."
      )
    }

    if (residentInOhio && !context.ohioSchoolDistrictNumber) {
      warnings.push(
        "Ohio school district withholding is more reliable when the 4-digit Ohio school district number is stored alongside the rate."
      )
    }

    if (!residentInOhio && workState === "Ohio") {
      warnings.push(
        "Ohio school district withholding is generally based on the employee's school district of residence, so nonresidents usually do not owe Ohio school district tax."
      )
    }

    if (worksInOhio && context.ohioMunicipalIncomeTaxRate == null) {
      warnings.push(
        "Ohio municipal withholding is not inferred automatically; enter the work-location municipal income tax rate when city withholding applies."
      )
    }

    if (worksInOhio && context.ohioJeddJedzIncomeTaxRate == null) {
      warnings.push(
        "Ohio JEDD/JEDZ withholding is not inferred automatically; enter the additional JEDD or JEDZ rate when the Ohio worksite is inside one of those districts."
      )
    }

    return createLocalCalculationResult("Ohio school district, municipal, and JEDD/JEDZ payroll withholding", {
      localTax: calculateOhioLocalTax(context),
      warnings,
    })
  },
}
