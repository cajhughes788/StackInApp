import type { Request, Response } from "express"
import { createLinkToken } from "../services/plaidService"
import { UnauthorizedError, sendHttpError } from "../lib/httpErrors"

export async function createPlaidLinkTokenHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "createPlaidLinkToken")
      return
    }
    // Anything other than the native iOS SDK's own value keeps the original
    // browser-page redirect — see redirectUriFor in plaidService.ts.
    const client = req.body?.client === "ios-native" ? "ios-native" : "browser"
    const { link_token } = await createLinkToken(uid, client)
    res.status(200).json({ ok: true, linkToken: link_token })
  } catch (err: any) {
    sendHttpError(res, err, "createPlaidLinkToken")
  }
}
