import type { Request, Response } from "express"
import { z } from "zod"

import * as importsSvc from "../services/importsService"
import {
  BadRequestError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export async function getImportBatchesHandler(
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
      sendHttpError(res, new UnauthorizedError(), "getImportBatches")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError(
          "Missing or invalid workspaceId",
          parsedQuery.error.format()
        ),
        "getImportBatches"
      )
      return
    }

    const batches = await importsSvc.getImportBatches(
      parsedQuery.data.workspaceId,
      uid
    )
    res.status(200).json({ ok: true, batches })
  } catch (err: any) {
    sendHttpError(res, err, "getImportBatches")
  }
}
