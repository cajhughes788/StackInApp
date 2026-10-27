import { z } from "zod"
import { IncomeCategorySchema } from "./entry"

// -------------------------------------------------------------
// PayerMemory
// What the user decided about people who pay them through an app statement
// import (Venmo CSV; Cash App later): business or personal, and their usual
// income category. Firestore path:
// workspaces/{workspaceId}/payerMemory/{payerKey}
// (doc id = normalizeAppPayerKey() — see shared/plaidClassification.ts)
//
// Deliberately separate from plaidIncomeMemory, which keys bank deposit
// descriptors ("VENMO CASHOUT"), not the individual people behind them.
// Rules (shared/payerMemory.ts): nothing is sorted as business without the
// user choosing it; "always personal" is opt-in; removing a memory never
// changes past items.
// -------------------------------------------------------------
export const PayerMemorySourceSchema = z.enum(["venmo_csv", "cash_app_csv"])
export const PayerOutcomeSchema = z.enum(["business", "personal"])
export const PayerMemoryModeSchema = z.enum(["ask_every_time", "always_personal", "always_business"])

export const PayerMemorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  payerKey: z.string(),
  displayName: z.string(),
  source: PayerMemorySourceSchema,
  lastOutcome: PayerOutcomeSchema,
  // Category of the last business decision; pre-filled for always_business.
  incomeCategory: IncomeCategorySchema.nullable().default(null),
  mode: PayerMemoryModeSchema.default("ask_every_time"),
  businessCount: z.number().int().nonnegative().default(0),
  personalCount: z.number().int().nonnegative().default(0),
  lastDecisionAt: z.string(),
  // Set when "Always treat X as personal?" is offered, however it's
  // answered, so it's offered once per payer, ever.
  suggestedAlwaysPersonalAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PayerMemorySource = z.infer<typeof PayerMemorySourceSchema>
export type PayerOutcome = z.infer<typeof PayerOutcomeSchema>
export type PayerMemoryMode = z.infer<typeof PayerMemoryModeSchema>
export type PayerMemoryType = z.infer<typeof PayerMemorySchema>
