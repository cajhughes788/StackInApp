import { z } from "zod"

import { db } from "../admin"
import { storage } from "../admin"
import {
  BadRequestError,
  NotFoundError,
} from "../lib/httpErrors"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { ReceiptAssetSchema, type ReceiptAsset } from "@shared/schemas/receiptAsset"

const CreateReceiptAssetInputSchema = ReceiptAssetSchema.omit({
  workspaceId: true,
  uploadedByUid: true,
  version: true,
  originalStoragePath: true,
  previewStoragePath: true,
  thumbnailStoragePath: true,
  storagePath: true,
  createdAt: true,
  updatedAt: true,
  dataUrl: true,
}).extend({
  id: z.string().trim().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})



function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry)) as T
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

function buildStoragePath(
  workspaceId: string,
  receiptAssetId: string,
  fileName: string
): string {
  const extensionMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  const extension = extensionMatch?.[1] ?? "jpg"
  return `workspaces/${workspaceId}/receipts/${receiptAssetId}/original.${extension}`
}

function buildDerivedStoragePath(
  workspaceId: string,
  receiptAssetId: string,
  kind: "preview" | "thumb"
): string {
  const fileName = kind === "preview" ? "preview.jpg" : "thumb.jpg"
  return `workspaces/${workspaceId}/receipts/${receiptAssetId}/${fileName}`
}

function normalizeReceiptAsset(asset: ReceiptAsset): ReceiptAsset {
  const originalStoragePath = asset.originalStoragePath ?? asset.storagePath

  return ReceiptAssetSchema.parse({
    ...asset,
    version: asset.version || 1,
    originalStoragePath,
    storagePath: asset.storagePath ?? originalStoragePath,
  })
}

export async function createReceiptAsset(
  workspaceId: string,
  uid: string,
  input: unknown
): Promise<ReceiptAsset> {
  await assertWorkspaceMembership(workspaceId, uid)

  const parsed = CreateReceiptAssetInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new BadRequestError("Invalid receipt asset payload", parsed.error.format())
  }

  const nowIso = new Date().toISOString()
  const assetRef = parsed.data.id
    ? db.doc(`workspaces/${workspaceId}/receiptAssets/${parsed.data.id}`)
    : db.collection(`workspaces/${workspaceId}/receiptAssets`).doc()
  const asset = ReceiptAssetSchema.parse({
    id: assetRef.id,
    workspaceId,
    uploadedByUid: uid,
    version: 1,
    originalStoragePath: buildStoragePath(workspaceId, assetRef.id, parsed.data.fileName),
    previewStoragePath: buildDerivedStoragePath(workspaceId, assetRef.id, "preview"),
    thumbnailStoragePath: buildDerivedStoragePath(workspaceId, assetRef.id, "thumb"),
    storagePath: buildStoragePath(workspaceId, assetRef.id, parsed.data.fileName),
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    width: parsed.data.width,
    height: parsed.data.height,
    captureSource: parsed.data.captureSource,
    quality: parsed.data.quality,
    blurScore: parsed.data.blurScore,
    glareScore: parsed.data.glareScore,
    qualityStatus: parsed.data.qualityStatus,
    qualityWarnings: parsed.data.qualityWarnings ?? [],
    createdAt: nowIso,
    updatedAt: nowIso,
  })

  const normalized = normalizeReceiptAsset(asset)

  await assetRef.set(stripUndefinedDeep(normalized))
  return normalized
}


export async function getReceiptAsset(
  workspaceId: string,
  uid: string,
  receiptAssetId: string
): Promise<ReceiptAsset> {
  await assertWorkspaceMembership(workspaceId, uid)

  const snap = await db.doc(`workspaces/${workspaceId}/receiptAssets/${receiptAssetId}`).get()
  if (!snap.exists) {
    throw new NotFoundError("Receipt asset not found")
  }

  const asset = ReceiptAssetSchema.parse({
    id: snap.id,
    ...snap.data(),
  })

  return normalizeReceiptAsset(asset)
}

export async function deleteReceiptAssetCascade(
  workspaceId: string,
  uid: string,
  receiptAssetId: string
): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)

  const assetRef = db.doc(`workspaces/${workspaceId}/receiptAssets/${receiptAssetId}`)
  const [draftsSnap, analysesSnap] = await Promise.all([
    db
      .collection(`workspaces/${workspaceId}/receiptDrafts`)
      .where("receiptAssetId", "==", receiptAssetId)
      .get(),
    db
      .collection(`workspaces/${workspaceId}/receiptAnalyses`)
      .where("receiptAssetId", "==", receiptAssetId)
      .get(),
  ])

  const batch = db.batch()
  batch.delete(assetRef)

  for (const draftDoc of draftsSnap.docs) {
    batch.delete(draftDoc.ref)
  }

  for (const analysisDoc of analysesSnap.docs) {
    batch.delete(analysisDoc.ref)
  }

  await batch.commit()

  const prefix = `workspaces/${workspaceId}/receipts/${receiptAssetId}/`
  try {
    await storage.bucket().deleteFiles({ prefix })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    const isMissingObject =
      message.includes("no such object") || message.includes("not found")
    const isMissingBucketConfig =
      message.includes("bucket name not specified") ||
      message.includes("invalid bucket name") ||
      message.includes("storagebucket")

    if (!isMissingObject && !isMissingBucketConfig) {
      throw error
    }

    console.warn("receipt asset storage cleanup skipped", {
      workspaceId,
      receiptAssetId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
