export const BUSINESS_MILEAGE_RATES_BY_YEAR: Record<number, number> = {
  2024: 0.67,
  2025: 0.7,
  2026: 0.725,
}

export function getBusinessMileageRate(dateInput: string | Date): number {
  const date =
    dateInput instanceof Date ? dateInput : new Date(`${dateInput}T12:00:00`)
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear()

  return (
    BUSINESS_MILEAGE_RATES_BY_YEAR[year] ??
    BUSINESS_MILEAGE_RATES_BY_YEAR[Math.max(...Object.keys(BUSINESS_MILEAGE_RATES_BY_YEAR).map(Number))]
  )
}

export function calculateStandardMileageAmount(
  milesDriven: number,
  rate: number,
  parkingAndTolls = 0
): number {
  const miles = Number.isFinite(milesDriven) ? milesDriven : 0
  const extras = Number.isFinite(parkingAndTolls) ? parkingAndTolls : 0
  return Math.round((miles * rate + extras) * 100) / 100
}
