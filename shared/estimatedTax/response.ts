// /shared/estimatedTax/response.ts
// What getTaxEstimate returns to the app.
import type { TaxEstimateProfile, TaxPayment } from "../schemas/taxEstimateProfile"
import type { DataHealthResult } from "./dataHealth"
import type { QuarterlyResult } from "./quarterly"

export type TaxEstimateResponse =
  | { eligible: false; reason: "no_business_workspace" }
  | {
      eligible: true
      taxYear: number
      profile: TaxEstimateProfile
      health: DataHealthResult
      // Null when there's nothing safe to show (no year table, or no filing
      // status yet). Show its parts only as `health` allows.
      quarterly: QuarterlyResult | null
      // Estimated payments recorded for taxYear, newest first.
      payments: TaxPayment[]
      // Profit this year so far, all business workspaces (for the card).
      ytdProfit: number
      // A W-2 workspace's paycheck tax profile state, to pre-fill the
      // state question. Null when the person already answered it.
      suggestedStateCode: string | null
      // Tips recorded this year so far (business income lines).
      ytdTips: number
      generatedAt: string
    }

/** The year whose estimate applies today. Until the Jan 15 due date, the
 * year just ended still has its Q4 payment due. */
export function taxYearForDate(today: string): number {
  const year = Number(today.slice(0, 4))
  return today.slice(5) <= "01-15" ? year - 1 : year
}
