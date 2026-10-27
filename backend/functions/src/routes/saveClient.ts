import type { Request, Response } from "express"
import { z } from "zod"
import * as clientsSvc from "../services/clientsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  // Absent: create. Present: update (archive with { archived: true }).
  clientId: z.string().min(1).optional(),
})

export async function saveClientHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "saveClient")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      clientId: req.query.clientId || undefined,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "saveClient")
      return
    }
    const { workspaceId, clientId } = parsedQuery.data
    const client = clientId
      ? await clientsSvc.updateClient(workspaceId, uid, clientId, req.body)
      : await clientsSvc.createClient(workspaceId, uid, req.body)
    res.status(clientId ? 200 : 201).json({ ok: true, client })
  } catch (err: any) {
    sendHttpError(res, err, "saveClient")
  }
}
