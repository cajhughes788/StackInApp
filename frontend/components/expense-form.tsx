"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Camera, ImagePlus, Info, Minus, Paperclip, Plus, X } from "lucide-react"

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
  isExpenseCategorySelectable,
  normalizeExpenseCategoryLabel,
  resolveExpenseCategoryLabel,
  sanitizeExpenseCategoryName,
} from "@/lib/expenseCategories"
import { getLocalDateInputValue } from "@/lib/helpers"
import * as expensesService from "@/lib/domain/expenseService"
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { createReceiptAsset, deleteReceiptAsset } from "@/lib/api/receiptAssetsApi"
import { analyzeReceiptImageQuality } from "@/lib/receipts/imageQuality"
import {
  loadReceiptImage,
  normalizeExifOrientation,
} from "@/lib/receipts/imagePipeline"
import {
  buildClientReceiptDerivedPath,
  buildClientReceiptStoragePath,
  prepareReceiptPreviewFile,
  prepareReceiptThumbnailFile,
  prepareReceiptUploadFile,
  uploadReceiptAssetToStorage,
} from "@/lib/receipts/receiptAssetStorage"
import { captureReceiptImage, isNativeCameraAvailable } from "@/lib/native/camera"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

const ExpenseInputSchema = ExpenseInput
const VEHICLE_MODE_STORAGE_KEY = "stackin.vehicleExpenseMode"

type GenericExpenseFields = {
  amount: string
  vendor: string
  description: string
}

type VehicleMileageFields = {
  vendor: string
  businessMiles: string
  fuel: string
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
        fuel: "",
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
    form.vehicle.mileage.fuel === "" &&
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

function VendorLabel({
  htmlFor,
  optional = false,
}: {
  htmlFor: string
  optional?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>
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

  const [form, setForm] = useState<FormState>(() =>
    createEmptyFormState("direct_expense")
  )
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [vendorFocused, setVendorFocused] = useState(false)
  const [descriptionFocused, setDescriptionFocused] = useState(false)
  const lastWorkspaceIdRef = useRef<string | null>(null)

  // Receipt attachment state
  const [attachedReceiptAsset, setAttachedReceiptAsset] = useState<ReceiptAsset | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [isNativeCamera, setIsNativeCamera] = useState(false)
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setIsNativeCamera(isNativeCameraAvailable())
  }, [])

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
      setForm(createEmptyFormState(preferredVehicleMode))
      setVendorFocused(false)
      setDescriptionFocused(false)
      setExpanded(false)
      setAttachedReceiptAsset(null)
      setReceiptError(null)
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

  const mileageRate = useMemo(
    () => getBusinessMileageRate(form.date || new Date()),
    [form.date]
  )
  const businessMiles = parseOptionalNumber(form.vehicle.mileage.businessMiles) ?? 0
  const fuelAmount = parseOptionalNumber(form.vehicle.mileage.fuel) ?? 0
  const parkingAndTollsAmount =
    parseOptionalNumber(form.vehicle.mileage.parkingAndTolls) ?? 0
  const calculatedVehicleAmount = useMemo(
    () =>
      calculateVehicleExpenseAmount(
        businessMiles,
        mileageRate,
        fuelAmount,
        parkingAndTollsAmount
      ),
    [businessMiles, fuelAmount, mileageRate, parkingAndTollsAmount]
  )
  const suggestedMileageDescription = useMemo(
    () =>
      buildVehicleMileageDescription(
        businessMiles,
        fuelAmount,
        parkingAndTollsAmount
      ),
    [businessMiles, fuelAmount, parkingAndTollsAmount]
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

  const updateAccount = useCallback(
    (value: string) => {
      setForm((prev) => {
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
      })
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
      setForm((prev) => {
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
      })
      writeVehicleModePreference(activeWorkspaceId, mode)
    },
    [activeWorkspaceId]
  )

  const dismissKeyboard = useCallback(() => {
    if (typeof document === "undefined") return

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }, [])

  async function processReceiptFile(file: File) {
    // Capture workspaceId once so the catch cleanup uses the same value as the writes.
    const workspaceId = activeWorkspaceId
    if (!workspaceId) return
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    const isAllowed =
      ALLOWED_TYPES.includes(file.type.toLowerCase()) ||
      /\.(jpe?g|png|webp|heic)$/i.test(file.name)
    if (!isAllowed) {
      setReceiptError("Unsupported file type. Please use JPEG, PNG, WebP, or HEIC.")
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      setReceiptError("Image is too large. Please use an image under 30 MB.")
      return
    }

    setReceiptUploading(true)
    setReceiptError(null)

    // Tracks whether the Firestore record was written so the catch can delete it
    // if the subsequent GCS upload fails (partial-failure cleanup).
    let createdAssetId: string | null = null

    try {
      let decoded = await loadReceiptImage(file)
      decoded = await normalizeExifOrientation(file, decoded)

      const quality = await analyzeReceiptImageQuality(file, decoded)
      if (quality.qualityStatus === "bad") {
        throw new Error(quality.warnings[0] || "This image is too blurry or unclear. Please retake the photo.")
      }

      const assetId = `receipt-${crypto.randomUUID?.() ?? Date.now()}`
      const uploadFile = await prepareReceiptUploadFile(file, decoded)
      decoded.close()

      const originalPath = buildClientReceiptStoragePath(workspaceId, assetId, file.name)
      const previewPath = buildClientReceiptDerivedPath(workspaceId, assetId, "preview")
      const thumbPath = buildClientReceiptDerivedPath(workspaceId, assetId, "thumb")

      await Promise.all([
        createReceiptAsset(workspaceId, {
          id: assetId,
          fileName: file.name,
          mimeType: uploadFile.type || "image/jpeg",
          sizeBytes: uploadFile.size,
          captureSource: "upload",
          quality: quality.quality,
          blurScore: quality.blurScore,
          glareScore: quality.glareScore,
          qualityStatus: quality.qualityStatus,
          qualityWarnings: quality.warnings,
          width: quality.width,
          height: quality.height,
        }).then(() => { createdAssetId = assetId }),
        uploadReceiptAssetToStorage(uploadFile, originalPath, { resolveDownloadUrl: false }),
      ])

      // Render and upload preview (max 1400 px) and thumbnail (max 320 px / 120 KB)
      // in the background — the user can already see the form by this point.
      void Promise.all([
        prepareReceiptPreviewFile(file),
        prepareReceiptThumbnailFile(file),
      ]).then(([previewFile, thumbFile]) =>
        Promise.all([
          uploadReceiptAssetToStorage(previewFile, previewPath, { resolveDownloadUrl: false }),
          uploadReceiptAssetToStorage(thumbFile, thumbPath, { resolveDownloadUrl: false }),
        ])
      ).catch(() => {
        // Non-fatal — previews/thumbnails are a display optimisation.
        // The full-resolution original is already uploaded and usable.
      })

      const asset: ReceiptAsset = {
        id: assetId,
        fileName: file.name,
        mimeType: uploadFile.type || "image/jpeg",
        sizeBytes: uploadFile.size,
        version: 1,
        originalStoragePath: originalPath,
        storagePath: originalPath,
        previewStoragePath: previewPath,
        thumbnailStoragePath: thumbPath,
        captureSource: "upload",
        qualityStatus: quality.qualityStatus,
        qualityWarnings: quality.warnings,
        dataUrl: URL.createObjectURL(file),
      }
      setAttachedReceiptAsset(asset)
    } catch (err) {
      // If the Firestore record was written but the GCS upload (or anything after)
      // failed, delete the record so it doesn't become a permanent orphan.
      if (createdAssetId !== null) {
        void deleteReceiptAsset(workspaceId, createdAssetId).catch(() => {})
      }
      setReceiptError(err instanceof Error ? err.message : "Failed to attach receipt.")
    } finally {
      setReceiptUploading(false)
    }
  }

  async function handleReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    await processReceiptFile(file)
    event.target.value = ""
  }

  async function handleNativeReceiptCapture(source: "camera" | "photos") {
    try {
      const file = await captureReceiptImage(source)
      if (file) await processReceiptFile(file)
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Unable to open camera.")
    }
  }

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
        throw new Error("Add business miles, fuel, or parking and tolls.")
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
        fuel: fuelAmount > 0 ? fuelAmount : undefined,
        parkingAndTolls:
          parkingAndTollsAmount > 0 ? parkingAndTollsAmount : undefined,
        receiptAssetId: attachedReceiptAsset?.id,
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
    }
  }, [
    attachedReceiptAsset,
    businessMiles,
    calculatedVehicleAmount,
    customExpenseCategories,
    form,
    fuelAmount,
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

      if (!activeWorkspaceId) {
        alert("No active workspace selected.")
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
        const createExpensePromise = expensesService.createExpense(
          activeWorkspaceId,
          validated
        )

        setForm(createEmptyFormState(form.vehicle.mode))
        setVendorFocused(false)
        setDescriptionFocused(false)
        setExpanded(false)
        dismissKeyboard()
        setAttachedReceiptAsset(null)
        setReceiptError(null)
        setSubmitting(false)

        void createExpensePromise
          .then(() => {
            updateFromExpense({
              vendor: validated.vendor,
              description: validated.description,
              account: validated.account,
            })
          })
          .catch(() => {
            setExpanded(true)
            setForm((current) => (isFreshFormState(current) ? submittedForm : current))
            alert("Failed to save expense. Please try again.")
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
      dismissKeyboard,
      form,
      submitting,
      updateFromExpense,
    ]
  )

  if (workspaceState.status !== "ready") {
    return (
      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5">
          <div className="flex items-center gap-2">
            <CardTitle>Add Expense</CardTitle>
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

  return (
    <Card className={expanded ? "gap-6 py-6" : "gap-0 py-4"}>
      <CardHeader
        className={`flex flex-row items-center justify-between space-y-0 ${
          expanded ? "" : "px-5"
        }`}
      >
        <div className="flex items-center gap-2">
          <CardTitle>Add Expense</CardTitle>
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

      {!expanded ? (
        <CardContent className="px-5 pt-0 pb-0" />
      ) : (
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                data-stackin-date-input="true"
                value={form.date}
                onChange={(event) => updateDate(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="account-trigger">Category</Label>
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
              />

              <p className="text-xs text-muted-foreground">
                Choose from built-in or saved custom expense categories.
              </p>
            </div>

            {isVehicleCategorySelected ? (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
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
                    variant="outline"
                    className="grid w-full grid-cols-2"
                    aria-label="Vehicle expense mode"
                  >
                    <ToggleGroupItem value="mileage" className="w-full">
                      Mileage
                    </ToggleGroupItem>
                    <ToggleGroupItem value="direct_expense" className="w-full">
                      Direct Expense
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {isVehicleMileageMode ? (
                  <>
                    <div className="relative">
                      <VendorLabel htmlFor="vehicleMileageVendor" optional />
                      <Input
                        id="vehicleMileageVendor"
                        type="text"
                        value={form.vehicle.mileage.vendor}
                        onChange={(event) =>
                          updateVehicleMileageField("vendor", event.target.value)
                        }
                        onFocus={() => setVendorFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setVendorFocused(false), 100)
                        }}
                        autoComplete="off"
                      />
                      {vendorSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                          {vendorSuggestions.map((vendor) => (
                            <button
                              key={vendor}
                              type="button"
                              className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleMileageField("vendor", vendor)
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
                        <Label htmlFor="businessMiles">Business Miles</Label>
                        <Input
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
                        <Label htmlFor="fuel">Fuel</Label>
                        <Input
                          id="fuel"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={form.vehicle.mileage.fuel}
                          onChange={(event) =>
                            updateVehicleMileageField("fuel", event.target.value)
                          }
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <Label htmlFor="parkingAndTolls">Parking & Tolls</Label>
                        <Input
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

                    <div className="space-y-2 rounded-md border border-border bg-card px-3 py-3 text-sm">
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
                      <Label htmlFor="vehicleMileageAmount">Amount</Label>
                      <Input
                        id="vehicleMileageAmount"
                        type="number"
                        step="0.01"
                        value={calculatedVehicleAmount.toFixed(2)}
                        readOnly
                        aria-readonly="true"
                      />
                    </div>

                    <div className="relative">
                      <Label htmlFor="vehicleMileageDescription">Description</Label>
                      <Input
                        id="vehicleMileageDescription"
                        type="text"
                        value={form.vehicle.mileage.description}
                        onChange={(event) =>
                          updateVehicleMileageField("description", event.target.value)
                        }
                        onFocus={() => setDescriptionFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setDescriptionFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {descriptionSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                          {descriptionSuggestions.map((description) => (
                            <button
                              key={description}
                              type="button"
                              className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleMileageField("description", description)
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
                        id="vehicleDirectVendor"
                        type="text"
                        value={form.vehicle.directExpense.vendor}
                        onChange={(event) =>
                          updateVehicleDirectField("vendor", event.target.value)
                        }
                        onFocus={() => setVendorFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setVendorFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {vendorSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                          {vendorSuggestions.map((vendor) => (
                            <button
                              key={vendor}
                              type="button"
                              className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleDirectField("vendor", vendor)
                              }}
                            >
                              {vendor}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <Label htmlFor="vehicleDirectAmount">Amount</Label>
                      <Input
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
                      <Label htmlFor="vehicleDirectDescription">Description</Label>
                      <Input
                        id="vehicleDirectDescription"
                        type="text"
                        value={form.vehicle.directExpense.description}
                        onChange={(event) =>
                          updateVehicleDirectField("description", event.target.value)
                        }
                        onFocus={() => setDescriptionFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setDescriptionFocused(false), 100)
                        }}
                        autoComplete="off"
                        required
                      />
                      {descriptionSuggestions.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                          {descriptionSuggestions.map((description) => (
                            <button
                              key={description}
                              type="button"
                              className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                              onMouseDown={(event) => {
                                event.preventDefault()
                                updateVehicleDirectField("description", description)
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
                <div>
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={form.generic.amount}
                    onChange={(event) =>
                      updateGenericField("amount", event.target.value)
                    }
                    required
                  />
                </div>

                <div className="relative">
                  <VendorLabel htmlFor="vendor" />
                  <Input
                    id="vendor"
                    type="text"
                    value={form.generic.vendor}
                    onChange={(event) =>
                      updateGenericField("vendor", event.target.value)
                    }
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setVendorFocused(false), 100)
                    }}
                    autoComplete="off"
                    required
                  />
                  {vendorSuggestions.length > 0 ? (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                      {vendorSuggestions.map((vendor) => (
                        <button
                          key={vendor}
                          type="button"
                          className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            updateGenericField("vendor", vendor)
                          }}
                        >
                          {vendor}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    type="text"
                    value={form.generic.description}
                    onChange={(event) =>
                      updateGenericField("description", event.target.value)
                    }
                    onFocus={() => setDescriptionFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setDescriptionFocused(false), 100)
                    }}
                    autoComplete="off"
                    required
                  />
                  {descriptionSuggestions.length > 0 ? (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                      {descriptionSuggestions.map((description) => (
                        <button
                          key={description}
                          type="button"
                          className="block w-full px-3 py-1 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            updateGenericField("description", description)
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

            {/* Receipt attachment */}
            <div className="space-y-2 rounded-xl border border-dashed border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Attach Receipt
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(Optional)</span>
                </span>
              </div>

              {attachedReceiptAsset ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  {attachedReceiptAsset.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachedReceiptAsset.dataUrl}
                      alt="Receipt preview"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {attachedReceiptAsset.fileName}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      if (attachedReceiptAsset.dataUrl?.startsWith("blob:")) {
                        URL.revokeObjectURL(attachedReceiptAsset.dataUrl)
                      }
                      setAttachedReceiptAsset(null)
                      setReceiptError(null)
                    }}
                    aria-label="Remove receipt"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : receiptUploading ? (
                <p className="text-sm text-muted-foreground">Uploading receipt...</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={receiptFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleReceiptFileChange}
                  />
                  {isNativeCamera ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleNativeReceiptCapture("camera")}
                    >
                      <Camera className="h-4 w-4" />
                      Camera
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      isNativeCamera
                        ? void handleNativeReceiptCapture("photos")
                        : receiptFileInputRef.current?.click()
                    }
                  >
                    <ImagePlus className="h-4 w-4" />
                    Choose Image
                  </Button>
                </div>
              )}

              {receiptError ? (
                <p className="text-xs text-destructive">{receiptError}</p>
              ) : null}
            </div>

            <Button type="submit" disabled={submitting || receiptUploading} className="w-full">
              {submitting ? "Saving..." : "Add Expense"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
