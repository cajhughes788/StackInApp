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

export async function finalizeReceiptAnalysisHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const trace = createBackendProfileTrace(req, "receipt_analysis_finalize")
  trace.mark("receipt.analysis_finalize.handler_invoked", {
    bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
  })

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "finalizeReceiptAnalysis")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "finalizeReceiptAnalysis"
      )
      return
    }

    const result = await withBackendProfileStep(
      trace,
      "receipt.analysis_finalize.service",
      () =>
        receiptAnalysisSvc.finalizeReceiptDraftForAnalysis(
          parsedQuery.data.workspaceId,
          uid,
          req.body
        ),
      {
        workspaceId: parsedQuery.data.workspaceId,
      }
    )

    res.status(200).json({
      ok: true,
      analysis: result.analysis,
      draft: result.draft,
    })
  } catch (err: any) {
    trace.error("receipt.analysis_finalize.failed", err)
    sendHttpError(res, err, "finalizeReceiptAnalysis")
  }
}
