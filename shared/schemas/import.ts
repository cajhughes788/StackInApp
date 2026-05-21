import { z } from "zod"

import { IncomeCategorySchema } from "./entry"
import { ReceiptDuplicateSignalsSchema } from "./receiptAnalysis"

const IMPORT_SOURCE_VALUES = [
  "venmo_csv",
  "stripe_csv",
  "square_csv",
  "bank_csv",
  "apple_pay_csv",
  "manual_import",
] as const

const LEGACY_IMPORT_SOURCE_ALIASES = {
  venmo: "venmo_csv",
  stripe: "stripe_csv",
  square: "square_csv",
  bank: "bank_csv",
  apple_pay: "apple_pay_csv",
  applepay: "apple_pay_csv",
  manual: "manual_import",
} as const satisfies Record<string, (typeof IMPORT_SOURCE_VALUES)[number]>

export function normalizeImportSource(value: unknown): unknown {
  if (typeof value !== "string") return value

  const normalized = value.trim().toLowerCase()
  return LEGACY_IMPORT_SOURCE_ALIASES[normalized as keyof typeof LEGACY_IMPORT_SOURCE_ALIASES]
    ?? normalized
}

export const ImportSourceSchema = z.preprocess(
  normalizeImportSource,
  z.enum(IMPORT_SOURCE_VALUES)
)

export const ImportItemKindSchema = z.enum(["income", "expense", "unknown"])

export const ImportItemStatusSchema = z.enum([
  "pending",
  "needs_review",
  "accepted",
  "rejected",
  "committed",
])

export const ImportBatchStatusSchema = z.enum([
  "pending",
  "in_review",
  "completed",
  "archived",
])

const UnknownRecordSchema = z.record(z.string(), z.unknown())

export const ImportUserDecisionSchema = z.object({
  isBusiness: z.boolean().nullable().default(null),
  finalKind: ImportItemKindSchema.nullable().default(null),
})

export const ImportCompletionSchema = z.object({
  missingFields: z.array(z.string()).default([]),
  readyToCommit: z.boolean().default(false),
})

export const ImportBatchInputSchema = z.object({
  source: ImportSourceSchema,
  label: z.string().trim().min(1),
  fileName: z.string().trim().min(1).optional(),
  status: ImportBatchStatusSchema.optional(),
  notes: z.string().trim().optional(),
})

export const ImportItemInputSchema = z.object({
  kind: ImportItemKindSchema.default("unknown"),
  source: ImportSourceSchema,
  status: ImportItemStatusSchema.optional(),
  importedAt: z.string().optional(),
  occurredAt: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().nullable().optional(),
  counterparty: z.string().trim().nullable().optional(),
  rawRow: UnknownRecordSchema.default({}),
  parseWarnings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  suggestedDirection: ImportItemKindSchema.nullable().optional(),
  suggestedIncomeCategory: IncomeCategorySchema.nullable().optional(),
  suggestedExpenseAccount: z.string().trim().nullable().optional(),
  userDecision: ImportUserDecisionSchema.optional(),
  completion: ImportCompletionSchema.optional(),
  notes: z.string().trim().optional(),
  duplicateSignals: ReceiptDuplicateSignalsSchema.optional(),
})

export const CreateImportBatchSchema = z.object({
  batch: ImportBatchInputSchema,
  items: z.array(ImportItemInputSchema).default([]),
})

export const ImportBatchSchema = ImportBatchInputSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  itemCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  committedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ImportItemSchema = ImportItemInputSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  batchId: z.string(),
  importedAt: z.string(),
  userDecision: ImportUserDecisionSchema.default({
    isBusiness: null,
    finalKind: null,
  }),
  completion: ImportCompletionSchema.default({
    missingFields: [],
    readyToCommit: false,
  }),
  committedEntryId: z.string().optional(),
  committedExpenseId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
})

export const ImportItemPatchSchema = z
  .object({
    status: ImportItemStatusSchema.optional(),
    amount: z.number().nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    currency: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().nullable().optional(),
    counterparty: z.string().trim().nullable().optional(),
    parseWarnings: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    suggestedDirection: ImportItemKindSchema.nullable().optional(),
    suggestedIncomeCategory: IncomeCategorySchema.nullable().optional(),
    suggestedExpenseAccount: z.string().trim().nullable().optional(),
    userDecision: ImportUserDecisionSchema.partial().optional(),
    completion: ImportCompletionSchema.partial().optional(),
    notes: z.string().trim().optional(),
    committedEntryId: z.string().optional(),
    committedExpenseId: z.string().optional(),
    duplicateSignals: ReceiptDuplicateSignalsSchema.optional(),
  })
  .strict()

export type ImportSource = z.infer<typeof ImportSourceSchema>
export type ImportItemKind = z.infer<typeof ImportItemKindSchema>
export type ImportItemStatus = z.infer<typeof ImportItemStatusSchema>
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>
export type ImportBatchInput = z.infer<typeof ImportBatchInputSchema>
export type ImportItemInput = z.infer<typeof ImportItemInputSchema>
export type CreateImportBatchInput = z.infer<typeof CreateImportBatchSchema>
export type ImportBatch = z.infer<typeof ImportBatchSchema>
export type ImportItem = z.infer<typeof ImportItemSchema>
export type ImportItemPatch = z.infer<typeof ImportItemPatchSchema>
