import type { Request, Response } from "express"

import { VoiceEntryRequestSchema } from "@shared/voiceEntry"
import { VoiceExpenseRequestSchema } from "@shared/voiceExpense"
import { VoiceInvoiceRequestSchema } from "@shared/voiceInvoice"
import { VoiceBookingRequestSchema } from "@shared/voiceBooking"
import { VoiceClientRequestSchema } from "@shared/voiceClient"
import { VoiceAskRequestSchema } from "@shared/voiceAsk"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, UnauthorizedError, sendHttpError } from "../lib/httpErrors"
import { parseVoiceEntry, releaseVoiceFill, reserveVoiceFill } from "../services/voiceEntryService"
import { learnedCategoryLookup, parseVoiceExpense } from "../services/voiceExpenseService"
import { parseVoiceInvoice } from "../services/voiceInvoiceService"
import { parseVoiceBooking } from "../services/voiceBookingService"
import { parseVoiceClient } from "../services/voiceClientService"
import { parseVoiceAsk } from "../services/voiceAskService"

// POST { transcript, today, workspaceType, fields, positions } →
// { ok, result } with fields to fill the Add entry form. Saves nothing.
// With kind: "expense" (shared/voiceExpense.ts) it fills the Add expense
// form instead, and with kind: "invoice" (shared/voiceInvoice.ts) the
// invoice/quote form, and with kind: "booking" (shared/voiceBooking.ts) a
// new or moved appointment, and with kind: "client" (shared/voiceClient.ts) a
// new client or a client note, and with kind: "ask" (shared/voiceAsk.ts)
// Home's Ask 521 — same server and daily voice limit.
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
    if (req.body?.kind === "expense") {
      const expense = VoiceExpenseRequestSchema.safeParse(req.body)
      if (!expense.success) {
        sendHttpError(res, new BadRequestError("Invalid voice expense", expense.error.format()), "parseVoiceEntry")
        return
      }
      await assertWorkspaceMembership(expense.data.workspaceId, uid)
      await reserveVoiceFill(uid)
      const result = await parseVoiceExpense(expense.data, learnedCategoryLookup(expense.data.workspaceId))
      res.status(200).json({ ok: true, result })
      return
    }
    if (req.body?.kind === "invoice") {
      const invoice = VoiceInvoiceRequestSchema.safeParse(req.body)
      if (!invoice.success) {
        sendHttpError(res, new BadRequestError("Invalid voice invoice", invoice.error.format()), "parseVoiceEntry")
        return
      }
      await reserveVoiceFill(uid)
      const result = await parseVoiceInvoice(invoice.data)
      res.status(200).json({ ok: true, result })
      return
    }
    if (req.body?.kind === "booking") {
      const booking = VoiceBookingRequestSchema.safeParse(req.body)
      if (!booking.success) {
        sendHttpError(res, new BadRequestError("Invalid voice booking", booking.error.format()), "parseVoiceEntry")
        return
      }
      await reserveVoiceFill(uid)
      const result = await parseVoiceBooking(booking.data)
      res.status(200).json({ ok: true, result })
      return
    }
    if (req.body?.kind === "client") {
      const client = VoiceClientRequestSchema.safeParse(req.body)
      if (!client.success) {
        sendHttpError(res, new BadRequestError("Invalid voice client", client.error.format()), "parseVoiceEntry")
        return
      }
      await reserveVoiceFill(uid)
      const result = await parseVoiceClient(client.data)
      res.status(200).json({ ok: true, result })
      return
    }
    if (req.body?.kind === "ask") {
      const ask = VoiceAskRequestSchema.safeParse(req.body)
      if (!ask.success) {
        sendHttpError(res, new BadRequestError("Invalid voice question", ask.error.format()), "parseVoiceEntry")
        return
      }
      await reserveVoiceFill(uid)
      const result = await parseVoiceAsk(ask.data)
      // A "log" goes on to that form's own fill, which is the one counted.
      if (result.intent === "log") await releaseVoiceFill(uid).catch(() => {})
      res.status(200).json({ ok: true, result })
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
