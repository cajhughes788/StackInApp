import type { Request, Response } from "express"
import { z } from "zod"
import * as clientsSvc from "../services/clientsService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  // With clientId: that client and each of their payments outside invoices.
  clientId: z.string().min(1).optional(),
  // "This year" in the user's own calendar.
  year: z.string().regex(/^\d{4}$/),
})

export async function getClientsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getClients")
      return
    }
    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
      clientId: req.query.clientId || undefined,
      year: req.query.year,
    })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing or invalid query", parsedQuery.error.format()), "getClients")
      return
    }
    const { workspaceId, clientId, year } = parsedQuery.data
    if (clientId) {
      const result = await clientsSvc.getClient(workspaceId, uid, clientId, year)
      res.status(200).json({ ok: true, ...result })
      return
    }
    const result = await clientsSvc.listClients(workspaceId, uid, year)
    res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    sendHttpError(res, err, "getClients")
  }
}
