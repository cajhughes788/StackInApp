// Signup source attribution (UTM params captured on stackin-app.com) and the
// StackIn Content Log webhook row built from it.
//
// Kept free of firebase-admin imports so it can be unit tested directly
// (see scripts/test-signup-attribution.cjs).

export const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const
export const UTM_MAX_LENGTH = 100
export const CONTENT_LOG_TIMEOUT_MS = 10_000

export type UtmField = (typeof UTM_FIELDS)[number]
export type SignupPlatform = "web" | "ios"

export type SignupAttribution = Record<UtmField, string | null> & {
  signup_platform: SignupPlatform
}

// Display names for the Content Log's "plan" column, keyed by the
// SubscriptionTier the person clicked on the pricing page before signing up.
const PLAN_LABELS: Record<string, string> = {
  w2_basic: "W2 Free",
  independent_basic: "Independent",
  hybrid_plus: "Hybrid",
}

// Attribution is best-effort: anything malformed becomes null rather than
// failing validation, so a bad value can never block a signup.
export function sanitizeAttributionValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().slice(0, UTM_MAX_LENGTH)
  return trimmed || null
}

export function parseSignupAttribution(body: Record<string, unknown>): SignupAttribution {
  return {
    utm_source: sanitizeAttributionValue(body.utm_source),
    utm_medium: sanitizeAttributionValue(body.utm_medium),
    utm_campaign: sanitizeAttributionValue(body.utm_campaign),
    utm_content: sanitizeAttributionValue(body.utm_content),
    signup_platform: body.signup_platform === "ios" ? "ios" : "web",
  }
}

export function getPlanLabel(plan: unknown): string {
  return typeof plan === "string" ? PLAN_LABELS[plan] ?? "" : ""
}

// The exact (and only) fields the Content Log sheet receives. Deliberately
// no email, name, uid, or anything else that identifies the person.
export type ContentLogPayload = {
  secret: string
  signup_date: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  survey_answer: string
  plan: string
}

export type ContentLogRow = Omit<ContentLogPayload, "secret">

export function buildContentLogRow(
  attribution: SignupAttribution,
  plan: unknown,
  signupDate: Date
): ContentLogRow {
  const hasAnyUtm = UTM_FIELDS.some((field) => attribution[field])
  const fallbackSource = attribution.signup_platform === "ios" ? "ios_app" : "direct"

  return {
    signup_date: signupDate.toISOString().slice(0, 10),
    utm_source: hasAnyUtm ? attribution.utm_source ?? "" : fallbackSource,
    utm_medium: attribution.utm_medium ?? "",
    utm_campaign: attribution.utm_campaign ?? "",
    utm_content: attribution.utm_content ?? "",
    survey_answer: "",
    plan: getPlanLabel(plan),
  }
}

export function buildContentLogPayload(row: Partial<ContentLogRow>, secret: string): ContentLogPayload {
  // Rebuilt field by field (rather than spreading `row`) so nothing stored
  // alongside the row can leak into the request.
  return {
    secret,
    signup_date: String(row.signup_date ?? ""),
    utm_source: String(row.utm_source ?? ""),
    utm_medium: String(row.utm_medium ?? ""),
    utm_campaign: String(row.utm_campaign ?? ""),
    utm_content: String(row.utm_content ?? ""),
    survey_answer: "",
    plan: String(row.plan ?? ""),
  }
}

export type ContentLogResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }

// Never throws. Google Apps Script web apps answer POST with a 302 to the
// result page, so redirects must be followed for the request to count as ok.
export async function postContentLogRow(options: {
  url: string | undefined
  secret: string | undefined
  row: Partial<ContentLogRow>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<ContentLogResult> {
  const url = options.url?.trim()
  if (!url) {
    return { status: "skipped", reason: "Missing CONTENT_LOG_WEBHOOK_URL" }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? CONTENT_LOG_TIMEOUT_MS
  const timer = setTimeout(
    () => controller.abort(new Error(`Content Log webhook timed out after ${timeoutMs}ms`)),
    timeoutMs
  )

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildContentLogPayload(options.row, options.secret ?? "")),
      redirect: "follow",
      signal: controller.signal,
    })

    if (!response.ok) {
      return { status: "failed", error: `Content Log webhook failed (${response.status})` }
    }

    return { status: "sent" }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Content Log webhook failed"
    return { status: "failed", error: message.slice(0, 500) }
  } finally {
    clearTimeout(timer)
  }
}
