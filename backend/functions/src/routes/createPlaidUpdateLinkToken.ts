import type { Request, Response } from "express"
import { z } from "zod"
import { createUpdateLinkToken } from "../services/plaidService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const BodySchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
})

export async function createPlaidUpdateLinkTokenHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createPlaidUpdateLinkToken")
      return
    }
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
      sendHttpError(res, new BadRequestError("Missing workspaceId or itemId", parsed.error.format()), "createPlaidUpdateLinkToken")
      return
    }
    const { link_token } = await createUpdateLinkToken(parsed.data.workspaceId, uid, parsed.data.itemId)
    res.status(200).json({ ok: true, linkToken: link_token })
  } catch (err: any) {
    sendHttpError(res, err, "createPlaidUpdateLinkToken")
  }
}
