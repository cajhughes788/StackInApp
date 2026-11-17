import type { Request, Response } from "express"

import { VoiceEntryRequestSchema } from "@shared/voiceEntry"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"
import { parseVoiceEntry, reserveVoiceFill } from "../services/voiceEntryService"

// POST { transcript, today, workspaceType, fields, positions } →
// { ok, result } with fields to fill the Add entry form. Saves nothing.
export async function parseVoiceEntryHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "parseVoiceEntry")
      return
    }
    const parsed = VoiceEntryRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      sendHttpError(res, new BadRequestError("Invalid voice entry", parsed.error.format()), "parseVoiceEntry")
      return
    }
    await reserveVoiceFill(uid)
    const result = await parseVoiceEntry(parsed.data)
    res.status(200).json({ ok: true, result })
  } catch (err) {
    sendHttpError(res, err, "parseVoiceEntry")
  }
}
