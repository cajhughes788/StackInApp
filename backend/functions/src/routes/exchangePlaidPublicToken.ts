import type { Request, Response } from "express"
import { z } from "zod"
import { exchangePublicToken } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const BodySchema = z.object({
  publicToken: z.string().min(1),
  // From Plaid Link's own onSuccess metadata — used to reject an accidental
  // duplicate connection before it's ever created. Optional/nullable since
  // older cached clients or an unexpected Plaid response shape shouldn't
  // hard-fail this endpoint; the service treats a missing institutionId as
  // "can't check" rather than "block."
  institutionId: z.string().nullable().optional(),
  accounts: z
    .array(z.object({ name: z.string(), mask: z.string().nullable() }))
    .optional(),
})

export async function exchangePlaidPublicTokenHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "exchangePlaidPublicToken")
      return
    }
    const parsedQuery = QuerySchema.safeParse({ workspaceId: req.query.workspaceId })
    if (!parsedQuery.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId", parsedQuery.error.format()), "exchangePlaidPublicToken")
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Missing publicToken", parsedBody.error.format()), "exchangePlaidPublicToken")
      return
    }
    const { itemId } = await exchangePublicToken(parsedQuery.data.workspaceId, uid, parsedBody.data.publicToken, {
      institutionId: parsedBody.data.institutionId ?? null,
      accounts: parsedBody.data.accounts ?? [],
    })
    res.status(200).json({ ok: true, itemId })
  } catch (err: any) {
    sendHttpError(res, err, "exchangePlaidPublicToken")
  }
}
