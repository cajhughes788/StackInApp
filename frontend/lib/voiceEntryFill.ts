// Turns a voice entry reply (shared/voiceEntry.ts) into what the Add entry
// form should fill in, using only the fields this workspace's form shows.
// Anything that could go in more than one place becomes a question with
// buttons instead of a guess. No money is added up or worked out here except
// putting two amounts said for the same field together.

import type { EntryFormVisibility } from "@shared/entryVisibility"
import type { IncomeCategory } from "@shared/schemas/entry"
import type { VoiceAmountTarget, VoiceEntryResult } from "@shared/voiceEntry"
import { getSplitCategories, paymentCategoryConfig } from "@/lib/incomeBreakdown"

export const VOICE_SOURCE_FIELDS = ["venmo", "appleCash", "zelle", "checks", "cashApp", "posSales", "cashSales"] as const
export type VoiceSourceField = (typeof VOICE_SOURCE_FIELDS)[number]
// The form's own keys: payment sources, POS/cash tips on top of sales,
// W-2 card tips ("tips") and reported cash, and personal cash (both).
export type VoiceAmountField = VoiceSourceField | "posTips" | "cashTips" | "tips" | "reportedCash" | "unreportedCash"

export type VoiceAmountPlacement = {
  field: VoiceAmountField
  // Only for split sources (Venmo, Apple Pay, Zelle, Checks, Cash App);
  // null = the source's usual category.
  category: IncomeCategory | null
}

export type VoiceAmountOption = VoiceAmountPlacement & { label: string }

export type VoiceQuestion = {
  id: string
  amount: number
  isTips: boolean
  options: VoiceAmountOption[]
}

export type VoiceFillPlan = {
  date: string | null
  // Hours for the form's hours box (W-2 "Hours worked" or independent "Hours").
  hours: string | null
  inOut: { inTime: string; inPeriod: "AM" | "PM"; outTime: string; outPeriod: "AM" | "PM" } | null
  positionId: string | null
  amounts: Array<VoiceAmountPlacement & { amount: number }>
  questions: VoiceQuestion[]
  notes: string | null
  // Short notes for the person about what was left out and why.
  skipped: string[]
}

export type VoiceFillContext = {
  visibility: EntryFormVisibility
  tipsEnabled: boolean
  dateBounds: { start: string; end: string } | null
}

const money = (amount: number) =>
  `$${amount.toLocaleString("en-US", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/** "17:00" → { time: "5:00", period: "PM" }. */
export function toTwelveHour(time24: string): { time: string; period: "AM" | "PM" } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time24)
  if (!match) return null
  const hour = Number(match[1])
  const minute = match[2]
  if (hour > 23 || Number(minute) > 59) return null
  const period = hour >= 12 ? "PM" : "AM"
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return { time: `${hour12}:${minute}`, period }
}

/** Hours between two 24-hour times; past midnight counts into the next day. */
export function hoursBetween(inTime: string, outTime: string): number | null {
  const toMinutes = (t: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(t)
    return match ? Number(match[1]) * 60 + Number(match[2]) : null
  }
  const start = toMinutes(inTime)
  const end = toMinutes(outTime)
  if (start === null || end === null) return null
  const minutes = end > start ? end - start : end + 24 * 60 - start
  return Math.round((minutes / 60) * 100) / 100
}

function sourceShown(visibility: EntryFormVisibility, field: VoiceSourceField): boolean {
  if (visibility.mode !== "independent") return false
  switch (field) {
    case "venmo": return visibility.showVenmo
    case "appleCash": return visibility.showAppleCash
    case "zelle": return visibility.showZelle
    case "checks": return visibility.showChecks
    case "cashApp": return visibility.showCashApp
    case "posSales": return visibility.showPosSales
    case "cashSales": return visibility.showCashSales
  }
}

const isSourceField = (field: string): field is VoiceSourceField =>
  (VOICE_SOURCE_FIELDS as readonly string[]).includes(field)

const isSplitSource = (field: VoiceSourceField) => paymentCategoryConfig[field].entryStyle === "split"

/** The amount fields this form shows, as the server's target names. */
export function voiceFieldsFor(visibility: EntryFormVisibility, tipsEnabled: boolean): VoiceAmountTarget[] {
  if (visibility.mode === "w2") {
    const fields: VoiceAmountTarget[] = []
    if (visibility.showTips) fields.push("cardTips")
    if (visibility.showReportedCash) fields.push("reportedCash")
    if (visibility.showUnreportedCash) fields.push("personalCash")
    return fields
  }
  const fields: VoiceAmountTarget[] = VOICE_SOURCE_FIELDS.filter((field) => sourceShown(visibility, field))
  if (tipsEnabled && visibility.showPosSales) fields.push("posTips")
  if (tipsEnabled && visibility.showCashSales) fields.push("cashTips")
  if (visibility.showIndependentUnreportedCash) fields.push("personalCash")
  return fields
}

function optionLabel(placement: VoiceAmountPlacement, visibility: EntryFormVisibility): string {
  const { field, category } = placement
  if (field === "tips") return "Card tips"
  if (field === "reportedCash") return "Reported cash"
  if (field === "unreportedCash") return "Personal cash"
  if (field === "posTips") return "Card tips"
  if (field === "cashTips") return "Cash tips"
  const label = field === "posSales" ? "Card / POS" : paymentCategoryConfig[field].label
  if (category === "tips") return `${label} tips`
  return visibility.mode === "independent" && field === "cashSales" ? "Cash" : label
}

// Where an amount said with no kind could go, and where tips could go.
function optionsFor(isTips: boolean, ctx: VoiceFillContext): VoiceAmountPlacement[] {
  const { visibility, tipsEnabled } = ctx
  if (visibility.mode === "w2") {
    const options: VoiceAmountPlacement[] = []
    if (visibility.showTips) options.push({ field: "tips", category: null })
    if (visibility.showReportedCash) options.push({ field: "reportedCash", category: null })
    if (!isTips && visibility.showUnreportedCash) options.push({ field: "unreportedCash", category: null })
    return options
  }
  if (isTips && tipsEnabled) {
    const options: VoiceAmountPlacement[] = []
    if (visibility.showPosSales) options.push({ field: "posTips", category: null })
    if (visibility.showCashSales) options.push({ field: "cashTips", category: null })
    for (const field of VOICE_SOURCE_FIELDS) {
      if (sourceShown(visibility, field) && isSplitSource(field)) options.push({ field, category: "tips" })
    }
    return options
  }
  const options: VoiceAmountPlacement[] = VOICE_SOURCE_FIELDS
    .filter((field) => sourceShown(visibility, field))
    .map((field) => ({ field, category: null }))
  if (!isTips && visibility.showIndependentUnreportedCash) options.push({ field: "unreportedCash", category: null })
  return options
}

// A target the server sent, as a form field — or null when it isn't on this form.
function placementFor(target: VoiceAmountTarget, category: IncomeCategory | null, ctx: VoiceFillContext): VoiceAmountPlacement | null {
  const { visibility, tipsEnabled } = ctx
  const fields = voiceFieldsFor(visibility, tipsEnabled)
  if (!fields.includes(target)) return null
  if (target === "cardTips") return { field: "tips", category: null }
  if (target === "personalCash") return { field: "unreportedCash", category: null }
  if (target === "reportedCash" || target === "posTips" || target === "cashTips") return { field: target, category: null }
  if (isSourceField(target)) {
    if (!isSplitSource(target) || !category) return { field: target, category: null }
    const allowed = getSplitCategories(target, tipsEnabled)
    return { field: target, category: allowed.includes(category) ? category : null }
  }
  return null
}

export function planVoiceFill(result: VoiceEntryResult, ctx: VoiceFillContext): VoiceFillPlan {
  const { visibility, dateBounds } = ctx
  const skipped: string[] = []

  let date: string | null = null
  if (result.date) {
    if (!dateBounds || (result.date >= dateBounds.start && result.date <= dateBounds.end)) {
      date = result.date
    } else {
      skipped.push("That day is outside the period you're looking at, so the date wasn't changed.")
    }
  }

  // Hours box vs in/out times, whichever this form has.
  const hasInOut = visibility.mode === "w2" && visibility.showInOutTimes
  const hasHoursBox =
    (visibility.mode === "w2" && visibility.showHoursManual) || (visibility.mode === "independent" && visibility.showHours)
  let hours: string | null = null
  let inOut: VoiceFillPlan["inOut"] = null
  if (hasInOut && result.inTime && result.outTime) {
    const start = toTwelveHour(result.inTime)
    const end = toTwelveHour(result.outTime)
    if (start && end) inOut = { inTime: start.time, inPeriod: start.period, outTime: end.time, outPeriod: end.period }
  }
  if (hasHoursBox) {
    if (result.hours) {
      hours = String(result.hours)
    } else if (result.inTime && result.outTime) {
      const worked = hoursBetween(result.inTime, result.outTime)
      if (worked) hours = String(worked)
    }
  }

  const positionId = visibility.mode === "w2" && visibility.showRate ? result.positionId : null

  // Amounts: placed ones are put together per field (and category); the rest become questions.
  const placed = new Map<string, VoiceAmountPlacement & { amount: number }>()
  const questions: VoiceQuestion[] = []
  result.amounts.forEach((item, index) => {
    const isTips = item.target === "tipsUnsure" || item.target === "cardTips" || item.target === "posTips" ||
      item.target === "cashTips" || item.category === "tips"
    let placement = item.target === "unsure" || item.target === "tipsUnsure"
      ? null
      : placementFor(item.target, item.category, ctx)
    if (!placement) {
      const options = optionsFor(item.target === "tipsUnsure", ctx)
      if (options.length === 1) {
        placement = options[0]
      } else if (options.length === 0) {
        skipped.push(
          visibility.mode === "w2"
            ? `${money(item.amount)} wasn't added: your pay is worked out from your hours and rate.`
            : `${money(item.amount)} wasn't added: there's no field for it on this form.`
        )
        return
      } else {
        questions.push({
          id: `q${index}`,
          amount: item.amount,
          isTips,
          options: options.map((option) => ({ ...option, label: optionLabel(option, visibility) })),
        })
        return
      }
    }
    const key = `${placement.field}:${placement.category ?? ""}`
    const existing = placed.get(key)
    placed.set(key, { ...placement, amount: Math.round(((existing?.amount ?? 0) + item.amount) * 100) / 100 })
  })

  const notes = visibility.showNotes && result.notes ? result.notes : null

  return { date, hours, inOut, positionId, amounts: [...placed.values()], questions, notes, skipped }
}

/** Words for the phone's speech recognition to listen for on this form, so
 * payment names and the person's own position titles are heard right. */
export function voiceHintsFor(visibility: EntryFormVisibility, tipsEnabled: boolean, positionTitles: string[] = []): string[] {
  const hints = new Set<string>(["tips", "hours", "today", "yesterday"])
  if (visibility.mode === "w2") {
    if (visibility.showTips) hints.add("card tips").add("credit card tips")
    if (visibility.showReportedCash) hints.add("reported cash").add("cash tips")
    if (visibility.showUnreportedCash) hints.add("personal cash")
    if (visibility.showInOutTimes) hints.add("clocked in").add("clocked out")
  } else {
    const names: Record<VoiceSourceField, string[]> = {
      venmo: ["Venmo"],
      appleCash: ["Apple Pay", "Apple Cash"],
      zelle: ["Zelle"],
      checks: ["check", "checks"],
      cashApp: ["Cash App"],
      posSales: ["card", "Square", "Clover", "POS"],
      cashSales: ["cash"],
    }
    for (const field of VOICE_SOURCE_FIELDS) {
      if (sourceShown(visibility, field)) names[field].forEach((name) => hints.add(name))
    }
    if (tipsEnabled) hints.add("card tips").add("cash tips")
    if (visibility.showIndependentUnreportedCash) hints.add("personal cash")
  }
  for (const title of positionTitles) {
    if (title.trim()) hints.add(title.trim())
  }
  return [...hints].slice(0, 100)
}
