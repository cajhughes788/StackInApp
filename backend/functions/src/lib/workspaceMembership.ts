import { db } from "../admin"
import { ForbiddenError } from "./httpErrors"

const membershipCache = new Map<string, { expiresAt: number }>()
const CACHE_TTL_MS = 60_000

export async function assertWorkspaceMembership(
  workspaceId: string,
  uid: string
): Promise<void> {
  const key = `${uid}:${workspaceId}`
  const cached = membershipCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return

  const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get()
  if (!memberSnap.exists) {
    throw new ForbiddenError("Forbidden")
  }

  membershipCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS })
}
