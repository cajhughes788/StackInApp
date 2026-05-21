import { z } from "zod"

export const ReceiptAnalysisStatusSchema = z.enum([
  "queued",
  "analyzing",
  "analysis_complete_draft_pending",
  "succeeded",
  "failed",
])

export const ReceiptAnalysisProviderSchema = z.enum(["aws_textract"])

export const ReceiptLineItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  amount: z.number().nonnegative().optional(),
  category: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const ReceiptAllocationSchema = z.object({
  category: z.string().trim().min(1),
  amount: z.number().nonnegative(),
  lineItemIndexes: z.array(z.number().int().nonnegative()).default([]),
})

export const ReceiptDuplicateSignalsSchema = z.object({
  matchedExpenseId: z.string().trim().min(1).optional(),
  score: z.number().min(0).max(1).optional(),
})

export const ReceiptFieldConfidenceSchema = z.record(
  z.string(),
  z.number().min(0).max(1)
)

export const ReceiptAnalysisSchema = z.object({
  id: z.string(),
  workspaceId: z.string().trim().min(1),
  receiptAssetId: z.string().trim().min(1),
  provider: ReceiptAnalysisProviderSchema,
  providerVersion: z.string().trim().min(1).optional(),
  status: ReceiptAnalysisStatusSchema,
  summaryFieldsRaw: z.unknown().optional(),
  lineItemsRaw: z.unknown().optional(),
  normalized: z.record(z.string(), z.unknown()).optional(),
  merchant: z.string().trim().nullable().optional(),
  receiptDate: z.string().nullable().optional(),
  subtotal: z.number().nonnegative().nullable().optional(),
  tax: z.number().nonnegative().nullable().optional(),
  tip: z.number().nonnegative().nullable().optional(),
  total: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().nullable().optional(),
  lineItems: z.array(ReceiptLineItemSchema).default([]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  fieldConfidence: ReceiptFieldConfidenceSchema.optional(),
  error: z.string().trim().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ReceiptAnalysisStatus = z.infer<typeof ReceiptAnalysisStatusSchema>
export type ReceiptLineItem = z.infer<typeof ReceiptLineItemSchema>
export type ReceiptAllocation = z.infer<typeof ReceiptAllocationSchema>
export type ReceiptDuplicateSignals = z.infer<typeof ReceiptDuplicateSignalsSchema>
export type ReceiptFieldConfidence = z.infer<typeof ReceiptFieldConfidenceSchema>
export type ReceiptAnalysis = z.infer<typeof ReceiptAnalysisSchema>
