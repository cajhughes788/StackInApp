import type { Request, Response } from "express"
import { z } from "zod"

import * as receiptAnalysisSvc from "../services/receiptAnalysisService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function analyzeReceiptHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_analysis")
  trace.mark("receipt.analysis.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
    receiptAssetId:
      typeof req.body?.receiptAssetId === "string" ? req.body.receiptAssetId : undefined,
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "analyzeReceipt")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "analyzeReceipt"
      )
      return
    }

    // When the client sends image bytes directly we skip the GCS round-trip.
    const imageBytes =
      typeof req.body?.imageBase64 === "string" && req.body.imageBase64.length > 0
        ? Buffer.from(req.body.imageBase64, "base64")
        : undefined

    trace.mark("receipt.analysis.bytes_source", {
      hasBytesInRequest: Boolean(imageBytes),
      bytesLength: imageBytes?.length ?? 0,
    })

    const result = await withBackendProfileStep(
      trace,
      "receipt.analysis.service_analyze",
      () =>
        receiptAnalysisSvc.analyzeReceipt(
          parsedQuery.data.workspaceId,
          uid,
          req.body,
          trace,
          imageBytes
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
      }
    )

    trace.mark("receipt.analysis.response_sent", {
      analysisId: result.analysis.id,
      receiptAssetId: result.analysis.receiptAssetId,
      status: result.analysis.status,
    })

    res.status(200).json({
      ok: true,
      analysis: result.analysis,
      draft: result.draft,
    })
  } catch (err: any) {
    trace.error("receipt.analysis.failed", err)
    sendHttpError(res, err, "analyzeReceipt")
  }
}
