import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptAssetsSvc from "../services/receiptAssetsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  receiptAssetId: z.string().min(1),
})

const BodySchema = z.object({
  uploadStatus: z.enum(["complete", "failed"]),
})

export async function updateReceiptAssetUploadStatusHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "updateReceiptAssetUploadStatus")
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
        "updateReceiptAssetUploadStatus"
      )
      return
    }

    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid uploadStatus", parsedBody.error.format()),
        "updateReceiptAssetUploadStatus"
      )
      return
    }

    const asset = await receiptAssetsSvc.updateReceiptAssetUploadStatus(
      parsedQuery.data.workspaceId,
      uid,
      parsedQuery.data.receiptAssetId,
      parsedBody.data.uploadStatus
    )

    res.status(200).json({ ok: true, asset })
  } catch (err: any) {
    sendHttpError(res, err, "updateReceiptAssetUploadStatus")
  }
}
