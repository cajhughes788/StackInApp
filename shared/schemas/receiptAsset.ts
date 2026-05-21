import { z } from "zod"

export const ReceiptCaptureSourceSchema = z.enum(["camera", "gallery", "upload"])

export const ReceiptQualityStatusSchema = z.enum(["good", "warning", "bad"])

export const ReceiptAssetSchema = z.object({
  id: z.string(),
  workspaceId: z.string().trim().min(1).optional(),
  uploadedByUid: z.string().trim().min(1).optional(),
  version: z.number().int().positive().default(1),
  originalStoragePath: z.string().trim().min(1).optional(),
  previewStoragePath: z.string().trim().min(1).optional(),
  thumbnailStoragePath: z.string().trim().min(1).optional(),
  originalDownloadUrl: z.string().trim().min(1).optional(),
  previewDownloadUrl: z.string().trim().min(1).optional(),
  thumbnailDownloadUrl: z.string().trim().min(1).optional(),
  storagePath: z.string().trim().min(1).optional(),
  downloadUrl: z.string().trim().min(1).optional(),
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
  dataUrl: z.string().trim().min(1).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type ReceiptCaptureSource = z.infer<typeof ReceiptCaptureSourceSchema>
export type ReceiptQualityStatus = z.infer<typeof ReceiptQualityStatusSchema>
export type ReceiptAsset = z.infer<typeof ReceiptAssetSchema>
