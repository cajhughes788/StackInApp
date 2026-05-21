import { auth } from "../admin"

export async function verifyAuth(req: any) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) return null

  const idToken = authHeader.split("Bearer ")[1]
  try {
    const decoded = await auth.verifyIdToken(idToken)
    return decoded.uid
  } catch {
    return null
  }
}
