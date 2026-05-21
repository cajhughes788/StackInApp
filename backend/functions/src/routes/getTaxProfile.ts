﻿// /functions/src/routes/getTaxProfile.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct verifyAuth usage (handled by withCorsAuth)
// - Maintains validation, defaults, and caching behavior

import type { Request, Response } from "express"
import { z } from "zod"
import * as taxProfileSvc from "../services/taxProfileService"
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function getTaxProfileHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid

    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getTaxProfile")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })

    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()),
        "getTaxProfile"
      )
      return
    }

    const { workspaceId } = parsedQuery.data

    const taxProfileData = await taxProfileSvc.getTaxProfile(workspaceId, uid)

    if (!taxProfileData) {
      res.status(200).json({ ok: true, taxProfile: null })
      return
    }

    // Cache-safe: short TTL for private user data
    res.setHeader("Cache-Control", "private, max-age=180")
    res.status(200).json({ ok: true, taxProfile: taxProfileData })
  } catch (err: any) {
    sendHttpError(res, err, "getTaxProfile")
  }
}
