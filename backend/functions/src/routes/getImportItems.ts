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
})

export async function getImportItemsHandler(
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
      sendHttpError(res, new UnauthorizedError(), "getImportItems")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      batchId: req.query.batchId,
    })
    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError(
          "Missing or invalid workspaceId/batchId",
          parsedQuery.error.format()
        ),
        "getImportItems"
      )
      return
    }

    const items = await importsSvc.getImportItems(
      parsedQuery.data.workspaceId,
      uid,
      parsedQuery.data.batchId
    )
    res.status(200).json({ ok: true, items })
  } catch (err: any) {
    sendHttpError(res, err, "getImportItems")
  }
}
