// /functions/src/routes/signup.ts
// Converted from Next.js API route → Firebase v2 HTTPS function
// Long-term maintainable structure with plain handler + function export
import type { Request, Response } from "express"
import { FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { auth, db } from "../admin"

const CURRENT_LEGAL_CONSENT_VERSION = "2026-04-27"
const CURRENT_TERMS_VERSION = "2026-04-27"
const CURRENT_PRIVACY_VERSION = "2026-04-27"

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const LegalConsentSchema = z.object({
  version: z.literal(CURRENT_LEGAL_CONSENT_VERSION),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
  privacyVersion: z.literal(CURRENT_PRIVACY_VERSION),
  acceptedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "acceptedAt must be a valid ISO timestamp",
  }),
  userAgent: z.string().trim().min(1).max(2000),
  source: z.literal("web-signup"),
})

const SignupSchema = z.object({
  idToken: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  legalConsent: LegalConsentSchema,
})

// ---------------------------------------------------------------------------
// Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function signupHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const parsed = SignupSchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "Invalid request body",
        details: parsed.error.flatten(),
        expectedLegalConsent: {
          version: CURRENT_LEGAL_CONSENT_VERSION,
          termsVersion: CURRENT_TERMS_VERSION,
          privacyVersion: CURRENT_PRIVACY_VERSION,
          source: "web-signup",
        },
      })
      return
    }

    const {
      idToken,
      email: emailFromPayload,
      phone,
      legalConsent,
    } = parsed.data

    const safePhone = phone?.trim() || null

    const decoded = await auth.verifyIdToken(idToken)
    const uid = decoded.uid
    const email = decoded.email ?? emailFromPayload

    if (!email) {
      res.status(400).json({ ok: false, error: "Missing email" })
      return
    }

    const userRef = db.collection("users").doc(uid)
    const consentRef = userRef.collection("consent").doc("userAgreement")
    const now = FieldValue.serverTimestamp()

    const batch = db.batch()

    batch.set(
      userRef,
      {
        uid,
        email,
        phone: safePhone,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    )

    batch.set(
      consentRef,
      {
        agreed: true,
        version: legalConsent.version,
        termsVersion: legalConsent.termsVersion,
        privacyVersion: legalConsent.privacyVersion,
        acceptedAt: now,
        clientAcceptedAt: legalConsent.acceptedAt,
        userAgent: legalConsent.userAgent,
        requestUserAgent: req.get("user-agent") ?? null,
        source: legalConsent.source,
        origin: req.get("origin") ?? null,
        emailAtAcceptance: email,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    )

    await batch.commit()

    res.status(200).json({
      ok: true,
      message: "User registered successfully",
      uid,
      email,
      legalConsent: {
        recorded: true,
        version: legalConsent.version,
        termsVersion: legalConsent.termsVersion,
        privacyVersion: legalConsent.privacyVersion,
      },
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: "Internal server error" })
  }
}
