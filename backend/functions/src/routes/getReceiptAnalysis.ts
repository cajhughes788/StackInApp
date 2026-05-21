import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptAnalysisSvc from "../services/receiptAnalysisService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  analysisId: z.string().min(1).optional(),
  receiptAssetId: z.string().min(1).optional(),
})

export async function getReceiptAnalysisHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getReceiptAnalysis")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      analysisId: req.query.analysisId,
      receiptAssetId: req.query.receiptAssetId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid receipt analysis query", parsedQuery.error.format()),
        "getReceiptAnalysis"
      )
      return
    }

    const analysis = await receiptAnalysisSvc.getReceiptAnalysis(
      parsedQuery.data.workspaceId,
      uid,
      {
        analysisId: parsedQuery.data.analysisId,
        receiptAssetId: parsedQuery.data.receiptAssetId,
      }
    )

    res.status(200).json({
      ok: true,
      analysis,
    })
  } catch (err: any) {
    sendHttpError(res, err, "getReceiptAnalysis")
  }
}
