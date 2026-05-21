export async function hashObject(obj: unknown): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(obj))
  const buffer = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
