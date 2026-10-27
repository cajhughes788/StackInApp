import type { Request, Response } from "express"
import { z } from "zod"
import * as clientsSvc from "../services/clientsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const BodySchema = z.object({
  // fromId is folded into intoId and deleted.
  fromId: z.string().min(1),
  intoId: z.string().min(1),
})

export async function mergeClientsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "mergeClients")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedQuery.success || !parsedBody.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId, fromId or intoId"), "mergeClients")
      return
    }
    const client = await clientsSvc.mergeClients(
      parsedQuery.data.workspaceId,
      uid,
      parsedBody.data.fromId,
      parsedBody.data.intoId
    )
    res.status(200).json({ ok: true, client })
  } catch (err: any) {
    sendHttpError(res, err, "mergeClients")
  }
}
