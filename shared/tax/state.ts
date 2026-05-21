// /shared/tax/state.ts

import { d, ZERO, clampNonNegative } from "./math"
import type {
  BracketTableByStatus,
  StateCalculationMeta,
  StateTaxInfo,
  FilingStatus,
  TaxBracket,
} from "./types"
import { STATE_TAX_RATES } from "./tables/stateRates"

/**
 * Normalizes raw state strings to match canonical keys in STATE_TAX_RATES.
 * Example:
 *   "washington" → "Washington"
 *   "south dakota" → "SouthDakota"
 *   "district of columbia" → "WashingtonDC"
 *   "new york" → "NewYork"
 */
export function normalizeStateKey(raw: string): string {
  if (!raw) return "Default"

  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, "")

  // Direct canonical forms
  const mapping: Record<string, string> = {
    washingtondc: "WashingtonDC",
    districtofcolumbia: "WashingtonDC",
    newyork: "NewYork",
    southdakota: "SouthDakota",
    northdakota: "NorthDakota",
    newmexico: "NewMexico",
    newhampshire: "NewHampshire",
    northcarolina: "NorthCarolina",
    southcarolina: "SouthCarolina",
    westvirginia: "WestVirginia",
    rhodeisland: "RhodeIsland",
  }

  if (mapping[cleaned]) return mapping[cleaned]

  // Capitalize first letter for normal single-word states
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/**
 * Internal helper: safely retrieve either a numeric or per-status map value.
 */
function getValueByStatus(
  value: number | Record<string, number> | undefined,
  status: FilingStatus
): number {
  if (!value) return 0
  if (typeof value === "number") return value
  return value[status] ?? 0
}

function getBracketsByStatus(
  brackets: StateTaxInfo["brackets"],
  status: FilingStatus
): TaxBracket[] | undefined {
  if (!brackets) return undefined
  if (Array.isArray(brackets)) return brackets

  const byStatus = brackets as BracketTableByStatus

  return (
    byStatus[status] ??
    byStatus.single ??
    byStatus.marriedSeparate ??
    byStatus.marriedJoint ??
    byStatus.headOfHousehold
  )
}

/**
 * State withholding calculator (2026 payroll-aligned with filing status)
 *
 * Logic:
 *  1. Normalize and locate the state’s tax info.
 *  2. Annualize taxable wages based on pay frequency.
 *  3. Subtract any standard or personal deduction (if provided).
 *  4. Apply state-level personal or dependent exemptions (if present).
 *  5. Apply flat or progressive tax structure.
 *  6. Apply state-level dependent credits (if defined).
 *  7. De-annualize to per-period withholding and round to cents.
 *
 *  States without an income tax return 0.
 */
export function calculateStateTax(
  taxableIncome: number,
  state: string,
  payFrequency: "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual",
  dependents: number = 0,
  filingStatus: FilingStatus = "single"
): number {
  const income = d(taxableIncome)

  // --- Normalize key and locate table ---
  const normalizedState = normalizeStateKey(state)
  const stateInfo: StateTaxInfo =
    STATE_TAX_RATES[normalizedState] ||
    STATE_TAX_RATES[normalizedState.replace(/\s+/g, "")] ||
    STATE_TAX_RATES.Default

  const periods = getPeriodsPerYear(payFrequency)
  const annualWages = income.mul(periods)

  // Early exit for no-tax states
  const brackets = getBracketsByStatus(stateInfo.brackets, filingStatus)

  if ((stateInfo.flatRate ?? 0) === 0 && !brackets) {
    return 0
  }

  // 1. Apply any standard or fixed deduction (per filing status if applicable)
  let adjusted = annualWages
  const deduction = getValueByStatus(stateInfo.deduction, filingStatus)
  if (deduction > 0) adjusted = adjusted.sub(d(deduction))
  adjusted = clampNonNegative(adjusted)

  // 2. Apply per-dependent *income deductions* (some states)
  const depDeduction = getValueByStatus(stateInfo.dependentDeduction, filingStatus)
  if (depDeduction > 0 && dependents > 0) {
    adjusted = adjusted.sub(d(depDeduction).mul(dependents))
  }
  adjusted = clampNonNegative(adjusted)

  // 3. Compute annual tax
  let annualTax = ZERO

  if (stateInfo.flatRate != null) {
    // Flat tax
    annualTax = adjusted.mul(d(stateInfo.flatRate))
  } else if (brackets && brackets.length > 0) {
    // Progressive structure
    let prevLimit = d(0)
    for (const bracket of brackets) {
      const upper = bracket.upTo ? d(bracket.upTo) : null
      const rate = d(bracket.rate)

      if (upper && adjusted.gt(upper)) {
        const taxableAtThisRate = upper.sub(prevLimit)
        annualTax = annualTax.add(taxableAtThisRate.mul(rate))
        prevLimit = upper
      } else {
        const taxableAtThisRate = adjusted.sub(prevLimit)
        if (taxableAtThisRate.gt(0)) {
          annualTax = annualTax.add(taxableAtThisRate.mul(rate))
        }
        break
      }
    }
  }

  // 4. Apply per-dependent *tax credits* (post-tax reduction)
  const depCredit = getValueByStatus(stateInfo.dependentCredit, filingStatus)
  if (depCredit > 0 && dependents > 0) {
    const credit = d(depCredit).mul(dependents)
    annualTax = annualTax.sub(credit)
  }

  annualTax = clampNonNegative(annualTax)

  // 5. Convert to per-period withholding and round to cents
  const perPeriod = annualTax.div(periods).toDecimalPlaces(2)

  return clampNonNegative(perPeriod).toNumber()
}

export function getStateCalculationMeta(state: string): StateCalculationMeta {
  const normalizedState = normalizeStateKey(state)
  const stateInfo: StateTaxInfo =
    STATE_TAX_RATES[normalizedState] ||
    STATE_TAX_RATES[normalizedState.replace(/\s+/g, "")] ||
    STATE_TAX_RATES.Default

  const base: StateCalculationMeta = {
    code: normalizedState,
    displayName: stateInfo.displayName ?? normalizedState,
    taxYear: 2026,
    status: "exact",
    supportsLocalTaxes: false,
    needsResidenceLocation: false,
    needsWorkLocation: false,
    notes: stateInfo.notes ? [stateInfo.notes] : [],
  }

  switch (normalizedState) {
    case "Alabama":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Alabama payroll withholding uses Form A-4 exemption codes, the Alabama adjusted standard deduction schedule, annual federal withholding, and dependent exemptions that vary by annual gross income.",
          "Alabama's nonresident 30-day safe harbor and resident credit interaction with other-state withholding still depend on workday and other-state payroll details that are not fully modeled yet.",
        ],
      }
    case "Arizona":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Arizona payroll withholding uses the employee's A-4 percentage election, or 2.0% if no election is on file.",
          "Arizona nonresident 60-day rules, specific nonresident exemptions, and A-4V voluntary out-of-state resident withholding are not fully distinguished yet.",
        ],
      }
    case "Arkansas":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Arkansas payroll withholding uses the 2026 DFA withholding formula with the $2,470 standard deduction, annual wage rounding, optional low-income tax credit election, and the $29 per-exemption annual personal credit.",
          "Texarkana border-city exemptions, military-spouse exemption certificates, and detailed resident-out-of-state voluntary withholding scenarios are not fully modeled yet.",
        ],
      }
    case "California":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "California payroll withholding uses the 2026 Method B exact-calculation tables with DE 4 regular and estimated-deduction allowances.",
          "Resident cross-state offset rules and nonresident partial California workday sourcing are not fully modeled yet.",
        ],
      }
    case "Connecticut":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Connecticut payroll withholding uses the 2026 CT-W4 withholding-code tables, including personal exemptions, phase-out add-back, tax recapture, and personal tax credits.",
          "Connecticut resident cross-state withholding reductions still require the other jurisdiction withholding amount and are not fully modeled yet.",
        ],
      }
    case "Delaware":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Delaware payroll withholding uses the employer-guide annualized formula with the Delaware standard deduction and a $110 personal credit for each Delaware withholding allowance.",
          "Delaware does not have wage-tax reciprocity, and Delaware nonresident withholding can require a W-4NR allocation when only part of annual wages are Delaware-source wages.",
        ],
      }
    case "WashingtonDC":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "District of Columbia withholding is treated as resident-only payroll withholding using the employee's D-4 allowance count and current DC resident rate brackets.",
          "The latest official FR-230 payroll tables were not directly retrievable during implementation, so this remains a dedicated payroll-style approximation rather than a fully source-verified exact table replica.",
        ],
      }
    case "Maryland":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Maryland payroll withholding uses the MW507-style percentage method with county local rates when residence or work location is provided.",
          "Maryland resident employees working in Delaware or another nonreciprocal state use the Delaware/nonreciprocal withholding path.",
        ],
      }
    case "Illinois":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Illinois payroll withholding uses the IL-W-4 allowance formula when Illinois is the withholding state.",
          "Illinois reciprocal nonresident handling is modeled for Iowa, Kentucky, Michigan, and Wisconsin residents.",
        ],
      }
    case "Massachusetts":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Massachusetts payroll withholding uses the M-4 exemption method with head-of-household and blindness payroll reductions, plus the 2026 4% surtax threshold on high annualized wages.",
          "Massachusetts resident cross-state withholding reductions and nonresident partial wage allocation still require additional sourcing or other-state withholding inputs.",
        ],
      }
    case "RhodeIsland":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Rhode Island payroll withholding uses the 2026 RI-W4 allowance count, additional withholding amount, and percentage-method wage tables for all filing status types.",
          "Rhode Island out-of-state resident convenience withholding and resident multistate edge cases can require employer-specific sourcing choices that are not fully modeled yet.",
        ],
      }
    case "SouthCarolina":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "South Carolina payroll withholding uses the 2026 SC formula with $5,000 per allowance, a 10% standard deduction when one or more allowances are claimed, and the current 6.0% top withholding rate.",
          "Military-spouse exemption certificates and other South Carolina exempt-certificate scenarios are only handled when the employee's exempt election is provided.",
        ],
      }
    case "Colorado":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Colorado payroll withholding uses the DR 1098 annual deduction worksheet method.",
          "Colorado resident wages earned in another income-tax state are treated as non-Colorado withholding wages unless Colorado is selected as the primary withholding state.",
        ],
      }
    case "Georgia":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Georgia payroll withholding uses the Employer's Tax Guide percentage method with G-4 allowances.",
          "Married-joint Georgia withholding can differ depending on whether one or both spouses work.",
        ],
      }
    case "Hawaii":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Hawaii payroll withholding uses the 2026 Booklet A withholding tables, HW-4 allowance values, the extra lump-sum allowance amount, and the married-versus-single rate election.",
          "Hawaii nonresident allocation, Form HW-6 nonresidence determinations, and special sourcing for services partly inside and outside Hawaii are not fully tracked yet.",
        ],
      }
    case "Idaho":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Idaho payroll withholding uses Form ID W-4 child tax credit allowances, the 2025 5.3% withholding rate, and the current Idaho withholding thresholds.",
          "Idaho nonresident withholding is only required after Idaho wages exceed $1,000 for the calendar year, and out-of-state work for Idaho residents can be voluntary payroll withholding.",
        ],
      }
    case "Kentucky":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Kentucky payroll withholding uses the annual standard deduction and flat withholding rate.",
          "Kentucky reciprocal-state exemptions are modeled only when reciprocity is explicitly selected.",
        ],
      }
    case "Michigan":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Michigan payroll withholding uses MI-W4 personal and dependent exemptions.",
          "Michigan reciprocal-state exemptions are modeled only when reciprocity is explicitly selected.",
        ],
      }
    case "Iowa":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Iowa payroll withholding uses the 2026 IA W-4 deduction schedule, the 3.8% withholding rate, the employee's total allowance amount, and any additional per-paycheck amount requested.",
          "Illinois reciprocity is modeled when reciprocity is explicitly selected, but broader multistate wage sourcing still depends on employer-specific allocation details.",
        ],
      }
    case "Kansas":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Kansas payroll withholding uses the Form K-4 allowance rate together with the Kansas annual personal exemption and dependent allowance amounts, plus the percentage-method rate tables.",
          "Married employees can choose either the Single or Joint allowance rate on Form K-4, so payroll accuracy depends on the actual rate election on file.",
        ],
      }
    case "Louisiana":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Louisiana payroll withholding uses the employee's L-4 deduction claim together with the Louisiana withholding-table rate of 3.09% on annualized taxable wages.",
          "Louisiana resident employees working in another income-tax state can need special treatment when wages are already subject to withholding in that other state.",
        ],
      }
    case "Mississippi":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Mississippi payroll withholding uses the Form 89-350 exemption amount together with the Mississippi standard deduction and 2026 4% tax above the zero-rate threshold.",
          "If the exact Mississippi exemption amount on file is not entered, payroll accuracy can differ for married employees splitting exemptions or claiming age or blindness exemptions.",
        ],
      }
    case "Missouri":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Missouri payroll withholding uses the 2026 Missouri withholding formula and the spouse-does-not-work standard deduction election from Form MO W-4.",
          "Missouri resident payroll can still require credit or allocation adjustments when another state is also withholding on the same wages.",
        ],
      }
    case "Maine":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Maine payroll withholding uses the 2026 percentage method with Form W-4ME allowances, the withholding-specific standard deduction phaseout, and the single-versus-married rate schedule election.",
          "Maine nonresident day-count and $3,000 annual work threshold enforcement still depends on actual Maine workdays and year-to-date Maine wages, which are not fully tracked yet.",
        ],
      }
    case "Minnesota":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Minnesota payroll withholding uses the 2026 computer formula with W-4MN allowance values and filing-status-specific annualized withholding schedules.",
          "Minnesota reciprocity with Michigan and North Dakota is modeled only when reciprocity is explicitly selected, and the nonresident minimum-filing-threshold exception is not fully tracked yet.",
        ],
      }
    case "Montana":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Montana payroll withholding uses the 2026 employer-guide pay-period formulas tied to the employee's MW-4 filing category and the federal standard deduction amounts.",
          "Montana reciprocity with North Dakota and the 30-day nonresident wage withholding exemption still depend on certificate and workday details that are not fully tracked yet.",
        ],
      }
    case "Nebraska":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Nebraska payroll withholding uses the 2026 Circular EN percentage method with W-4N allowance values.",
          "Nebraska's special 1.5% minimum withholding rule, Form 9N allocation percentages, and conference-or-training safe harbors are not fully modeled yet.",
        ],
      }
    case "NewMexico":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "New Mexico payroll withholding uses the FYI-104 percentage-method annual wage tables with support for a higher single-rate election and the major statutory exemption categories used in payroll.",
          "Resident credits, detailed multistate sourcing, and special exempt-income fact patterns can still require more information than payroll withholding alone.",
        ],
      }
    case "NewJersey":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "New Jersey payroll withholding uses the 2025 NJ-WT percentage-method rate tables and NJ-W4 allowance values.",
          "Pennsylvania reciprocity is modeled when reciprocity is explicitly selected, but multistate allocation and resident offset adjustments are not fully modeled yet.",
        ],
      }
    case "NorthCarolina":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "North Carolina payroll withholding uses NC-30 formula logic with filing status, standard deduction, and NC-4 allowances.",
          "Nonresident-alien special handling is not modeled yet.",
        ],
      }
    case "NorthDakota":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "North Dakota payroll withholding uses the 2026 annual percentage method for Forms W-4 for 2020 and after.",
          "Minnesota and Montana reciprocity, plus North Dakota resident wages earned in another state, can require certificate or employer-specific payroll handling that is not fully determined here.",
        ],
      }
    case "Oklahoma":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Oklahoma payroll withholding uses OK-W-4 allowance counts, the current withholding percentage method, and the optional higher single-rate election for married employees.",
          "Nonresident wage sourcing and some special military or exempt-income fact patterns can still require more employer-specific detail.",
        ],
      }
    case "Ohio":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Ohio employer withholding uses the current Ohio percentage-method payroll tables and Ohio IT 4 exemption counts, plus any requested additional Ohio withholding.",
          "Ohio school district withholding is modeled when the resident school district number and tax rate are provided, and optional work-location municipal plus JEDD/JEDZ withholding can be entered manually.",
          "Ohio municipal and JEDD/JEDZ withholding still depend on worksite-specific rate lookups from The Finder and are not auto-resolved from the address fields here.",
        ],
      }
    case "Indiana":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Indiana payroll withholding uses the WH-4 deduction-constant method, including lines 5 through 8 plus any requested extra state withholding.",
          "Indiana county income tax withholding uses the same WH-4 taxable wage base and the employee's Jan. 1 residence or principal work county, including optional extra county withholding.",
          "Indiana reciprocity, the 30-day nonresident waiver, and nonresident military-spouse exemptions are only modeled when the matching payroll certificate inputs are provided.",
        ],
      }
    case "NewYork":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "New York State payroll withholding uses the 2026 NYS-50-T-NYS exact calculation method with IT-2104 allowance counts and optional extra New York State withholding.",
          "New York City and Yonkers payroll taxes are modeled when the local withholding category is provided, using the same New York withholding allowance count for local resident calculations.",
          "New York resident credit coordination and nonresident IT-2104.1 multistate wage allocation still depend on employer-specific payroll sourcing details that are not fully modeled here.",
        ],
      }
    case "Pennsylvania":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Pennsylvania state withholding uses the flat 3.07% employer withholding rate, with Pennsylvania reciprocity applied only when the reciprocity election is explicitly selected.",
          "Pennsylvania local EIT withholding is modeled when resident and work-location EIT rates are provided.",
        ],
      }
    case "Oregon":
      return {
        ...base,
        status: "approximate",
        supportsLocalTaxes: true,
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Oregon state withholding uses the 2026 OR-W-4 annual payroll formula, including the Oregon standard deduction, capped federal withholding subtraction, and per-allowance exemption credit.",
          "Oregon statewide transit tax withholding is modeled.",
          "Metro SHS and Multnomah County PFA default employer withholding are modeled when the work-location toggles and election settings are provided.",
        ],
      }
    case "Utah":
      return {
        ...base,
        status: "approximate",
        notes: [
          ...(base.notes ?? []),
          "Utah payroll withholding uses the official Publication 14 pay-period schedules rather than generic annualized income-tax logic.",
          "Utah temporary nonresident exclusions and federal exempt-certificate handling are not modeled yet.",
        ],
      }
    case "Vermont":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Vermont payroll withholding uses W-4VT-style allowance reductions and Vermont payroll rate schedules rather than the generic annual state-tax fallback.",
          "The exact 2026 Vermont bracket table could not be directly retrieved during implementation, so the dedicated method uses the updated 2026 allowance value together with the latest published Vermont payroll bracket structure available in-tool.",
          "Nonresident hour-based Vermont work allocation and resident credits for tax withheld to another state are not fully modeled yet.",
        ],
      }
    case "Virginia":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Virginia payroll withholding uses the July 2025-and-later employer withholding formula with VA-4 personal, dependent, age, and blindness exemptions.",
          "Reciprocity can be modeled when reciprocity is explicitly selected, but resident cross-state withholding offsets are not fully modeled yet.",
        ],
      }
    case "WestVirginia":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "West Virginia payroll withholding uses the 2026 IT-100.2.A percentage-method tables with $2,000 annual exemption deductions per IT-104 exemption and the optional one-earner lower-rate election.",
          "Reciprocity for Kentucky, Maryland, Ohio, Pennsylvania, and Virginia residents is modeled only when reciprocity is explicitly selected, and special military-spouse certificates are not fully modeled yet.",
        ],
      }
    case "Wisconsin":
      return {
        ...base,
        status: "approximate",
        needsResidenceLocation: true,
        needsWorkLocation: true,
        notes: [
          ...(base.notes ?? []),
          "Wisconsin payroll withholding uses the January 2026 W-166 alternate annualized withholding method with deduction phaseout formulas and WT-4 exemption reductions.",
          "Reciprocity for Illinois, Indiana, Kentucky, and Michigan residents is modeled only when reciprocity is explicitly selected, while resident credits for taxes withheld to another state are not fully modeled yet.",
        ],
      }
    default:
      return base
  }
}

/**
 * Returns pay periods per year for scaling.
 */
function getPeriodsPerYear(freq: string): number {
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
    default:
      throw new Error(`Unsupported pay frequency: ${freq}`)
  }
}
