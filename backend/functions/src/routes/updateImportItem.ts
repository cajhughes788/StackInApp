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
  batchId: z.string().min(1),
  itemId: z.string().min(1),
})

export async function updateImportItemHandler(
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
      sendHttpError(res, new UnauthorizedError(), "updateImportItem")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      batchId: req.query.batchId,
      itemId: req.query.itemId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError(
          "Missing or invalid workspaceId/batchId/itemId",
          parsedQuery.error.format()
        ),
        "updateImportItem"
      )
      return
    }

    const { batch, item } = await importsSvc.updateImportItem(
      parsedQuery.data.workspaceId,
      uid,
      parsedQuery.data.batchId,
      parsedQuery.data.itemId,
      req.body
    )
    res.status(200).json({ ok: true, batch, item })
  } catch (err: any) {
    sendHttpError(res, err, "updateImportItem")
  }
}
