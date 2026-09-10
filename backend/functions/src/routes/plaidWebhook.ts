import type { Request, Response } from "express"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { getPlaidClient, syncTransactionsForItem, handleItemWebhook } from "../services/plaidService"

// SYNC_UPDATES_AVAILABLE is the webhook Plaid's docs recommend acting on when
// using /transactions/sync — DEFAULT_UPDATE/INITIAL_UPDATE/HISTORICAL_UPDATE
// are documented as legacy /transactions/get-era webhooks kept only for
// backwards compatibility, which "still fire" alongside SYNC_UPDATES_AVAILABLE.
// In practice (confirmed via sandbox testing with user_transactions_dynamic +
// /transactions/refresh), Plaid sometimes sends only the legacy codes and
// never SYNC_UPDATES_AVAILABLE at all. Reacting to both is safe regardless of
// why: syncTransactionsForItem is cursor-based and idempotent, so an extra
// call when nothing's actually new just returns an empty diff.
const TRANSACTIONS_SYNC_TRIGGER_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "DEFAULT_UPDATE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
])

// Plaid signs webhooks with a rotating ES256 key (JWT in the
// Plaid-Verification header), not a static HMAC secret like Stripe's — see
// https://plaid.com/docs/api/webhooks/webhook-verification/. Verification
// keys are cached in memory per key id and only refetched on a cache miss
// (a `kid` we haven't seen, e.g. after Plaid rotates keys).
type CachedJwk = { jwk: Record<string, unknown>; expiredAtMs: number | null }
const jwkCache = new Map<string, CachedJwk>()
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000

async function getVerificationKey(keyId: string): Promise<Record<string, unknown>> {
  const cached = jwkCache.get(keyId)
  if (cached && (cached.expiredAtMs === null || cached.expiredAtMs > Date.now())) {
    return cached.jwk
  }
  const plaid = getPlaidClient()
  const response = await plaid.webhookVerificationKeyGet({ key_id: keyId })
  const key = response.data.key as unknown as Record<string, unknown> & { expired_at?: string | null }
  jwkCache.set(keyId, {
    jwk: key,
    expiredAtMs: key.expired_at ? Date.parse(key.expired_at) : null,
  })
  return key
}

async function verifyPlaidWebhook(req: Request): Promise<Record<string, any>> {
  const token = req.headers["plaid-verification"]
  if (typeof token !== "string") {
    throw new Error("Missing Plaid-Verification header")
  }
  const decoded = jwt.decode(token, { complete: true })
  const keyId = decoded && typeof decoded === "object" ? (decoded.header as any)?.kid : undefined
  if (typeof keyId !== "string") {
    throw new Error("Malformed Plaid webhook token")
  }
  const jwk = await getVerificationKey(keyId)
  const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" })
  const payload = jwt.verify(token, publicKey as any, { algorithms: ["ES256"] }) as {
    iat?: number
    request_body_sha256?: string
  }
  const issuedAtMs = (payload.iat ?? 0) * 1000
  if (Date.now() - issuedAtMs > MAX_WEBHOOK_AGE_MS) {
    throw new Error("Plaid webhook token is too old")
  }
  const rawBody = (req as any).rawBody as Buffer | undefined
  if (!rawBody) {
    throw new Error("Missing raw webhook body")
  }
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex")
  if (bodyHash !== payload.request_body_sha256) {
    throw new Error("Plaid webhook body hash mismatch")
  }
  return payload
}

export async function plaidWebhookHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed")
    return
  }
  let event: {
    webhook_type?: string
    webhook_code?: string
    item_id?: string
    error?: { error_code?: string; error_message?: string } | null
  } = {}
  try {
    await verifyPlaidWebhook(req)
    event = req.body ?? {}
    console.info("plaidWebhook: received", {
      webhook_type: event.webhook_type,
      webhook_code: event.webhook_code,
      item_id: event.item_id,
    })
    if (event.webhook_type === "TRANSACTIONS" && event.webhook_code && TRANSACTIONS_SYNC_TRIGGER_CODES.has(event.webhook_code) && event.item_id) {
      const result = await syncTransactionsForItem(event.item_id)
      console.info("plaidWebhook: sync complete", { item_id: event.item_id, added: result.added })
    } else if (event.webhook_type === "ITEM" && event.item_id && event.webhook_code) {
      await handleItemWebhook(event.item_id, event.webhook_code, event.error ?? null)
    } else {
      console.info("plaidWebhook: event ignored (not a handled type/code)", event)
    }
    res.status(200).json({ received: true })
  } catch (error: any) {
    console.error("plaidWebhook: handler failed", {
      webhook_type: event.webhook_type,
      webhook_code: event.webhook_code,
      item_id: event.item_id,
      message: error?.message ?? String(error),
      stack: error?.stack,
    })
    res.status(400).send(error?.message ?? "Webhook error")
  }
}
