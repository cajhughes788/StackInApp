import type { Request, Response } from "express"
import { z } from "zod"
import { registerDeviceToken } from "../services/pushNotificationService"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"

const BodySchema = z.object({
  fcmToken: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().optional(),
})

export async function registerDeviceTokenHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "registerDeviceToken")
      return
    }
    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      sendHttpError(res, new BadRequestError("Invalid device token payload", parsedBody.error.format()), "registerDeviceToken")
      return
    }
    await registerDeviceToken(uid, parsedBody.data.fcmToken, parsedBody.data.platform, parsedBody.data.appVersion)
    res.status(200).json({ ok: true })
  } catch (err: any) {
    sendHttpError(res, err, "registerDeviceToken")
  }
}
