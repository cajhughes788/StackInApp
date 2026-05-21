// /shared/schemas/paystub.ts
// ---------------------------------------------------------
// Pay Stub Domain Schema
// Derived from entries, settings, and tax profile data.
// ---------------------------------------------------------

import { z } from "zod"
import { EntrySchema as EntrySchema } from "./entry"
import { SettingsDocSchema as SettingsSchema } from "./settings"
import { Schema as TaxProfileSchema } from "./taxProfile"

/**
 * Pay Stub Input Schema
 * Used for new pay stub creation before persistence.
 */
export const Input = z.object({
  uid: z.string(),
  periodId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  grossIncome: z.number(),
  netIncome: z.number(),
  breakdown: z.record(z.string(), z.number()),
  totalUnreported: z.number().optional(),

  ytdTotals: z
    .object({
      grossIncome: z.number(),
      netIncome: z.number(),
      totalDeductions: z.number(),
      tips: z.number(),
      reportedCash: z.number(),
      unreportedCash: z.number(),
    })
    .optional(),
})

/**
 * Full persisted schema
 * Includes embedded entry, settings, and tax profile data.
 */
export const Schema = Input.extend({
  createdAt: z.union([z.string(), z.date()]).default(new Date().toISOString()),
  updatedAt: z.union([z.string(), z.date()]).optional(),

  // Embedded sub-schemas
  entries: z.array(EntrySchema),
  settings: SettingsSchema,
  taxProfile: TaxProfileSchema.nullable().optional(),
})

// Inferred Types
export type InputType = z.infer<typeof Input>
export type Type = z.infer<typeof Schema>
