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

export async function deleteReceiptAssetHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "deleteReceiptAsset")
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
        "deleteReceiptAsset"
      )
      return
    }

    await receiptAssetsSvc.deleteReceiptAssetCascade(
      parsedQuery.data.workspaceId,
      uid,
      parsedQuery.data.receiptAssetId
    )

    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "deleteReceiptAsset")
  }
}
