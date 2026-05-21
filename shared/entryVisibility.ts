import { SettingsType } from "./schemas/settings"
import { EntryType } from "./schemas/entry"
import {
  getIncomeBreakdownTotalForPaymentMethod,
  getIncomeBreakdownTotalForPaymentMethodAndCategory,
  getIndependentCashSalesTotal,
} from "./independentIncome"

/* ------------------------------------------------------------
 * FORM VISIBILITY TYPES — used ONLY for the entry form
 * ------------------------------------------------------------ */
export type W2FormVisibility = {
  mode: "w2"
  showNotes: boolean

  showHoursSection: boolean
  showHoursManual: boolean
  showInOutTimes: boolean
  showRate: boolean

  showTips: boolean
  showReportedCash: boolean
  showUnreportedCash: boolean

  showBreakDeduction: boolean
  showCustomDeductions: boolean
}

export type IndependentFormVisibility = {
  mode: "independent"
  showNotes: boolean

  showHours: boolean
  showVenmo: boolean
  showAppleCash: boolean
  showZelle: boolean
  showPosSales: boolean
  showCashSales: boolean

  showIndependentTips: boolean
  showIndependentReportedCash: boolean
  showIndependentUnreportedCash: boolean

  showCustomIncome: boolean
}

/** Union used ONLY by <EntryForm /> */
export type EntryFormVisibility =
  | W2FormVisibility
  | IndependentFormVisibility

/* ------------------------------------------------------------
 * FORM VISIBILITY RESOLVERS
 * ------------------------------------------------------------ */
export function resolveW2FormVisibility(
  settings: SettingsType["w2"]
): Omit<W2FormVisibility, "mode" | "showNotes"> {
  const usingHours = settings?.useHours ?? true
  const usingInOutMode =
    settings?.workInputMode === "enter_in_out_times"

  const isTipped = settings?.isTippedEmployee ?? false
  const askCardTips = settings?.askCardTips ?? false
  const askReportedCash = settings?.askReportedCash ?? false
  const askUnreportedCash = settings?.askUnreportedCash ?? false

  return {
    showHoursSection: usingHours,
    showHoursManual: usingHours && !usingInOutMode,
    showInOutTimes: usingHours && usingInOutMode,
    showRate: usingHours,

    showTips: isTipped && askCardTips,
    showReportedCash: isTipped && askReportedCash,
    showUnreportedCash: isTipped && askUnreportedCash,

    showBreakDeduction: usingHours,
    showCustomDeductions:
      Array.isArray(settings?.customDeductions) &&
      (settings.customDeductions?.length ?? 0) > 0,
  }
}

export function resolveIndependentFormVisibility(
  settings: SettingsType["independent"]
): Omit<IndependentFormVisibility, "mode" | "showNotes"> {
  const isTipped = settings?.isTippedIndependent === true

  return {
    showHours: settings?.trackHours === true,
    showVenmo: settings?.enableVenmo === true,
    showAppleCash: settings?.enableApplePay === true,
    showZelle: settings?.enableZelle === true,
    showPosSales: settings?.enablePosSales === true,
    showCashSales: settings?.enableCashSales === true,

    showIndependentTips: isTipped && settings?.askCardTips === true,
    showIndependentReportedCash:
      isTipped && settings?.askReportedCash === true,
    showIndependentUnreportedCash:
      isTipped && settings?.askUnreportedCash === true,

    showCustomIncome:
      Array.isArray(settings?.customIncomeFields) &&
      (settings.customIncomeFields?.length ?? 0) > 0,
  }
}

export function resolveEntryFormVisibility(
  settings: SettingsType,
  activeWorkspace: "w2" | "independent"
): EntryFormVisibility {
  const common = {
    showNotes: settings.common?.useNotes === true,
  }

  if (activeWorkspace === "w2") {
    return {
      mode: "w2",
      ...common,
      ...resolveW2FormVisibility(settings.w2),
    }
  }

  return {
    mode: "independent",
    ...common,
    ...resolveIndependentFormVisibility(
      settings.independent
    ),
  }
}

/* ------------------------------------------------------------
 * GRID VISIBILITY — used ONLY for the EntriesGrid
 * Based STRICTLY on entry data, not settings.
 * ------------------------------------------------------------ */
export type EntryGridVisibility =
  | {
      mode: "w2"
      showNotes: boolean
      showTips: boolean
      showReportedCash: boolean
      showUnreportedCash: boolean
      showHours: boolean
      showRate: boolean
      showDayTotal: true
    }
  | {
      mode: "independent"
      showNotes: boolean
      showHours: boolean
      showTips: boolean
      showReportedCash: boolean
      showUnreportedCash: boolean
      showVenmo: boolean
      showAppleCash: boolean
      showZelle: boolean
      showPosSales: boolean
      showCashSales: boolean
      showCustomIncome: boolean
      showDayTotal: true
    }

/* ------------------------------------------------------------
 * GRID VISIBILITY RESOLVER — ENTRY DATA DRIVEN
 * ------------------------------------------------------------ */
export function resolveEntryGridVisibility(
  entries: EntryType[],
  activeWorkspace: "w2" | "independent"
): EntryGridVisibility {
  const notesUsed = entries.some(
    (e) => (e.notes?.trim()?.length ?? 0) > 0
  )

  if (activeWorkspace === "w2") {
    const tipsUsed = entries.some((e) => (e.w2?.tips ?? 0) > 0)
    const reportedUsed = entries.some(
      (e) => (e.w2?.reportedCash ?? 0) > 0
    )
    const unreportedUsed = entries.some(
      (e) => (e.w2?.unreportedCash ?? 0) > 0
    )

    const hoursUsed =
      entries.some((e) => (e.totals?.paidHours ?? 0) > 0) ||
      entries.some((e) => (e.w2?.hours ?? 0) > 0) ||
      entries.some((e) => e.w2?.inTime && e.w2?.outTime)

    const rateUsed = entries.some((e) => (e.w2?.rate ?? 0) > 0)

    return {
      mode: "w2",
      showNotes: notesUsed,
      showTips: tipsUsed,
      showReportedCash: reportedUsed,
      showUnreportedCash: unreportedUsed,
      showHours: hoursUsed,
      showRate: rateUsed,
      showDayTotal: true,
    }
  }

  // Independent
  const hoursUsed = entries.some((e) => (e.independent?.hours ?? 0) > 0)
  const tipsUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethodAndCategory(e.independent, "card", "tips") > 0
  )
  const reportedUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethodAndCategory(e.independent, "cash", "tips") > 0
  )
  const unreportedUsed = entries.some(
    (e) => (e.independent?.unreportedCashTips ?? e.independent?.unreportedCash ?? 0) > 0
  )
  const venmoUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethod(e.independent, "venmo") > 0
  )
  const appleUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethod(e.independent, "apple_cash") > 0
  )
  const zelleUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethod(e.independent, "zelle") > 0
  )
  const posUsed = entries.some(
    (e) => getIncomeBreakdownTotalForPaymentMethod(e.independent, "pos") > 0
  )
  const cashUsed = entries.some(
    (e) => getIndependentCashSalesTotal(e.independent) > 0
  )
  const customIncomeUsed = entries.some(
    (e) => (e.independent?.customIncome?.length ?? 0) > 0
  )

  return {
    mode: "independent",
    showNotes: notesUsed,
    showHours: hoursUsed,
    showTips: tipsUsed,
    showReportedCash: reportedUsed,
    showUnreportedCash: unreportedUsed,
    showVenmo: venmoUsed,
    showAppleCash: appleUsed,
    showZelle: zelleUsed,
    showPosSales: posUsed,
    showCashSales: cashUsed,
    showCustomIncome: customIncomeUsed,
    showDayTotal: true,
  }
}
