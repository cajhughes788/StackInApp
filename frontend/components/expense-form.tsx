"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Info, Mic, Minus, Plus, Square } from "lucide-react"

import { getBusinessMileageRate } from "@shared/businessMileage"
import { getCalendarMonthBucketFromDate } from "@shared/payPeriods"
import { ExpenseInput } from "@shared/schemas/expense"
import {
  buildVehicleMileageDescription,
  calculateVehicleExpenseAmount,
  getDefaultVehicleExpenseMode,
  isVehicleTransportationCategory,
  type VehicleExpenseMode,
} from "@shared/vehicleExpenses"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import ExpenseCategoryPicker from "@/components/expense-category-picker"
import {
  findExpenseCategoryGuideEntry,
  getVisibleExpenseCategoryOptions,
  isExpenseCategorySelectable,
  normalizeExpenseCategoryLabel,
  resolveExpenseCategoryLabel,
  sanitizeExpenseCategoryName,
} from "@/lib/expenseCategories"
import { getLocalDateInputValue } from "@/lib/helpers"
import * as expensesService from "@/lib/domain/expenseService"
import * as recurringRulesService from "@/lib/domain/recurringRulesService"
import RecurringCadencePicker from "@/components/recurring-cadence-picker"
import type { RecurringCadence } from "@shared/schemas/recurringRule"
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore"
import { useVoiceHandoffStore } from "@/lib/stores/useVoiceHandoffStore"
import { listWords, scrollToVoiceReview, VoiceReviewFooter, VoiceReviewLabel, type VoiceAsk } from "@/components/voice-review"
import { useVoiceLaunchStore } from "@/lib/stores/useVoiceLaunchStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore"
import { useReceiptCapture } from "@/hooks/use-receipt-capture"
import ReceiptCaptureField from "@/components/receipt-capture-field"
import { reportFailure } from "@/lib/observability/failureReports"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { parseVoiceExpense, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import {
  planExpenseFill,
  voiceExpenseCurrentFor,
  voiceExpenseHints,
  type ExpenseVoiceQuestion,
} from "@/lib/voiceExpenseFill"

const ExpenseInputSchema = ExpenseInput
const VEHICLE_MODE_STORAGE_KEY = "stackin.vehicleExpenseMode"

function generateClientMutationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

type GenericExpenseFields = {
  amount: string
  vendor: string
  description: string
}

type VehicleMileageFields = {
  vendor: string
  businessMiles: string
  parkingAndTolls: string
  description: string
  descriptionIsManual: boolean
}

type VehicleDirectExpenseFields = {
  amount: string
  vendor: string
  description: string
}

type FormState = {
  date: string
  account: string
  generic: GenericExpenseFields
  vehicle: {
    mode: VehicleExpenseMode
    mileage: VehicleMileageFields
    directExpense: VehicleDirectExpenseFields
  }
}

function createEmptyFormState(vehicleMode: VehicleExpenseMode): FormState {
  const today = getLocalDateInputValue()

  return {
    date: today,
    account: "",
    generic: {
      amount: "",
      vendor: "",
      description: "",
    },
    vehicle: {
      mode: vehicleMode,
      mileage: {
        vendor: "",
        businessMiles: "",
        parkingAndTolls: "",
        description: "",
        descriptionIsManual: false,
      },
      directExpense: {
        amount: "",
        vendor: "",
        description: "",
      },
    },
  }
}

function isFreshFormState(form: FormState): boolean {
  return (
    form.account === "" &&
    form.generic.amount === "" &&
    form.generic.vendor === "" &&
    form.generic.description === "" &&
    form.vehicle.mileage.vendor === "" &&
    form.vehicle.mileage.businessMiles === "" &&
    form.vehicle.mileage.parkingAndTolls === "" &&
    form.vehicle.mileage.description === "" &&
    form.vehicle.directExpense.amount === "" &&
    form.vehicle.directExpense.vendor === "" &&
    form.vehicle.directExpense.description === ""
  )
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readVehicleModePreference(workspaceId: string | null): VehicleExpenseMode | null {
  if (!workspaceId || typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(`${VEHICLE_MODE_STORAGE_KEY}:${workspaceId}`)
    return raw === "mileage" || raw === "direct_expense" ? raw : null
  } catch (error) {
    return null
  }
}

function writeVehicleModePreference(
  workspaceId: string | null,
  mode: VehicleExpenseMode
): void {
  if (!workspaceId || typeof window === "undefined") return

  try {
    window.localStorage.setItem(`${VEHICLE_MODE_STORAGE_KEY}:${workspaceId}`, mode)
  } catch (error) {
  }
}

// A new category, carrying vendor/amount/description between the plain
// fields and the vehicle fields when it switches to or from vehicle.
function applyAccountChange(
  prev: FormState,
  value: string,
  customExpenseCategories: readonly string[]
): FormState {
  const previousCategoryLabel = normalizeExpenseCategoryLabel(
    prev.account,
    customExpenseCategories
  )
  const nextCategoryLabel = normalizeExpenseCategoryLabel(
    value,
    customExpenseCategories
  )
  const wasVehicleCategory = isVehicleTransportationCategory(previousCategoryLabel)
  const isNextVehicleCategory = isVehicleTransportationCategory(nextCategoryLabel)
  const next = {
    ...prev,
    account: value,
    vehicle: {
      ...prev.vehicle,
      mileage: {
        ...prev.vehicle.mileage,
      },
      directExpense: {
        ...prev.vehicle.directExpense,
      },
    },
    generic: {
      ...prev.generic,
    },
  }

  if (!wasVehicleCategory && isNextVehicleCategory) {
    if (!prev.vehicle.directExpense.vendor && prev.generic.vendor) {
      next.vehicle.directExpense.vendor = prev.generic.vendor
    }
    if (!prev.vehicle.directExpense.amount && prev.generic.amount) {
      next.vehicle.directExpense.amount = prev.generic.amount
    }
    if (!prev.vehicle.directExpense.description && prev.generic.description) {
      next.vehicle.directExpense.description = prev.generic.description
    }
    if (!prev.vehicle.mileage.vendor && prev.generic.vendor) {
      next.vehicle.mileage.vendor = prev.generic.vendor
    }
    if (
      !prev.vehicle.mileage.description &&
      !prev.vehicle.mileage.descriptionIsManual &&
      prev.generic.description
    ) {
      next.vehicle.mileage.description = prev.generic.description
    }
  }

  if (wasVehicleCategory && !isNextVehicleCategory) {
    const directSource = prev.vehicle.directExpense
    const mileageSource = prev.vehicle.mileage

    if (!prev.generic.vendor) {
      next.generic.vendor = directSource.vendor || mileageSource.vendor
    }
    if (!prev.generic.amount && directSource.amount) {
      next.generic.amount = directSource.amount
    }
    if (!prev.generic.description) {
      next.generic.description =
        directSource.description || mileageSource.description
    }
  }

  return next
}

// Mileage ↔ direct expense, carrying the vendor and description across.
function applyVehicleMode(prev: FormState, mode: VehicleExpenseMode): FormState {
  const next = {
    ...prev,
    vehicle: {
      ...prev.vehicle,
      mode,
      mileage: {
        ...prev.vehicle.mileage,
      },
      directExpense: {
        ...prev.vehicle.directExpense,
      },
    },
  }

  if (mode === "mileage") {
    if (!prev.vehicle.mileage.vendor && prev.vehicle.directExpense.vendor) {
      next.vehicle.mileage.vendor = prev.vehicle.directExpense.vendor
    }
    if (
      !prev.vehicle.mileage.description &&
      !prev.vehicle.mileage.descriptionIsManual &&
      prev.vehicle.directExpense.description
    ) {
      next.vehicle.mileage.description =
        prev.vehicle.directExpense.description
    }
  } else {
    if (!prev.vehicle.directExpense.vendor && prev.vehicle.mileage.vendor) {
      next.vehicle.directExpense.vendor = prev.vehicle.mileage.vendor
    }
    if (
      !prev.vehicle.directExpense.description &&
      prev.vehicle.mileage.description
    ) {
      next.vehicle.directExpense.description =
        prev.vehicle.mileage.description
    }
  }

  return next
}

// Soft filled fields and quiet labels for the restyled form.
const FIELD_INPUT_CLASS = "h-11 rounded-xl border-0 bg-muted px-3.5 shadow-none"
const FIELD_LABEL_CLASS = "mb-1.5 block text-sm font-normal text-muted-foreground"

function VendorLabel({
  htmlFor,
  optional = false,
}: {
  htmlFor: string
  optional?: boolean
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-sm font-normal text-muted-foreground">
        Vendor
        {optional ? " (Optional)" : ""}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="About the vendor field"
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 text-sm">
          Where did you purchase this expense?
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function ExpenseForm() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const activeWorkspaceType =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace.type : null
  const selectedPeriod = useSelectedPeriod(activeWorkspaceId)

  const [form, setForm] = useState<FormState>(() =>
    createEmptyFormState("direct_expense")
  )
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [vendorFocused, setVendorFocused] = useState(false)
  const [descriptionFocused, setDescriptionFocused] = useState(false)
  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatCadence, setRepeatCadence] = useState<RecurringCadence>({ freq: "monthly" })
  const [repeatEndDate, setRepeatEndDate] = useState("")
  const lastWorkspaceIdRef = useRef<string | null>(null)
  // Stable per-submission idempotency key. Generated once per form open and
  // refreshed after each successful submit so that a retry of the same form
  // state reuses the same key, but a new submission gets a fresh one.
  const clientMutationIdRef = useRef<string>(generateClientMutationId())

  // Voice: what the phone heard, any questions, and notes about what was left out.
  const [voicePhase, setVoicePhase] = useState<"idle" | "thinking">("idle")
  const [voiceQuestions, setVoiceQuestions] = useState<ExpenseVoiceQuestion[]>([])
  const [voiceNotes, setVoiceNotes] = useState<string[]>([])
  const [voiceFilled, setVoiceFilled] = useState(false)
  const [voiceHeard, setVoiceHeard] = useState("")
  // Where a category voice picked came from, when it wasn't said out loud.
  const [voiceCategoryNote, setVoiceCategoryNote] = useState<string | null>(null)
  // "9121" filled as $91.21: the whole-dollar reading, for "It was $9,121".
  const [voiceWholeAmount, setVoiceWholeAmount] = useState<{ cents: number; whole: number } | null>(null)
  const voiceRunRef = useRef(0)
  // The form as it was before voice first filled it, for the note's undo (X).
  const voiceUndoRef = useRef<FormState | null>(null)
  // This recording fixes what voice already filled ("make that 52").
  const voiceFixingRef = useRef(false)
  // What the review's voice button asked for ("amount"), sent with that fix.
  const voiceAskingRef = useRef<string[]>([])
  const formRef = useRef(form)
  formRef.current = form
  const voiceQuestionsRef = useRef(voiceQuestions)
  voiceQuestionsRef.current = voiceQuestions

  const resetVoice = useCallback(() => {
    voiceRunRef.current += 1
    voiceUndoRef.current = null
    voiceFixingRef.current = false
    setVoicePhase("idle")
    setVoiceFilled(false)
    setVoiceQuestions([])
    setVoiceNotes([])
    setVoiceHeard("")
    setVoiceCategoryNote(null)
    setVoiceWholeAmount(null)
  }, [])

  const receiptCapture = useReceiptCapture(activeWorkspaceId)
  const { attachedReceiptAsset, receiptUploading, clearAttachedReceipt } = receiptCapture

  const {
    hydrateFromStorageOnce,
    getVendorSuggestions,
    getDescriptionSuggestions,
    getAccountForVendor,
    updateFromExpense,
  } = useExpenseMemoryStore()
  const settingsEntry = useSettingsStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const settings = settingsEntry?.data ?? null

  useEffect(() => {
    hydrateFromStorageOnce()
  }, [hydrateFromStorageOnce])

  const customExpenseCategories = settings?.independent?.customExpenseCategories ?? []
  const visibilityContext = useMemo(
    () => ({
      workspaceType: activeWorkspaceType,
      independentSettings: settings?.independent ?? null,
    }),
    [activeWorkspaceType, settings?.independent]
  )
  const preferredVehicleMode = useMemo(() => {
    return (
      readVehicleModePreference(activeWorkspaceId) ??
      getDefaultVehicleExpenseMode(settings?.independent ?? null)
    )
  }, [activeWorkspaceId, settings?.independent])

  useEffect(() => {
    if (lastWorkspaceIdRef.current !== activeWorkspaceId) {
      lastWorkspaceIdRef.current = activeWorkspaceId
      clientMutationIdRef.current = generateClientMutationId()
      setForm(createEmptyFormState(preferredVehicleMode))
      setVendorFocused(false)
      setDescriptionFocused(false)
      setExpanded(false)
      setRepeatEnabled(false)
      setRepeatCadence({ freq: "monthly" })
      setRepeatEndDate("")
      clearAttachedReceipt()
      resetVoice()
      return
    }

    setForm((current) => {
      if (!isFreshFormState(current) || current.vehicle.mode === preferredVehicleMode) {
        return current
      }

      return {
        ...current,
        vehicle: {
          ...current.vehicle,
          mode: preferredVehicleMode,
        },
      }
    })
  }, [activeWorkspaceId, preferredVehicleMode])

  const selectedCategoryGuide = useMemo(
    () => findExpenseCategoryGuideEntry(form.account),
    [form.account]
  )
  const normalizedAccountLabel = useMemo(
    () => normalizeExpenseCategoryLabel(form.account, customExpenseCategories),
    [customExpenseCategories, form.account]
  )
  const isVehicleCategorySelected = isVehicleTransportationCategory(
    normalizedAccountLabel
  )
  const isVehicleMileageMode =
    isVehicleCategorySelected && form.vehicle.mode === "mileage"
  const isVehicleDirectMode =
    isVehicleCategorySelected && form.vehicle.mode === "direct_expense"

  // Mileage-calculated amounts vary by period, so they can't be a fixed
  // recurring template — turn "Repeats" off if the category switches into
  // mileage mode while it was on.
  useEffect(() => {
    if (isVehicleMileageMode && repeatEnabled) {
      setRepeatEnabled(false)
    }
  }, [isVehicleMileageMode, repeatEnabled])

  const mileageRate = useMemo(
    () => getBusinessMileageRate(form.date || new Date()),
    [form.date]
  )
  const businessMiles = parseOptionalNumber(form.vehicle.mileage.businessMiles) ?? 0
  const parkingAndTollsAmount =
    parseOptionalNumber(form.vehicle.mileage.parkingAndTolls) ?? 0
  const calculatedVehicleAmount = useMemo(
    () =>
      calculateVehicleExpenseAmount(
        businessMiles,
        mileageRate,
        parkingAndTollsAmount
      ),
    [businessMiles, mileageRate, parkingAndTollsAmount]
  )
  const suggestedMileageDescription = useMemo(
    () =>
      buildVehicleMileageDescription(
        businessMiles,
        parkingAndTollsAmount
      ),
    [businessMiles, parkingAndTollsAmount]
  )

  useEffect(() => {
    setForm((current) => {
      if (current.vehicle.mileage.descriptionIsManual) {
        return current
      }
      if (current.vehicle.mileage.description === suggestedMileageDescription) {
        return current
      }

      return {
        ...current,
        vehicle: {
          ...current.vehicle,
          mileage: {
            ...current.vehicle.mileage,
            description: suggestedMileageDescription,
          },
        },
      }
    })
  }, [suggestedMileageDescription])

  const activeVendorValue = isVehicleMileageMode
    ? form.vehicle.mileage.vendor
    : isVehicleDirectMode
      ? form.vehicle.directExpense.vendor
      : form.generic.vendor
  const activeDescriptionValue = isVehicleMileageMode
    ? form.vehicle.mileage.description
    : isVehicleDirectMode
      ? form.vehicle.directExpense.description
      : form.generic.description
  const vendorSuggestions = vendorFocused ? getVendorSuggestions(activeVendorValue) : []
  const descriptionSuggestions = descriptionFocused
    ? getDescriptionSuggestions(activeDescriptionValue)
    : []

  const getSelectableAutoAccount = useCallback(
    (vendor: string) => {
      const autoAccount = getAccountForVendor(vendor)
      if (!autoAccount) return undefined

      return isExpenseCategorySelectable(
        autoAccount,
        customExpenseCategories,
        visibilityContext
      )
        ? autoAccount
        : undefined
    },
    [customExpenseCategories, getAccountForVendor, visibilityContext]
  )

  const updateDate = useCallback((value: string) => {
    setForm((prev) => ({
      ...prev,
      date: value,
    }))
  }, [])

  // Keep the expense date inside the viewed (possibly past) month's bounds.
  // selectedPeriod is null when the period selector is back on "current" —
  // that's not "no period", it means today's period, so the date should
  // reset to today rather than being left at whatever past period's date
  // was still sitting in the form.
  useEffect(() => {
    if (!selectedPeriod) {
      const today = getLocalDateInputValue()
      setForm((prev) => (prev.date === today ? prev : { ...prev, date: today }))
      return
    }
    setForm((prev) =>
      prev.date < selectedPeriod.start || prev.date > selectedPeriod.end
        ? { ...prev, date: selectedPeriod.end }
        : prev
    )
  }, [selectedPeriod])

  const updateAccount = useCallback(
    (value: string) => {
      setForm((prev) => applyAccountChange(prev, value, customExpenseCategories))
    },
    [customExpenseCategories]
  )

  const updateGenericField = useCallback(
    (field: keyof GenericExpenseFields, value: string) => {
      setForm((prev) => {
        const next = {
          ...prev,
          generic: {
            ...prev.generic,
            [field]: value,
          },
        }

        if (field === "vendor") {
          const autoAccount = getSelectableAutoAccount(value)
          if (autoAccount && !prev.account) {
            next.account = autoAccount
          }
        }

        return next
      })
    },
    [getSelectableAutoAccount]
  )

  const updateVehicleMileageField = useCallback(
    (
      field: Exclude<keyof VehicleMileageFields, "descriptionIsManual">,
      value: string
    ) => {
      setForm((prev) => {
        const next = {
          ...prev,
          vehicle: {
            ...prev.vehicle,
            mileage: {
              ...prev.vehicle.mileage,
              [field]: value,
            },
          },
        }

        if (field === "vendor") {
          const autoAccount = getSelectableAutoAccount(value)
          if (autoAccount && !prev.account) {
            next.account = autoAccount
          }
        }

        if (field === "description") {
          next.vehicle.mileage.descriptionIsManual = true
        }

        return next
      })
    },
    [getSelectableAutoAccount]
  )

  const updateVehicleDirectField = useCallback(
    (field: keyof VehicleDirectExpenseFields, value: string) => {
      setForm((prev) => {
        const next = {
          ...prev,
          vehicle: {
            ...prev.vehicle,
            directExpense: {
              ...prev.vehicle.directExpense,
              [field]: value,
            },
          },
        }

        if (field === "vendor") {
          const autoAccount = getSelectableAutoAccount(value)
          if (autoAccount && !prev.account) {
            next.account = autoAccount
          }
        }

        return next
      })
    },
    [getSelectableAutoAccount]
  )

  const updateVehicleMode = useCallback(
    (mode: VehicleExpenseMode) => {
      setForm((prev) => applyVehicleMode(prev, mode))
      writeVehicleModePreference(activeWorkspaceId, mode)
    },
    [activeWorkspaceId]
  )

  // Resets the form to a blank state without submitting — same fields a
  // successful submit clears, plus the attached receipt (which a submit
  // leaves for the created expense but a manual clear should discard).
  const handleClearForm = useCallback(() => {
    setForm(createEmptyFormState(preferredVehicleMode))
    setVendorFocused(false)
    setDescriptionFocused(false)
    setRepeatEnabled(false)
    setRepeatCadence({ freq: "monthly" })
    setRepeatEndDate("")
    clearAttachedReceipt()
    resetVoice()
  }, [preferredVehicleMode, clearAttachedReceipt, resetVoice])

  const dismissKeyboard = useCallback(() => {
    if (typeof document === "undefined") return

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }, [])

  /** ------------------------------------------------
   * VOICE EXPENSE — say the expense, check the filled form, tap Save expense.
   * Only the typed-out words go to the server (lib/api/voiceEntryApi.ts);
   * nothing is saved until the person taps Save expense themselves.
   * ------------------------------------------------ */
  const voiceCategories = useMemo(
    () => getVisibleExpenseCategoryOptions(customExpenseCategories, visibilityContext).slice(0, 150),
    [customExpenseCategories, visibilityContext]
  )
  const voiceVehicleCategory = useMemo(
    () =>
      voiceCategories.find((option) =>
        isVehicleTransportationCategory(normalizeExpenseCategoryLabel(option, customExpenseCategories))
      ) ?? null,
    [voiceCategories, customExpenseCategories]
  )

  /** Outlines the filled boxes for a moment so it's clear what changed. */
  const flashVoiceFields = useCallback((ids: string[]) => {
    window.setTimeout(() => {
      for (const id of ids) {
        const element = document.getElementById(id)
        // Date and the big amount sit inside a row; outline the row.
        const target = id === "date" || id === "amount" ? element?.closest<HTMLElement>(".rounded-2xl") : element
        if (!target) continue
        target.style.outline = "2px solid #2FA866"
        target.style.outlineOffset = "-2px"
        window.setTimeout(() => {
          target.style.outline = ""
          target.style.outlineOffset = ""
        }, 2600)
      }
    }, 60)
  }, [])

  const handleVoiceTranscript = useCallback(
    async (transcript: string) => {
      if (!activeWorkspaceId) return
      const run = ++voiceRunRef.current
      const fixing = voiceFixingRef.current
      const openQuestions = fixing ? voiceQuestionsRef.current : []
      setVoicePhase("thinking")
      setVoiceHeard(transcript)
      setVoiceNotes([])
      if (!fixing) {
        setVoiceQuestions([])
        setVoiceFilled(false)
        setVoiceCategoryNote(null)
      }

      try {
        const current = formRef.current
        const today = getLocalDateInputValue()
        const currentIsVehicle = isVehicleTransportationCategory(
          normalizeExpenseCategoryLabel(current.account, customExpenseCategories)
        )
        const currentMode = currentIsVehicle ? current.vehicle.mode : null
        const mileage = current.vehicle.mileage
        const fields = currentMode === "direct_expense" ? current.vehicle.directExpense : current.generic

        const result = await parseVoiceExpense({
          kind: "expense",
          transcript,
          today,
          workspaceId: activeWorkspaceId,
          categories: voiceCategories,
          vehicleCategory: voiceVehicleCategory,
          ...(fixing
            ? {
                asking: voiceAskingRef.current.length > 0 ? voiceAskingRef.current : undefined,
                current: voiceExpenseCurrentFor(
                  currentMode === "mileage"
                    ? {
                        date: current.date,
                        today,
                        account: current.account,
                        amount: "",
                        vendor: mileage.vendor,
                        // The made-up "18 business miles" line isn't something they said.
                        description: mileage.descriptionIsManual ? mileage.description : "",
                        miles: mileage.businessMiles,
                        parkingAndTolls: mileage.parkingAndTolls,
                      }
                    : {
                        date: current.date,
                        today,
                        account: current.account,
                        amount: fields.amount,
                        vendor: fields.vendor,
                        description: fields.description,
                        miles: "",
                        parkingAndTolls: "",
                      }
                ),
              }
            : {}),
        })
        if (run !== voiceRunRef.current) return

        const plan = planExpenseFill(result, {
          categories: voiceCategories,
          vehicleCategory: voiceVehicleCategory,
          dateBounds: selectedPeriod ? { start: selectedPeriod.start, end: selectedPeriod.end } : null,
          phoneLearned: getSelectableAutoAccount,
          recentCategories: [...useExpenseMemoryStore.getState().memory.accounts].reverse(),
          fixing,
          currentCategory: current.account || null,
          currentVehicleMode: currentMode,
        })
        const nothingFilled =
          !plan.date && !plan.amount && !plan.vendor && !plan.description && !plan.category &&
          !plan.miles && !plan.parkingAndTolls && plan.questions.length === 0
        if (!result.isExpense || nothingFilled) {
          setVoiceNotes([
            ...plan.skipped,
            fixing
              ? "Didn't catch a change in that. Try again, like \u201cmake that 52.\u201d"
              : "Didn't catch an expense in that. Try again, like \u201c42 on gas at Shell.\u201d",
          ])
          return
        }

        const flash: string[] = []
        const asText = (n: number) => String(Math.round(n * 100) / 100)
        setForm((prev) => {
          if (!voiceUndoRef.current) voiceUndoRef.current = prev
          let next = prev
          if (plan.category && plan.category !== prev.account) {
            next = applyAccountChange(next, plan.category, customExpenseCategories)
            flash.push("expense-category-field")
          }
          const isVehicle = isVehicleTransportationCategory(
            normalizeExpenseCategoryLabel(next.account, customExpenseCategories)
          )
          if (isVehicle && plan.vehicleMode && plan.vehicleMode !== next.vehicle.mode) {
            // Not saved as their preferred mode: that's for when they pick it themselves.
            next = applyVehicleMode(next, plan.vehicleMode)
          }
          next = {
            ...next,
            generic: { ...next.generic },
            vehicle: {
              ...next.vehicle,
              mileage: { ...next.vehicle.mileage },
              directExpense: { ...next.vehicle.directExpense },
            },
          }
          if (plan.date) {
            next.date = plan.date
            flash.push("date")
          }
          if (isVehicle && next.vehicle.mode === "mileage") {
            const m = next.vehicle.mileage
            if (plan.vendor) {
              m.vendor = plan.vendor
              flash.push("vehicleMileageVendor")
            }
            if (plan.miles) {
              m.businessMiles = asText(plan.miles)
              flash.push("businessMiles")
            }
            if (plan.parkingAndTolls) {
              m.parkingAndTolls = asText(plan.parkingAndTolls)
              flash.push("parkingAndTolls")
            }
            if (plan.description) {
              m.description = plan.description
              m.descriptionIsManual = true
              flash.push("vehicleMileageDescription")
            }
          } else {
            const direct = isVehicle
            const target = direct ? next.vehicle.directExpense : next.generic
            if (plan.amount) {
              target.amount = asText(plan.amount)
              flash.push(direct ? "vehicleDirectAmount" : "amount")
            }
            if (plan.vendor) {
              target.vendor = plan.vendor
              flash.push(direct ? "vehicleDirectVendor" : "vendor")
            }
            if (plan.description) {
              target.description = plan.description
              flash.push(direct ? "vehicleDirectDescription" : "description")
            }
          }
          return next
        })
        setExpanded(true)

        if (plan.category) {
          setVoiceCategoryNote(
            plan.categorySource === "learned"
              ? `Category: ${plan.category} (from your past expenses)`
              : plan.categorySource === "suggested"
                ? `Category: ${plan.category} (suggested \u2014 check it)`
                : null
          )
        }
        // New questions get ids from this run so they never clash with ones still open.
        const newQuestions = plan.questions.map((q) => ({ ...q, id: `${run}-${q.id}` }))
        // On a fix, an open question stays unless the fix answered or re-asked it.
        const answered = new Set<string>(newQuestions.map((q) => q.kind))
        if (plan.category) answered.add("category")
        if (plan.miles) answered.add("miles")
        setVoiceQuestions(
          fixing ? [...openQuestions.filter((q) => !answered.has(q.kind)), ...newQuestions] : newQuestions
        )
        if (plan.amount !== null) {
          setVoiceWholeAmount(plan.amountAsWhole ? { cents: plan.amount, whole: plan.amountAsWhole } : null)
        }
        setVoiceNotes(plan.skipped)
        setVoiceFilled(true)
        flashVoiceFields(flash)
        scrollToVoiceReview("voice-expense-review")
      } catch (error) {
        if (run !== voiceRunRef.current) return
        console.warn("[VoiceExpense] fill failed", error)
        // 429 = today's voice limit (server message says so); anything else is a plain failure.
        const limited = (error as { status?: number })?.status === 429
        setVoiceNotes([
          limited && error instanceof Error ? error.message : "Couldn't fill in the form just now. Try again or type it in.",
        ])
      } finally {
        if (run === voiceRunRef.current) setVoicePhase("idle")
      }
    },
    [
      activeWorkspaceId,
      customExpenseCategories,
      flashVoiceFields,
      getSelectableAutoAccount,
      selectedPeriod,
      voiceCategories,
      voiceVehicleCategory,
    ]
  )
  const speech = useSpeechCapture((transcript) => void handleVoiceTranscript(transcript))

  // Said to Ask 521 on Home ("42 on gas at Shell"): fill from those words.
  // The mic, for a handoff that only named this form (startVoice is defined below).
  const startVoiceRef = useRef<() => void>(() => {})
  const voiceHandoff = useVoiceHandoffStore((state) => state.request)
  const takeVoiceHandoff = useVoiceHandoffStore((state) => state.take)
  useEffect(() => {
    if (voiceHandoff?.target !== "expense" || !activeWorkspaceId || voiceCategories.length === 0) return
    if (voiceHandoff.listen && !speech.checked) return
    const taken = takeVoiceHandoff(["expense"], activeWorkspaceId)
    if (!taken) return
    voiceFixingRef.current = false
    voiceUndoRef.current = null
    setVoiceFilled(false)
    setExpanded(true)
    window.setTimeout(() => document.querySelector('[data-tour="entry-form"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 120)
    if (taken.listen) {
      if (speech.supported) startVoiceRef.current()
      return
    }
    void handleVoiceTranscript(taken.transcript)
  }, [voiceHandoff, activeWorkspaceId, voiceCategories.length, takeVoiceHandoff, handleVoiceTranscript, speech.checked, speech.supported])

  /** With the filled-in note showing, the mic fixes what voice filled
   * ("make that 52") instead of starting over. */
  const startVoice = useCallback((ask?: VoiceAsk | null) => {
    wakeVoiceEntry()
    setExpanded(true)
    setVoiceNotes([])
    voiceFixingRef.current = voiceFilled
    voiceAskingRef.current = voiceFilled && ask ? ask.asking : []
    if (!voiceFilled) {
      setVoiceQuestions([])
      setVoiceCategoryNote(null)
      voiceUndoRef.current = null
    }
    speech.resetStatus()
    void speech.start(voiceExpenseHints(useExpenseMemoryStore.getState().memory.vendors, voiceCategories))
  }, [speech, voiceFilled, voiceCategories])

  startVoiceRef.current = () => startVoice()

  /** "It was $9,121": swaps the dollars-and-cents reading for the whole one. */
  // "Hey Siri, add an expense in 521": open the form listening.
  const voiceLaunch = useVoiceLaunchStore((state) => state.request)
  useEffect(() => {
    if (voiceLaunch?.target !== "expense" || !speech.checked || !activeWorkspaceId) return
    if (!useVoiceLaunchStore.getState().take("expense")) return
    setExpanded(true)
    window.setTimeout(() => document.querySelector('[data-tour="entry-form"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 150)
    if (speech.supported) startVoice()
  }, [voiceLaunch, speech.checked, speech.supported, activeWorkspaceId, startVoice])

  const switchToWholeVoiceAmount = useCallback(() => {
    if (!voiceWholeAmount) return
    const { cents, whole } = voiceWholeAmount
    setForm((prev) => {
      const isVehicle = isVehicleTransportationCategory(
        normalizeExpenseCategoryLabel(prev.account, customExpenseCategories)
      )
      const matches = (value: string) => Number(value) === cents
      if (isVehicle && prev.vehicle.mode === "direct_expense" && matches(prev.vehicle.directExpense.amount)) {
        return {
          ...prev,
          vehicle: { ...prev.vehicle, directExpense: { ...prev.vehicle.directExpense, amount: String(whole) } },
        }
      }
      if (!isVehicle && matches(prev.generic.amount)) {
        return { ...prev, generic: { ...prev.generic, amount: String(whole) } }
      }
      return prev
    })
    flashVoiceFields(["amount", "vehicleDirectAmount"])
    setVoiceWholeAmount(null)
  }, [voiceWholeAmount, customExpenseCategories, flashVoiceFields])

  /** The note's X: puts the form back as it was before voice filled it. */
  const undoVoiceFill = useCallback(() => {
    const before = voiceUndoRef.current
    if (before) setForm(before)
    resetVoice()
  }, [resetVoice])

  const answerVoiceQuestion = useCallback(
    (question: ExpenseVoiceQuestion, choice: { category: string } | { miles: number } | null) => {
      if (choice && "category" in choice) {
        setForm((prev) => applyAccountChange(prev, choice.category, customExpenseCategories))
        setVoiceCategoryNote(null)
        flashVoiceFields(["expense-category-field"])
      } else if (choice && "miles" in choice) {
        setForm((prev) => ({
          ...prev,
          vehicle: {
            ...prev.vehicle,
            mileage: { ...prev.vehicle.mileage, businessMiles: String(choice.miles) },
          },
        }))
        flashVoiceFields(["businessMiles"])
      }
      setVoiceQuestions((prev) => prev.filter((q) => q.id !== question.id))
    },
    [customExpenseCategories, flashVoiceFields]
  )

  const buildPayload = useCallback(() => {
    const normalizedAccount =
      resolveExpenseCategoryLabel(form.account, customExpenseCategories) ??
      sanitizeExpenseCategoryName(form.account)

    if (!normalizedAccount) {
      throw new Error("Please choose a valid expense category.")
    }

    if (
      !isExpenseCategorySelectable(
        normalizedAccount,
        customExpenseCategories,
        visibilityContext
      )
    ) {
      throw new Error("This expense category is not enabled in settings.")
    }

    if (isVehicleMileageMode) {
      const description = form.vehicle.mileage.description.trim()
      const vendor = form.vehicle.mileage.vendor.trim()

      if (calculatedVehicleAmount <= 0) {
        throw new Error("Add business miles or parking and tolls.")
      }

      if (!description) {
        throw new Error("Please enter a description.")
      }

      return {
        date: form.date,
        amount: calculatedVehicleAmount,
        vendor,
        description,
        account: normalizedAccount,
        periodId: getCalendarMonthBucketFromDate(form.date),
        calculationMethod: "vehicle_mileage" as const,
        vehicleExpenseMode: "mileage" as const,
        businessMiles: businessMiles > 0 ? businessMiles : undefined,
        milesDriven: businessMiles > 0 ? businessMiles : undefined,
        mileageRate: businessMiles > 0 ? mileageRate : undefined,
        parkingAndTolls:
          parkingAndTollsAmount > 0 ? parkingAndTollsAmount : undefined,
        receiptAssetId: attachedReceiptAsset?.id,
        clientMutationId: clientMutationIdRef.current,
      }
    }

    const activeFields = isVehicleDirectMode
      ? form.vehicle.directExpense
      : form.generic
    const amountNumber = parseOptionalNumber(activeFields.amount)
    const vendor = activeFields.vendor.trim()
    const description = activeFields.description.trim()

    if (amountNumber == null || amountNumber <= 0) {
      throw new Error("Please enter a valid amount.")
    }

    if (!vendor) {
      throw new Error("Please enter a vendor.")
    }

    if (!description) {
      throw new Error("Please enter a description.")
    }

    return {
      date: form.date,
      amount: amountNumber,
      vendor,
      description,
      account: normalizedAccount,
      periodId: getCalendarMonthBucketFromDate(form.date),
      calculationMethod: "manual" as const,
      vehicleExpenseMode: isVehicleDirectMode
        ? ("direct_expense" as const)
        : undefined,
      receiptAssetId: attachedReceiptAsset?.id,
      clientMutationId: clientMutationIdRef.current,
    }
  }, [
    attachedReceiptAsset,
    businessMiles,
    calculatedVehicleAmount,
    customExpenseCategories,
    form,
    isVehicleDirectMode,
    isVehicleMileageMode,
    mileageRate,
    parkingAndTollsAmount,
    visibilityContext,
  ])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (submitting) return

      // The form only opens inside a workspace.
      if (!activeWorkspaceId) return

      // An answer voice is still waiting on isn't on the form yet.
      if (voiceQuestions.length > 0) {
        setVoiceNotes(["Answer the question above, or tap Skip, then save."])
        document
          .getElementById(`voice-question-${voiceQuestions[0].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }

      setSubmitting(true)

      try {
        const payload = buildPayload()
        const parsed = ExpenseInputSchema.safeParse(payload)

        if (!parsed.success) {
          const firstIssue = parsed.error.issues[0]
          alert(firstIssue?.message || "Some required fields are missing or invalid.")
          setSubmitting(false)
          return
        }

        const validated = parsed.data
        const submittedForm = form
        const submittedRepeatEnabled = repeatEnabled
        // If a receipt capture is still in its brief processing window at
        // submit time, don't make the user wait on it — grab the in-flight
        // promise now, before clearAttachedReceipt() below resets the
        // hook's own state, so the create call below can pick up the
        // resulting receiptAssetId once it's ready without blocking
        // anything the user does in the meantime. Recurring rule templates
        // deliberately don't support receipts (see recurringRule.ts), so
        // only the plain-expense branch needs this.
        const pendingReceiptCapture = receiptUploading ? receiptCapture.waitForPendingCapture() : null
        const createPromise = submittedRepeatEnabled
          ? recurringRulesService.createRecurringRule(activeWorkspaceId, {
              type: "expense" as const,
              cadence: repeatCadence,
              anchorDate: validated.date,
              endDate: repeatEndDate || null,
              expenseTemplate: {
                amount: validated.amount,
                vendor: validated.vendor,
                description: validated.description,
                account: validated.account,
              },
            })
          : (async () => {
              const receiptAssetId = pendingReceiptCapture
                ? ((await pendingReceiptCapture)?.id ?? validated.receiptAssetId)
                : validated.receiptAssetId
              return expensesService.createExpense(activeWorkspaceId, { ...validated, receiptAssetId })
            })()

        setForm(createEmptyFormState(form.vehicle.mode))
        setVendorFocused(false)
        setDescriptionFocused(false)
        setExpanded(false)
        setRepeatEnabled(false)
        setRepeatCadence({ freq: "monthly" })
        setRepeatEndDate("")
        dismissKeyboard()
        clearAttachedReceipt()
        resetVoice()
        setSubmitting(false)

        void createPromise
          .then(() => {
            clientMutationIdRef.current = generateClientMutationId()
            updateFromExpense({
              vendor: validated.vendor,
              description: validated.description,
              account: validated.account,
            })
          })
          .catch((error) => {
            setExpanded(true)
            setForm((current) => (isFreshFormState(current) ? submittedForm : current))
            setRepeatEnabled(submittedRepeatEnabled)
            // Offline already surfaced its own toast — avoid a redundant alert.
            if (error instanceof Error && error.message.startsWith("Offline —")) return
            reportFailure({
              kind: "user_saw_error",
              step: submittedRepeatEnabled ? "save_recurring_expense" : "save_expense",
              where: "expense-form",
              error,
              workspaceId: activeWorkspaceId,
            })
            alert(
              submittedRepeatEnabled
                ? "Failed to save recurring expense. Please try again."
                : "Failed to save expense. Please try again."
            )
          })

        return
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to save expense.")
      } finally {
        setSubmitting(false)
      }
    },
    [
      activeWorkspaceId,
      buildPayload,
      clearAttachedReceipt,
      dismissKeyboard,
      form,
      receiptCapture,
      receiptUploading,
      repeatCadence,
      repeatEnabled,
      repeatEndDate,
      resetVoice,
      submitting,
      updateFromExpense,
      voiceQuestions,
    ]
  )

  if (workspaceState.status !== "ready") {
    return (
      <Card className="gap-0 rounded-[22px] py-4 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Add expense</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Expense form help"
                >
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-sm">
                Tap the plus button to expand and add a new expense.
              </PopoverContent>
            </Popover>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? "Collapse expense form" : "Expand expense form"}
          >
            {expanded ? <Minus /> : <Plus />}
          </Button>
        </CardHeader>
        <CardContent className="px-5 pt-0">
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        </CardContent>
      </Card>
    )
  }

  const voiceListening = speech.status === "listening"
  const voiceBusy = voiceListening || voicePhase === "thinking"
  // The review's voice button asks for whatever the expense still needs.
  const voiceMissing: string[] = []
  if (isVehicleMileageMode) {
    if (!(Number(form.vehicle.mileage.businessMiles) > 0)) voiceMissing.push("miles")
  } else if (!(Number(isVehicleDirectMode ? form.vehicle.directExpense.amount : form.generic.amount) > 0)) {
    voiceMissing.push("amount")
  }
  if (!form.account && !voiceQuestions.some((q) => q.kind === "category")) voiceMissing.push("category")
  const voiceAsk: VoiceAsk | null =
    voiceMissing.length > 0 ? { label: `Say the ${listWords(voiceMissing)}`, asking: voiceMissing } : null

  return (
    <Card
      className={`rounded-[22px] shadow-none ${
        expanded ? "gap-5 py-5" : "gap-0 py-4"
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-col items-start gap-0.5 text-left"
          aria-hidden="true"
          tabIndex={-1}
        >
          <CardTitle className="text-lg">Add expense</CardTitle>
          {!expanded ? (
            <span className="text-sm text-muted-foreground">
              Log a purchase or mileage for any day
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {speech.supported ? (
            voiceListening ? (
              <Button
                type="button"
                size="icon"
                className="size-10 shrink-0 animate-pulse rounded-full bg-[#2FA866] text-white hover:bg-[#2FA866]/90"
                onClick={speech.done}
                aria-label="Stop and fill in"
              >
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-10 shrink-0 rounded-full"
                onClick={() => startVoice()}
                aria-label="Say your expense"
                disabled={submitting || voiceBusy}
              >
                <Mic />
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant={expanded ? "ghost" : "default"}
            size="icon"
            className="size-10 shrink-0 rounded-full"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? "Collapse expense form" : "Expand expense form"}
          >
            {expanded ? <Minus /> : <Plus />}
          </Button>
        </div>
      </CardHeader>

      {!expanded ? (
        <CardContent className="px-5 pt-0 pb-0" />
      ) : (
        <CardContent className="px-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {voiceListening ? (
              <div className="space-y-3 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                  Listening…
                </div>
                <p className="text-base text-foreground">
                  {speech.transcript || (
                    <span className="text-muted-foreground">Say it like “42 on gas at Shell” or “drove 18 miles to a client.”</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">Tap the green button or pause when you&apos;re done.</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="rounded-full" onClick={speech.done} disabled={!speech.transcript}>
                    Done
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={speech.cancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {voicePhase === "thinking" ? (
              <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
                Filling in the form…
              </p>
            ) : null}

            {speech.status === "denied" ? (
              <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521, or type your expense below.
              </p>
            ) : null}
            {speech.status === "error" ? (
              <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                Couldn&apos;t hear that. Tap the mic to try again, or type your expense below.
              </p>
            ) : null}

            {voiceHeard && !voiceFilled && !voiceListening ? (
              <p className="px-1 text-sm text-muted-foreground">Heard: “{voiceHeard}”</p>
            ) : null}

            {voiceFilled ? <VoiceReviewLabel id="voice-expense-review" /> : null}

            {!voiceFilled
              ? voiceNotes.map((note) => (
                  <p key={note} className="px-1 text-sm text-muted-foreground">
                    {note}
                  </p>
                ))
              : null}

            {/* Receipt attachment — placed first so the user can kick off the
                upload immediately while filling in the rest of the form.
                Stays mounted at a fixed height through the brief
                decode/quality-check/create-doc window (showing the picked
                photo with a "Processing" label) so the fields below never
                shift. The rest of the form — including submitting it — is
                never blocked on this; see handleSubmit's
                pendingReceiptCapture handling. */}
            <ReceiptCaptureField capture={receiptCapture} />

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-1.5">
              <Label htmlFor="date" className="shrink-0 text-sm font-normal text-muted-foreground">
                Date
              </Label>
              <Input
                className="h-9 w-auto min-w-0 border-0 bg-transparent px-0 text-right font-medium shadow-none focus-visible:ring-0"
                id="date"
                type="date"
                data-stackin-date-input="true"
                value={form.date}
                onChange={(event) => updateDate(event.target.value)}
                min={selectedPeriod?.start}
                max={selectedPeriod?.end}
                required
              />
            </div>

            <div id="expense-category-field" className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="account-trigger" className="text-sm font-normal text-muted-foreground">
                  Category
                </Label>
                {selectedCategoryGuide ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label={`About ${selectedCategoryGuide.category}`}
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 space-y-2 text-sm">
                      <div className="font-medium">{selectedCategoryGuide.category}</div>
                      <p className="text-muted-foreground">
                        {selectedCategoryGuide.shortSummary}
                      </p>
                      <p>
                        <span className="font-medium">Includes:</span>{" "}
                        {selectedCategoryGuide.includes}
                      </p>
                      <p>
                        <span className="font-medium">Rule of thumb:</span>{" "}
                        {selectedCategoryGuide.ruleOfThumb}
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>

              <ExpenseCategoryPicker
                workspaceId={activeWorkspaceId}
                workspaceType="independent"
                value={form.account}
                onSelect={updateAccount}
                placeholder="Choose an expense category"
                triggerClassName={FIELD_INPUT_CLASS}
              />

              <p className="text-xs text-muted-foreground">
                Choose from built-in or saved custom expense categories.
              </p>
            </div>

            {isVehicleCategorySelected ? (
              <div className="space-y-4 rounded-2xl border border-border/70 p-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Vehicle Expense Mode</div>
                  <ToggleGroup
                    type="single"
                    value={form.vehicle.mode}
                    onValueChange={(value) => {
                      if (value === "mileage" || value === "direct_expense") {
                        updateVehicleMode(value)
                      }
                    }}
                    className="grid w-full grid-cols-2 rounded-full bg-muted p-1"
                    aria-label="Vehicle expense mode"
                  >
                    <ToggleGroupItem
                      value="mileage"
                      className="w-full rounded-full text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                    >
                      Mileage
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="direct_expense"
                      className="w-full rounded-full text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                    >
                      Direct Expense
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-xs text-muted-foreground">
                    {isVehicleMileageMode
                      ? "The mileage rate already covers gas and maintenance. Only add parking and tolls."
                      : "Enter what you actually paid, like gas, repairs, or insurance."}
                  </p>
                </div>

                {isVehicleMileageMode ? (
                  <>
                    <div className="relative">
                      <VendorLabel htmlFor="vehicleMileageVendor" optional />
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleMileageVendor"
                        type="text"
                        value={form.vehicle.mileage.vendor}
                        onChange={(event) => {
                          updateVehicleMileageField("vendor", event.target.value)
                          setVendorFocused(true)
                        }}
                        onFocus={() => setVendorFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setVendorFocused(false), 100)
                        }}
                        autoComplete="off"
                      />
                      {vendorSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                          {vendorSuggestions.map((vendor) => (
                            <button
                              key={vendor}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleMileageField("vendor", vendor)
                                setVendorFocused(false)
                              }}
                            >
                              {vendor}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="businessMiles" className={FIELD_LABEL_CLASS}>Business Miles</Label>
                        <Input
                          className={FIELD_INPUT_CLASS}
                          id="businessMiles"
                          type="number"
                          step="0.1"
                          min="0"
                          placeholder="0"
                          value={form.vehicle.mileage.businessMiles}
                          onChange={(event) =>
                            updateVehicleMileageField(
                              "businessMiles",
                              event.target.value
                            )
                          }
                        />
                      </div>

                      <div>
                        <Label htmlFor="parkingAndTolls" className={FIELD_LABEL_CLASS}>Parking & Tolls</Label>
                        <Input
                          className={FIELD_INPUT_CLASS}
                          id="parkingAndTolls"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={form.vehicle.mileage.parkingAndTolls}
                          onChange={(event) =>
                            updateVehicleMileageField(
                              "parkingAndTolls",
                              event.target.value
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2 rounded-xl bg-muted px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Mileage reimbursement rate
                        </span>
                        <span className="font-medium">
                          {(mileageRate * 100).toFixed(1)} cents/mile
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-semibold">
                          ${calculatedVehicleAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="vehicleMileageAmount" className={FIELD_LABEL_CLASS}>Amount</Label>
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleMileageAmount"
                        type="number"
                        step="0.01"
                        value={calculatedVehicleAmount.toFixed(2)}
                        readOnly
                        aria-readonly="true"
                      />
                    </div>

                    <div className="relative">
                      <Label htmlFor="vehicleMileageDescription" className={FIELD_LABEL_CLASS}>Description</Label>
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleMileageDescription"
                        type="text"
                        value={form.vehicle.mileage.description}
                        onChange={(event) => {
                          updateVehicleMileageField("description", event.target.value)
                          setDescriptionFocused(true)
                        }}
                        onFocus={() => setDescriptionFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setDescriptionFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {descriptionSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                          {descriptionSuggestions.map((description) => (
                            <button
                              key={description}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleMileageField("description", description)
                                setDescriptionFocused(false)
                              }}
                            >
                              {description}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <VendorLabel htmlFor="vehicleDirectVendor" />
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleDirectVendor"
                        type="text"
                        value={form.vehicle.directExpense.vendor}
                        onChange={(event) => {
                          updateVehicleDirectField("vendor", event.target.value)
                          setVendorFocused(true)
                        }}
                        onFocus={() => setVendorFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setVendorFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {vendorSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                          {vendorSuggestions.map((vendor) => (
                            <button
                              key={vendor}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleDirectField("vendor", vendor)
                                setVendorFocused(false)
                              }}
                            >
                              {vendor}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <Label htmlFor="vehicleDirectAmount" className={FIELD_LABEL_CLASS}>Amount</Label>
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleDirectAmount"
                        type="number"
                        step="0.01"
                        value={form.vehicle.directExpense.amount}
                        onChange={(event) =>
                          updateVehicleDirectField("amount", event.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="relative">
                      <Label htmlFor="vehicleDirectDescription" className={FIELD_LABEL_CLASS}>Description</Label>
                      <Input
                        className={FIELD_INPUT_CLASS}
                        id="vehicleDirectDescription"
                        type="text"
                        value={form.vehicle.directExpense.description}
                        onChange={(event) => {
                          updateVehicleDirectField("description", event.target.value)
                          setDescriptionFocused(true)
                        }}
                        onFocus={() => setDescriptionFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setDescriptionFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {descriptionSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                          {descriptionSuggestions.map((description) => (
                            <button
                              key={description}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleDirectField("description", description)
                                setDescriptionFocused(false)
                              }}
                            >
                              {description}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
                  <Label htmlFor="amount" className="text-base font-medium">
                    Amount
                  </Label>
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-lg text-muted-foreground">$</span>
                    <input
                      id="amount"
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={form.generic.amount}
                      onChange={(event) =>
                        updateGenericField("amount", event.target.value)
                      }
                      required
                      style={{ width: `${form.generic.amount.length || 4}ch` }}
                      className="min-w-[1ch] max-w-36 bg-transparent text-right text-2xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>

                <div className="relative">
                  <VendorLabel htmlFor="vendor" />
                  <Input
                    className={FIELD_INPUT_CLASS}
                    id="vendor"
                    type="text"
                    value={form.generic.vendor}
                    onChange={(event) => {
                      updateGenericField("vendor", event.target.value)
                      setVendorFocused(true)
                    }}
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setVendorFocused(false), 100)
                    }}
                    autoComplete="off"
                    required
                  />
                  {vendorSuggestions.length > 0 ? (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                      {vendorSuggestions.map((vendor) => (
                        <button
                          key={vendor}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            updateGenericField("vendor", vendor)
                            setVendorFocused(false)
                          }}
                        >
                          {vendor}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <Label htmlFor="description" className={FIELD_LABEL_CLASS}>Description</Label>
                  <Input
                    className={FIELD_INPUT_CLASS}
                    id="description"
                    type="text"
                    value={form.generic.description}
                    onChange={(event) => {
                      updateGenericField("description", event.target.value)
                      setDescriptionFocused(true)
                    }}
                    onFocus={() => setDescriptionFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setDescriptionFocused(false), 100)
                    }}
                    autoComplete="off"
                    required
                  />
                  {descriptionSuggestions.length > 0 ? (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                      {descriptionSuggestions.map((description) => (
                        <button
                          key={description}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            updateGenericField("description", description)
                            setDescriptionFocused(false)
                          }}
                        >
                          {description}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            )}

            {!isVehicleMileageMode ? (
              <RecurringCadencePicker
                idPrefix="expense"
                enabled={repeatEnabled}
                onEnabledChange={setRepeatEnabled}
                cadence={repeatCadence}
                onCadenceChange={setRepeatCadence}
                endDate={repeatEndDate}
                onEndDateChange={setRepeatEndDate}
                minEndDate={form.date}
              />
            ) : null}

            {voiceFilled && !voiceBusy ? (
              <VoiceReviewFooter
                heard={voiceHeard}
                ask={voiceAsk}
                onVoice={() => startVoice(voiceAsk)}
                onUndo={undoVoiceFill}
                disabled={submitting}
              >
                {voiceQuestions.map((question) => (
                  <div
                    key={question.id}
                    id={`voice-question-${question.id}`}
                    className="space-y-2 rounded-2xl bg-muted px-4 py-3"
                  >
                    <p className="text-sm font-medium text-foreground">{question.prompt}</p>
                    <div className="flex flex-wrap gap-2">
                      {question.kind === "category"
                        ? question.options.map((option) => (
                            <button
                              key={option.category}
                              type="button"
                              onClick={() => answerVoiceQuestion(question, { category: option.category })}
                              className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                            >
                              {option.label}
                            </button>
                          ))
                        : question.options.map((option) => (
                            <button
                              key={option.miles}
                              type="button"
                              onClick={() => answerVoiceQuestion(question, { miles: option.miles })}
                              className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                            >
                              {option.label}
                            </button>
                          ))}
                      <button
                        type="button"
                        onClick={() => answerVoiceQuestion(question, null)}
                        className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                      >
                        {question.kind === "category" ? "I'll pick above" : "Skip"}
                      </button>
                    </div>
                  </div>
                ))}
                {voiceNotes.map((note) => (
                  <p key={note} className="px-1 text-sm text-muted-foreground">
                    {note}
                  </p>
                ))}

                {voiceCategoryNote ? <p className="px-1 text-sm text-muted-foreground">{voiceCategoryNote}</p> : null}
                {voiceWholeAmount ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Read {voiceWholeAmount.whole} as ${voiceWholeAmount.cents.toFixed(2)}.
                    </span>
                    <button
                      type="button"
                      onClick={switchToWholeVoiceAmount}
                      className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      It was ${voiceWholeAmount.whole.toLocaleString("en-US")}
                    </button>
                  </div>
                ) : null}
              </VoiceReviewFooter>
            ) : null}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-2xl px-5 text-muted-foreground"
                onClick={handleClearForm}
                disabled={submitting}
              >
                Clear
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 flex-1 rounded-2xl text-base font-semibold"
              >
                {submitting ? "Saving..." : repeatEnabled ? "Save recurring expense" : "Save expense"}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
