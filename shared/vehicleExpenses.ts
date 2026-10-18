import type { IndependentSettingsType } from "./schemas/settings"

export const VEHICLE_EXPENSE_CATEGORY_KEY = "vehicle_transportation" as const
export const VEHICLE_EXPENSE_CATEGORY_LABEL = "Vehicle & Transportation" as const

export const VEHICLE_EXPENSE_MODES = ["mileage", "direct_expense"] as const

export type VehicleExpenseMode = (typeof VEHICLE_EXPENSE_MODES)[number]

type VehicleDescriptionPart = {
  label: string
  value: number
}

export function isVehicleExpenseTrackingEnabled(
  settings?: Partial<IndependentSettingsType> | null
): boolean {
  if (typeof settings?.trackVehicleExpenses === "boolean") {
    return settings.trackVehicleExpenses
  }

  return settings?.trackBusinessMileage === true
}

// The standard mileage rate already covers gas and other operating costs, so
// only parking and tolls are added on top of miles × rate.
export function calculateVehicleExpenseAmount(
  businessMiles: number,
  mileageRate: number,
  parkingAndTolls = 0
): number {
  const miles = Number.isFinite(businessMiles) ? businessMiles : 0
  const rate = Number.isFinite(mileageRate) ? mileageRate : 0
  const extras = Number.isFinite(parkingAndTolls) ? parkingAndTolls : 0

  return Math.round((miles * rate + extras) * 100) / 100
}

export function buildVehicleMileageDescription(
  businessMiles: number,
  parkingAndTolls: number
): string {
  const parts: VehicleDescriptionPart[] = [
    { label: "Mileage", value: businessMiles },
    { label: "Parking & Tolls", value: parkingAndTolls },
  ]

  return parts
    .filter((part) => Number.isFinite(part.value) && part.value > 0)
    .map((part) => part.label)
    .join(" + ")
}

export function isVehicleTransportationCategory(value: string): boolean {
  return value.trim().toLowerCase() === VEHICLE_EXPENSE_CATEGORY_LABEL.toLowerCase()
}

export function getDefaultVehicleExpenseMode(
  settings?: Partial<IndependentSettingsType> | null
): VehicleExpenseMode {
  if (
    settings?.trackVehicleExpenses === undefined &&
    settings?.trackBusinessMileage === true
  ) {
    return "mileage"
  }

  return "direct_expense"
}
