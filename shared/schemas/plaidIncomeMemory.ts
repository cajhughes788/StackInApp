import { z } from "zod"
import { IncomeCategorySchema, PaymentMethodSchema } from "./entry"

// -------------------------------------------------------------
// PlaidIncomeMemory
// The income counterpart of PlaidMerchantMemory: learns from confirm/dismiss
// decisions on bank deposits (direction "income") so the next deposit from
// the same payer is pre-filled. Firestore path:
// workspaces/{workspaceId}/plaidIncomeMemory/{payerKey}
// (doc id = normalizePlaidPayerKey() output — see shared/plaidClassification.ts)
//
// Deliberately a separate collection from plaidMerchantMemory: the same
// descriptor often covers both directions (paying someone through Venmo vs.
// a Venmo cash-out), and a spending decision like "always personal" must
// never decide anything about incoming money.
// -------------------------------------------------------------
export const PlaidIncomeMemorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  payerKey: z.string(),
  displayName: z.string(),
  // The most recent decision — "income" pre-fills the next deposit with
  // incomeCategory/paymentMethod; "not_income" pre-fills nothing.
  lastOutcome: z.enum(["income", "not_income"]),
  incomeCategory: IncomeCategorySchema.nullable(),
  paymentMethod: PaymentMethodSchema.nullable(),
  // "always_not_income" is an explicit opt-in (offered once, after repeated
  // dismissals — see confirmPendingTransaction in plaidService.ts). Future
  // deposits from this payer are still recorded, just dismissed silently.
  mode: z.enum(["ask_every_time", "always_not_income"]),
  incomeCount: z.number().default(0),
  notIncomeCount: z.number().default(0),
  lastDecisionAt: z.string(),
  // Set when the "stop asking about this payer?" offer is shown, however the
  // user answers, so it's offered once per payer, ever.
  suggestedAlwaysNotIncomeAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PlaidIncomeMemoryType = z.infer<typeof PlaidIncomeMemorySchema>
