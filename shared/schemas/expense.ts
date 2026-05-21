import { z } from "zod"

// -------------------------------------------------------------
// ExpenseInput
// Full user-facing shape. All 5 fields are REQUIRED.
// -------------------------------------------------------------
export const ExpenseInput = z.object({
  date: z.string(),           // YYYY-MM-DD
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
  calculationMethod: z.enum(["manual", "standard_mileage"]).optional(),
  milesDriven: z.number().nonnegative().optional(),
  mileageRate: z.number().nonnegative().optional(),
  parkingAndTolls: z.number().nonnegative().optional(),
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
