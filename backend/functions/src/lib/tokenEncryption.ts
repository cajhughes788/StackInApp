import crypto from "crypto"

// AES-256-GCM for Plaid access tokens at rest (see plaidService.ts). GCM's
// auth tag means a tampered or corrupted ciphertext fails to decrypt loudly
// instead of silently returning garbage that gets sent to Plaid as a bogus
// access token.
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // NIST-recommended IV size for GCM

function loadKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64")
  if (key.length !== 32) {
    throw new Error("PLAID_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key")
  }
  return key
}

// Output is "iv:authTag:ciphertext" (each base64) — self-describing so
// decryptToken doesn't need to assume fixed segment lengths.
export function encryptToken(plaintext: string, keyBase64: string): string {
  const key = loadKey(keyBase64)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(":")
}

export function decryptToken(encoded: string, keyBase64: string): string {
  const key = loadKey(keyBase64)
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(":")
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted token payload")
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()])
  return plaintext.toString("utf8")
}
