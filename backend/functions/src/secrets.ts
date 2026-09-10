/**
 * Central registry of all Firebase secret bindings.
 *
 * This file must stay free of heavy dependencies — it is imported at the top
 * level of api.ts so that secret references are available when onRequest()
 * options are built at module-init time.  The actual secret values are never
 * fetched here; defineSecret() only creates a lightweight descriptor object.
 */
import { defineSecret } from "firebase-functions/params"

// AWS Textract
export const AWS_TEXTRACT_ACCESS_KEY_ID = defineSecret("AWS_TEXTRACT_ACCESS_KEY_ID")
export const AWS_TEXTRACT_SECRET_ACCESS_KEY = defineSecret("AWS_TEXTRACT_SECRET_ACCESS_KEY")
export const AWS_TEXTRACT_REGION = defineSecret("AWS_TEXTRACT_REGION")

// Stripe
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY")
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET")

// SendGrid
export const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY")

// Slack
export const SLACK_SUPPORT_WEBHOOK_URL = defineSecret("SLACK_SUPPORT_WEBHOOK_URL")

// Plaid
export const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID")
export const PLAID_SECRET = defineSecret("PLAID_SECRET")
export const PLAID_ENV = defineSecret("PLAID_ENV")
// Encrypts Plaid access tokens at rest in Firestore (see lib/tokenEncryption.ts) —
// a base64-encoded 32-byte AES-256 key, generated with `openssl rand -base64 32`.
export const PLAID_TOKEN_ENCRYPTION_KEY = defineSecret("PLAID_TOKEN_ENCRYPTION_KEY")
