import type { Request, Response } from "express"
import { z } from "zod"

import { db } from "../admin"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const BodySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export async function updateWorkspaceHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    if (!uid) {
      res.status(401).json({ ok: false, error: "Unauthorized" })
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })
    if (!parsedQuery.success) {
      res.status(400).json({ ok: false, error: "Missing workspaceId" })
      return
    }

    const parsedBody = BodySchema.safeParse(req.body)
    if (!parsedBody.success) {
      res.status(400).json({ ok: false, error: "Invalid request body" })
      return
    }

    const { workspaceId } = parsedQuery.data
    const { name } = parsedBody.data

    const membershipRef = db.doc(`users/${uid}/memberships/${workspaceId}`)
    const workspaceRef = db.doc(`workspaces/${workspaceId}`)

    const [membershipSnap, workspaceSnap] = await Promise.all([
      membershipRef.get(),
      workspaceRef.get(),
    ])

    if (!membershipSnap.exists) {
      res.status(403).json({ ok: false, error: "Forbidden" })
      return
    }

    const membership = membershipSnap.data() as { role?: string }
    if (membership.role !== "owner" && membership.role !== "admin") {
      res.status(403).json({ ok: false, error: "Insufficient permissions" })
      return
    }

    if (!workspaceSnap.exists) {
      res.status(404).json({ ok: false, error: "Workspace not found" })
      return
    }

    await workspaceRef.update({
      name,
      updatedAt: Date.now(),
    })

    const updatedSnap = await workspaceRef.get()
    const workspace = updatedSnap.data()

    res.status(200).json({
      ok: true,
      workspace: {
        id: workspaceId,
        ownerId: workspace?.ownerId ?? uid,
        type: workspace?.type,
        name: workspace?.name ?? name,
        status: workspace?.status ?? "active",
        createdAt: workspace?.createdAt ?? Date.now(),
        updatedAt: workspace?.updatedAt ?? Date.now(),
      },
    })
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message ?? "Internal server error",
    })
  }
}
