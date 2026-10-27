import { SettingsType } from "./schemas/settings"
import { isPosSalesSourceEnabled } from "./entryVisibility"

/* ------------------------------------------------------------
 * WHICH CSV IMPORTS A WORKSPACE IS OFFERED
 * The import panel on Home offers a CSV only for income sources this
 * person has turned on, in this order:
 *   - Venmo CSV          when Venmo is turned on
 *   - Square, Stripe CSV when Card / POS sales are turned on
 * Bank CSV isn't offered: there's no bank income source to turn on.
 * An empty list hides the panel.
 * ------------------------------------------------------------ */
export type CsvImportSource = "venmo_csv" | "square_csv" | "stripe_csv"

export function availableImportSources(
  settings: SettingsType["independent"] | null | undefined
): CsvImportSource[] {
  const sources: CsvImportSource[] = []
  if (settings?.enableVenmo === true) sources.push("venmo_csv")
  if (isPosSalesSourceEnabled(settings ?? undefined)) {
    sources.push("square_csv", "stripe_csv")
  }
  return sources
}
