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
})

export async function createReceiptAssetHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_asset")
  trace.mark("receipt.asset.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createReceiptAsset")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "createReceiptAsset"
      )
      return
    }

    const asset = await withBackendProfileStep(
      trace,
      "receipt.asset.create",
      () =>
        receiptAssetsSvc.createReceiptAsset(
          parsedQuery.data.workspaceId,
          uid,
          req.body
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
        fileName:
          typeof req.body?.fileName === "string" ? req.body.fileName : undefined,
        mimeType:
          typeof req.body?.mimeType === "string" ? req.body.mimeType : undefined,
        sizeBytes:
          typeof req.body?.sizeBytes === "number" ? req.body.sizeBytes : undefined,
      }
    )

    trace.mark("receipt.asset.response_sent", {
      receiptAssetId: asset.id,
      originalStoragePath: asset.originalStoragePath ?? asset.storagePath ?? null,
      previewStoragePath: asset.previewStoragePath ?? null,
      thumbnailStoragePath: asset.thumbnailStoragePath ?? null,
      qualityStatus: asset.qualityStatus ?? null,
    })

    res.status(201).json({ ok: true, asset })
  } catch (err: any) {
    trace.error("receipt.asset.failed", err)
    sendHttpError(res, err, "createReceiptAsset")
  }
}
