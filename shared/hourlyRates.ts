// /shared/hourlyRates.ts
// ------------------------------------------------------------
// W-2 job positions / hourly rates.
// Settings hold a default rate plus optional additionalRates; each entry
// snapshots the rate it was paid at (w2.rate) along with positionId and
// positionTitle. Labels always come from the entry's own snapshot so that
// renaming, re-pricing or deleting a position never rewrites history.
// ------------------------------------------------------------

export const DEFAULT_RATE_TITLE = "Default"
export const CUSTOM_POSITION_ID = "custom"
export const CUSTOM_POSITION_TITLE = "Custom"

type RateSettings = {
  w2?: {
    defaultHourlyRate?: number
    defaultRateTitle?: string
    additionalRates?: { id: string; title: string; rate: number }[]
  }
} | null | undefined

export type RateOption = {
  /** null = the default rate */
  id: string | null
  title: string
  rate: number
}

export function getDefaultRateTitle(settings: RateSettings): string {
  return settings?.w2?.defaultRateTitle?.trim() || DEFAULT_RATE_TITLE
}

/** Default first, then additional rates with a usable title. */
export function getRateOptions(settings: RateSettings): RateOption[] {
  const options: RateOption[] = [{
    id: null,
    title: getDefaultRateTitle(settings),
    rate: settings?.w2?.defaultHourlyRate ?? 0,
  }]
  for (const r of settings?.w2?.additionalRates ?? []) {
    const title = r.title?.trim()
    if (title) options.push({ id: r.id, title, rate: r.rate })
  }
  return options
}

/** The position label an entry was recorded under. Entries saved before
 * positions existed (no positionId/positionTitle) count as the default. */
export function getEntryPositionTitle(
  w2: { positionId?: string | null; positionTitle?: string | null } | null | undefined,
  settings?: RateSettings
): string {
  const snapshot = w2?.positionTitle?.trim()
  if (snapshot) return snapshot
  if (w2?.positionId === CUSTOM_POSITION_ID) return CUSTOM_POSITION_TITLE
  return getDefaultRateTitle(settings)
}
