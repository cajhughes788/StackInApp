import type { Request, Response } from "express"
import { logger } from "firebase-functions"
import { z } from "zod"

import { auth } from "../admin"

// Failure notes from the app: a request, a write to the phone's own storage,
// or a code error that went wrong on someone's phone. They only go to the
// server logs (search "[client-failure]"), so a failure that never reached any
// other server function can still be looked up after the app is closed.
//
// Signing in is optional here on purpose: a missing or broken sign-in token can
// itself be the failure being reported. The note is still logged without a
// user, and the user is added when a valid token comes along.

const text = (max: number) => z.string().max(max)

const FailureSchema = z.object({
  kind: z.enum(["request", "local_storage", "app_error", "user_saw_error"]),
  step: text(40),
  where: text(120),
  method: text(10).optional(),
  status: z.number().int().optional(),
  errorName: text(80).optional(),
  message: text(300),
  workspaceId: text(64).nullable().optional(),
  screen: text(200).optional(),
  online: z.boolean().optional(),
  sentRequest: z.boolean().optional(),
  msSinceOpen: z.number().optional(),
  msSinceForeground: z.number().nullable().optional(),
  lastBackgroundMs: z.number().nullable().optional(),
  platform: text(20).optional(),
  buildId: text(80).nullable().optional(),
  count: z.number().int().optional(),
  happenedAt: text(40),
})

const BodySchema = z.object({
  failures: z.array(FailureSchema).min(1).max(20),
})

async function optionalUid(req: Request): Promise<string | null> {
  const header = req.headers.authorization
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) return null
  try {
    return (await auth.verifyIdToken(token)).uid
  } catch {
    return null
  }
}

export async function logClientFailureHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid failure note" })
    return
  }

  const uid = await optionalUid(req)
  const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 200)

  for (const { message, ...failure } of parsed.data.failures) {
    // "message" is the log line's own title, so the phone's error text is
    // logged as errorMessage.
    logger.warn(`[client-failure] ${failure.kind} ${failure.step} at ${failure.where}`, {
      clientFailure: true,
      uid,
      signedIn: uid !== null,
      userAgent,
      ...failure,
      errorMessage: message,
    })
  }

  res.status(200).json({ ok: true })
}
