import { ForbiddenError } from "./httpErrors"

// Generous relative to how soon after reauthenticateWithCredential() the
// client actually calls the protected endpoint — this exists to reject a
// stale-but-still-valid token being used directly against the API (e.g. a
// token obtained through some other compromise), not to add friction to the
// normal flow, where auth_time is effectively "just now."
const MAX_AUTH_AGE_MS = 5 * 60 * 1000

// For destructive account-level actions (account/workspace deletion) where
// the client already re-prompts for a password via
// reauthenticateWithCredential() before calling the endpoint. Without this,
// that re-auth step is purely a client-side UI gate — anyone holding a
// valid-but-not-recently-issued ID token (e.g. after a stale-token
// exfiltration) could call the endpoint directly and skip it entirely.
export function requireRecentAuth(req: { user?: { authTimeMs?: number } }): void {
  const authTimeMs = req.user?.authTimeMs
  if (typeof authTimeMs !== "number" || Date.now() - authTimeMs > MAX_AUTH_AGE_MS) {
    throw new ForbiddenError("Please log in again to confirm this action")
  }
}
