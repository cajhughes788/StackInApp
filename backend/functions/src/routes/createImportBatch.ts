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

export async function createImportBatchHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createImportBatch")
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
        "createImportBatch"
      )
      return
    }

    const { workspaceId } = parsedQuery.data
    const { batch, items } = await importsSvc.createImportBatch(
      workspaceId,
      uid,
      req.body
    )

    res.status(201).json({
      ok: true,
      batch,
      items,
    })
  } catch (err: any) {
    sendHttpError(res, err, "createImportBatch")
  }
}
