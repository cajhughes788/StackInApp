import { z } from "zod"

import { ReceiptAssetSchema } from "./receiptAsset"
import {
  ReceiptAllocationSchema,
  ReceiptAnalysisStatusSchema,
  ReceiptFieldConfidenceSchema,
  ReceiptLineItemSchema,
} from "./receiptAnalysis"

export const ReceiptDraftStatusSchema = z.enum([
  "draft",
  "ready_to_review",
  "committed",
  "dismissed",
])

export const ReceiptDraftAllocationModeSchema = z.enum([
  "single",
  "multiple",
])

export const ReceiptDraftCompletionSchema = z.object({
  missingFields: z.array(z.string()).default([]),
  readyToCommit: z.boolean().default(false),
})

export const ReceiptDraftInputSchema = z.object({
  status: ReceiptDraftStatusSchema.optional(),
  occurredAt: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  tip: z.number().nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().nullable().optional(),
  counterparty: z.string().trim().nullable().optional(),
  parseWarnings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  suggestedExpenseAccount: z.string().trim().nullable().optional(),
  allocationMode: ReceiptDraftAllocationModeSchema.optional(),
  completion: ReceiptDraftCompletionSchema.optional(),
  notes: z.string().trim().optional(),
  receiptAssetId: z.string().trim().min(1),
  receiptAnalysisId: z.string().trim().optional(),
  analysisStatus: ReceiptAnalysisStatusSchema.optional(),
  receiptAsset: ReceiptAssetSchema.optional(),
  lineItems: z.array(ReceiptLineItemSchema).optional(),
  allocations: z.array(ReceiptAllocationSchema).optional(),
  fieldConfidence: ReceiptFieldConfidenceSchema.optional(),
  committedExpenseId: z.string().trim().optional(),
})

export const ReceiptDraftSchema = ReceiptDraftInputSchema.extend({
  id: z.string(),
  workspaceId: z.string().trim().min(1),
  completion: ReceiptDraftCompletionSchema.default({
    missingFields: [],
    readyToCommit: false,
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
})

export const ReceiptDraftPatchSchema = z
  .object({
    status: ReceiptDraftStatusSchema.optional(),
    occurredAt: z.string().nullable().optional(),
    amount: z.number().nullable().optional(),
    subtotal: z.number().nullable().optional(),
    tax: z.number().nullable().optional(),
    tip: z.number().nullable().optional(),
    currency: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().nullable().optional(),
    counterparty: z.string().trim().nullable().optional(),
    parseWarnings: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    suggestedExpenseAccount: z.string().trim().nullable().optional(),
    allocationMode: ReceiptDraftAllocationModeSchema.optional(),
    completion: ReceiptDraftCompletionSchema.partial().optional(),
    notes: z.string().trim().optional(),
    receiptAnalysisId: z.string().trim().optional(),
    analysisStatus: ReceiptAnalysisStatusSchema.optional(),
    receiptAsset: ReceiptAssetSchema.optional(),
    lineItems: z.array(ReceiptLineItemSchema).optional(),
    allocations: z.array(ReceiptAllocationSchema).optional(),
    fieldConfidence: ReceiptFieldConfidenceSchema.optional(),
    committedExpenseId: z.string().trim().optional(),
  })
  .strict()

export type ReceiptDraftStatus = z.infer<typeof ReceiptDraftStatusSchema>
export type ReceiptDraftAllocationMode = z.infer<typeof ReceiptDraftAllocationModeSchema>
export type ReceiptDraftCompletion = z.infer<typeof ReceiptDraftCompletionSchema>
export type ReceiptDraftInput = z.infer<typeof ReceiptDraftInputSchema>
export type ReceiptDraft = z.infer<typeof ReceiptDraftSchema>
export type ReceiptDraftPatch = z.infer<typeof ReceiptDraftPatchSchema>
