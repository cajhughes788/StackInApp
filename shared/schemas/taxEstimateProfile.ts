import { z } from "zod"

// -------------------------------------------------------------
// The person's answers for the self-employed tax estimate
// (shared/estimatedTax). Per person, not per workspace — taxes are filed
// per person. Firestore: users/{uid}/taxEstimate/profile
//
// Every answer starts null ("not answered yet"), which the data-health
// check treats differently from an answer of "no". The year-specific
// fields (start date, withholding, payments) belong to `taxYear` and are
// cleared when a new year begins.
// -------------------------------------------------------------

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
const Money = z.number().finite().nonnegative()

export const TaxFilingStatusSchema = z.enum(["single", "marriedJoint", "marriedSeparate", "headOfHousehold"])

export const TaxEstimateProfileSchema = z.object({
  taxYear: z.number().int(),
  filingStatus: TaxFilingStatusSchema.nullable().default(null),
  qualifyingChildren: z.number().int().min(0).max(20).nullable().default(null),
  spouseHasIncome: z.boolean().nullable().default(null),
  investmentOrRentalIncome: z.boolean().nullable().default(null),
  itemizesDeductions: z.boolean().nullable().default(null),
  // Two-letter state of residence (shared/estimatedTax/states).
  stateCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  // Treasury Tipped Occupation Code (shared/estimatedTax/tippedOccupations),
  // "none", or null when not answered — for the "no tax on tips" deduction.
  occupationCode: z.string().max(10).nullable().default(null),
  // Only when the business started after Jan 1 of taxYear.
  businessStartDate: DateSchema.nullable().default(null),
  // From last year's return (Form 1040 total tax and AGI).
  priorYearTax: Money.nullable().default(null),
  priorYearAgi: z.number().finite().nullable().default(null),
  // Optional, with W-2 pay: federal tax withheld so far from a real pay
  // stub. Entered → the whole return less withholding; blank → the
  // business's share, assuming the job withholds its own tax (quarterly.ts).
  ytdWithholding: Money.nullable().default(null),
  withholdingAsOf: DateSchema.nullable().default(null),
  // W-2 income. With a W-2 workspace in 521: "Is all of your W-2 income
  // recorded in 521?" (w2AllRecorded). Without one: "Do you have a W-2
  // job?" (hasW2Job). Either way, pay not in 521 is a yearly amount
  // (unrecordedW2Pay). w2WorkspaceKey is the person's W-2 workspaces when
  // they answered — a change asks again (taxEstimateService).
  w2AllRecorded: z.boolean().nullable().default(null),
  hasW2Job: z.boolean().nullable().default(null),
  unrecordedW2Pay: Money.nullable().default(null),
  // How much of that unrecorded pay is tips reported to the employer.
  unrecordedW2Tips: Money.nullable().default(null),
  // The W-2 job's line of work, for its tips — what the employer reports in
  // W-2 Box 14b. "none" = not on the list, or the employer reports "000".
  w2OccupationCode: z.string().max(10).nullable().default(null),
  w2WorkspaceKey: z.string().nullable().default(null),
  // "I've answered every question for my whole tax return and recorded all
  // my income in 521" — ticked on every save of the answers form.
  confirmedComplete: z.boolean().default(false),
  // Legacy single "paid so far" figure from before the payment log; moved
  // into the log as one carried-over payment (see taxEstimateService).
  estimatedPaymentsMade: Money.default(0),
  // Push reminders before each due date (sendTaxRemindersDaily).
  remindersEnabled: z.boolean().default(true),
  // `${dueDate}:${kind}` of the last reminder sent — a retry never sends twice.
  lastReminderKey: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
})

export const TaxEstimateProfilePatchSchema = TaxEstimateProfileSchema.omit({ taxYear: true, updatedAt: true, lastReminderKey: true })
  .partial()
  .strict()

export type TaxEstimateProfile = z.infer<typeof TaxEstimateProfileSchema>
export type TaxEstimateProfilePatch = z.infer<typeof TaxEstimateProfilePatchSchema>

export function emptyTaxEstimateProfile(taxYear: number): TaxEstimateProfile {
  return TaxEstimateProfileSchema.parse({ taxYear })
}

/** A saved profile from an earlier year: keep the person's situation and
 * last year's figures' slots, drop what only applied to that year. */
export function rollTaxEstimateProfileToYear(profile: TaxEstimateProfile, taxYear: number): TaxEstimateProfile {
  if (profile.taxYear === taxYear) return profile
  return {
    ...profile,
    taxYear,
    businessStartDate: null,
    // Last year's return figures change every year — ask again.
    priorYearTax: null,
    priorYearAgi: null,
    ytdWithholding: null,
    withholdingAsOf: null,
    estimatedPaymentsMade: 0,
    // A new year: confirm W-2 income and completeness again.
    w2AllRecorded: null,
    hasW2Job: null,
    unrecordedW2Pay: null,
    unrecordedW2Tips: null,
    w2WorkspaceKey: null,
    confirmedComplete: false,
  }
}

// -------------------------------------------------------------
// Estimated tax payments the person has sent to the IRS.
// Firestore: users/{uid}/taxPayments/{paymentId}
// -------------------------------------------------------------
export const TaxPaymentSchema = z.object({
  id: z.string(),
  taxYear: z.number().int(),
  amount: z.number().finite().positive(),
  paidOn: DateSchema,
  // "carried_over": the old single "paid so far" answer, moved into the log.
  source: z.enum(["manual", "carried_over"]).default("manual"),
  createdAt: z.string(),
})

export const TaxPaymentInputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(), // present = edit
    amount: z.number().finite().positive().max(10_000_000),
    paidOn: DateSchema,
  })
  .strict()

export type TaxPayment = z.infer<typeof TaxPaymentSchema>
export type TaxPaymentInput = z.infer<typeof TaxPaymentInputSchema>
