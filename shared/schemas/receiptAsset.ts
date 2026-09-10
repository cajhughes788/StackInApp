import { z } from "zod"

export const ReceiptCaptureSourceSchema = z.enum(["camera", "gallery", "upload"])

export const ReceiptQualityStatusSchema = z.enum(["good", "warning", "bad"])

// Tracks the background image-bytes upload separately from the Firestore
// record itself — the record is created (and can be linked to an expense)
// before the bytes finish uploading, so this is how a later failure stays
// visible instead of silently leaving a doc with no image behind it.
// Absent/undefined means "complete" (all receipts created before this field
// existed uploaded synchronously, so they have no status to track).
export const ReceiptUploadStatusSchema = z.enum(["uploading", "complete", "failed"])

export const ReceiptAssetSchema = z.object({
  id: z.string(),
  workspaceId: z.string().trim().min(1).optional(),
  uploadedByUid: z.string().trim().min(1).optional(),
  version: z.number().int().positive().default(1),
  originalStoragePath: z.string().trim().min(1).optional(),
  previewStoragePath: z.string().trim().min(1).optional(),
  thumbnailStoragePath: z.string().trim().min(1).optional(),
  storagePath: z.string().trim().min(1).optional(),
  fileName: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  captureSource: ReceiptCaptureSourceSchema.optional(),
  quality: z.number().min(0).max(1).optional(),
  blurScore: z.number().min(0).max(1).optional(),
  glareScore: z.number().min(0).max(1).optional(),
  qualityStatus: ReceiptQualityStatusSchema.optional(),
  qualityWarnings: z.array(z.string()).default([]),
  uploadStatus: ReceiptUploadStatusSchema.optional(),
  dataUrl: z.string().trim().min(1).optional(),
  imageHash: z.string().trim().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type ReceiptCaptureSource = z.infer<typeof ReceiptCaptureSourceSchema>
export type ReceiptQualityStatus = z.infer<typeof ReceiptQualityStatusSchema>
export type ReceiptUploadStatus = z.infer<typeof ReceiptUploadStatusSchema>
export type ReceiptAsset = z.infer<typeof ReceiptAssetSchema>
