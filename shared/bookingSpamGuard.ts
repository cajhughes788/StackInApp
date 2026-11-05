import { createHash, createHmac, timingSafeEqual } from "node:crypto"

// ---------------------------------------------------------------------------
// Spam guard for the public booking page (backend only: uses node:crypto).
//
// On top of the hidden `website` field:
// - each booking form carries a signed stamp of when it was shown, so a
//   script can't post without loading the page, and a form sent faster than
//   a person could fill it is refused;
// - tries per visitor, bookings per email and bookings per business are
//   counted in fixed windows (bookingLimits docs, cleared daily).
// ---------------------------------------------------------------------------

export const BOOKING_FORM_MIN_MS = 3_000
export const BOOKING_FORM_MAX_AGE_MS = 2 * 60 * 60_000

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

export const BOOKING_LIMITS = {
  // Tries from one visitor on one business's page.
  visitor: { max: 5, windowMs: HOUR_MS },
  // Online bookings made with one email at one business.
  email: { max: 3, windowMs: DAY_MS },
  // Online bookings at one business.
  business: { max: 25, windowMs: DAY_MS },
} as const

export type BookingLimitKind = keyof typeof BOOKING_LIMITS

export const BOOKING_LIMIT_MESSAGES: Record<BookingLimitKind, string> = {
  visitor: "Too many tries — please wait a bit and try again.",
  email: "That's the most you can book online today. Please contact the business to book more.",
  business: "This business isn't taking more online bookings today. Please contact them directly.",
}

function signature(secret: string, slug: string, key: string, issuedAtMs: number): string {
  return createHmac("sha256", secret).update(`${slug}|${key}|${issuedAtMs}`).digest("base64url")
}

/** The stamp a booking form carries: when it was shown, signed with its link and key. */
export function signBookingFormStamp(secret: string, slug: string, key: string, issuedAtMs: number): string {
  return `${issuedAtMs}.${signature(secret, slug, key, issuedAtMs)}`
}

export type BookingFormStampProblem = "forged" | "too_fast" | "expired"

/** Why a posted form's stamp isn't good, or null when it is. */
export function bookingFormStampProblem(
  secret: string,
  slug: string,
  key: string,
  stamp: string,
  nowMs: number
): BookingFormStampProblem | null {
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(stamp)
  if (!match) return "forged"
  const issuedAtMs = Number(match[1])
  const expected = Buffer.from(signature(secret, slug, key, issuedAtMs))
  const given = Buffer.from(match[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "forged"
  // A stamp from the future is a clock skew at most; treat it as just made.
  const age = nowMs - issuedAtMs
  if (age > BOOKING_FORM_MAX_AGE_MS) return "expired"
  if (age < BOOKING_FORM_MIN_MS) return "too_fast"
  return null
}

/** The bookingLimits doc id for a count; the values are hashed, so no address or email is stored. */
export function bookingLimitId(kind: BookingLimitKind, workspaceId: string, value: string): string {
  return createHash("sha256").update(`${kind}|${workspaceId}|${value.trim().toLowerCase()}`).digest("base64url")
}

export type BookingLimitCount = { count: number; windowEndsAt: string }

/** The count still in effect at `nowIso` (a window that has ended counts as zero). */
export function currentBookingCount(saved: BookingLimitCount | null, nowIso: string): number {
  if (!saved || saved.windowEndsAt <= nowIso) return 0
  return saved.count
}

/** The count after one more, opening a new window when the last one ended. */
export function nextBookingCount(kind: BookingLimitKind, saved: BookingLimitCount | null, nowIso: string): BookingLimitCount {
  if (!saved || saved.windowEndsAt <= nowIso) {
    return { count: 1, windowEndsAt: new Date(Date.parse(nowIso) + BOOKING_LIMITS[kind].windowMs).toISOString() }
  }
  return { count: saved.count + 1, windowEndsAt: saved.windowEndsAt }
}
