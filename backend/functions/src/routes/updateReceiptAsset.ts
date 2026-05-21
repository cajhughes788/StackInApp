import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptAssetsSvc from "../services/receiptAssetsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  receiptAssetId: z.string().min(1),
})

export async function updateReceiptAssetHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_asset")
  trace.mark("receipt.asset_update.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateReceiptAsset")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      receiptAssetId: req.query.receiptAssetId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid receipt asset query", parsedQuery.error.format()),
        "updateReceiptAsset"
      )
      return
    }

    const asset = await withBackendProfileStep(
      trace,
      "receipt.asset.update",
      () =>
        receiptAssetsSvc.updateReceiptAsset(
          parsedQuery.data.workspaceId,
          uid,
          parsedQuery.data.receiptAssetId,
          req.body
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
        receiptAssetId: parsedQuery.data.receiptAssetId,
        hasOriginalDownloadUrl:
          (typeof req.body?.originalDownloadUrl === "string" &&
            req.body.originalDownloadUrl.length > 0) ||
          (typeof req.body?.downloadUrl === "string" && req.body.downloadUrl.length > 0),
        hasOriginalStoragePath:
          (typeof req.body?.originalStoragePath === "string" &&
            req.body.originalStoragePath.length > 0) ||
          (typeof req.body?.storagePath === "string" && req.body.storagePath.length > 0),
        hasPreviewDownloadUrl:
          typeof req.body?.previewDownloadUrl === "string" &&
          req.body.previewDownloadUrl.length > 0,
        hasThumbnailDownloadUrl:
          typeof req.body?.thumbnailDownloadUrl === "string" &&
          req.body.thumbnailDownloadUrl.length > 0,
      }
    )

    trace.mark("receipt.asset_update.response_sent", {
      receiptAssetId: asset.id,
      hasOriginalDownloadUrl: Boolean(asset.originalDownloadUrl ?? asset.downloadUrl),
      hasOriginalStoragePath: Boolean(asset.originalStoragePath ?? asset.storagePath),
      hasPreviewDownloadUrl: Boolean(asset.previewDownloadUrl),
      hasThumbnailDownloadUrl: Boolean(asset.thumbnailDownloadUrl),
    })

    res.status(200).json({ ok: true, asset })
  } catch (err: any) {
    trace.error("receipt.asset_update.failed", err)
    sendHttpError(res, err, "updateReceiptAsset")
  }
}
