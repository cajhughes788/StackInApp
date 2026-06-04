import { z } from "zod"

import { VEHICLE_EXPENSE_MODES } from "../vehicleExpenses"

// -------------------------------------------------------------
// ExpenseInput
// Full user-facing shape. All 5 fields are REQUIRED.
// -------------------------------------------------------------
const VALID_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

// Regex catches format. This catches impossible dates the regex still accepts:
// Feb 31, Apr 31, Nov 31, etc. Uses local Date constructor with explicit parts
// so it works identically in Node and all browsers.
function isCalendarDate(val: string): boolean {
  const parts = val.split("-")
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1 // 0-indexed for Date constructor
  const day = parseInt(parts[2], 10)
  const d = new Date(year, month, day)
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
}

export const ExpenseInput = z.object({
  date: z.string()
    .regex(VALID_DATE_RE, "Date must be in YYYY-MM-DD format")
    .refine(isCalendarDate, "Date is not a valid calendar date (e.g. Feb 31 does not exist)"),
  amount: z.number(),         // expense amount
  vendor: z.string(),         // who was paid
  description: z.string(),    // what the expense was for
  account: z.string(),        // category (Supplies, Fuel, Rent, etc.)
  periodId: z.string(),       // extracted from date YYYY-MM
  clientMutationId: z.string().optional(),
  receiptAssetId: z.string().optional(),
  receiptAnalysisId: z.string().optional(),
  allocations: z
    .array(
      z.object({
        category: z.string(),
        amount: z.number().nonnegative(),
        lineItemIndexes: z.array(z.number().int().nonnegative()).default([]).optional(),
      })
    )
    .optional(),
  calculationMethod: z
    .enum(["manual", "standard_mileage", "vehicle_mileage"])
    .optional(),
  vehicleExpenseMode: z.enum(VEHICLE_EXPENSE_MODES).optional(),
  businessMiles: z.number().nonnegative().optional(),
  milesDriven: z.number().nonnegative().optional(),
  mileageRate: z.number().nonnegative().optional(),
  fuel: z.number().nonnegative().optional(),
  parkingAndTolls: z.number().nonnegative().optional(),
  // Audit trail — answers "was this OCR-created or manually entered?" at any
  // future point without needing to trace through draft or analysis records.
  createdFromReceipt: z.boolean().optional(),
  receiptDraftId: z.string().optional(),
  ocrProvider: z.enum(["aws_textract", "tesseract_local"]).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
})

// -------------------------------------------------------------
// ExpensePatch
// Partial update version of ExpenseInput.
// Used for PATCH routes (identical pattern to SettingsPatch).
// -------------------------------------------------------------
export const ExpensePatch = ExpenseInput.partial().strict()

// -------------------------------------------------------------
// ExpenseSchema (Canonical Firestore Document)
// Backend will:
//  - inject id
//  - inject createdAt (ISO string)
//  - inject updatedAt (ISO string)
//  - increment version each mutation
//
// This follows the same structure as EntrySchema & SettingsSchema.
// -------------------------------------------------------------
export const ExpenseSchema = ExpenseInput.extend({
  id: z.string(),
  createdAt: z.string(),     // ISO timestamp from backend
  updatedAt: z.string(),     // ISO timestamp from backend
  version: z.number(),       // incrementing integer
})

// -------------------------------------------------------------
// Types
// -------------------------------------------------------------
export type ExpenseInputType = z.infer<typeof ExpenseInput>
export type ExpensePatchType = z.infer<typeof ExpensePatch>
export type ExpenseType = z.infer<typeof ExpenseSchema>
