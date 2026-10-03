import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { CONTENT_LOG_SECRET } from "../secrets"
import { postContentLogRow, type ContentLogRow } from "../lib/signupAttribution"

// Posts each new signup's attribution row (queued by routes/signup.ts) to
// the StackIn Content Log sheet. Runs as its own background function so the
// webhook can never slow down or fail the signup request itself.
export const sendContentLogSignupRow = onDocumentCreated(
  {
    document: "contentLogSignups/{uid}",
    secrets: [CONTENT_LOG_SECRET],
    region: "us-central1",
    timeoutSeconds: 30,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const row = (snapshot.get("row") ?? {}) as Partial<ContentLogRow>
    const result = await postContentLogRow({
      url: process.env.CONTENT_LOG_WEBHOOK_URL,
      secret: CONTENT_LOG_SECRET.value(),
      row,
    })

    if (result.status === "failed") {
      console.error("[sendContentLogSignupRow] webhook_failed", { error: result.error })
    }

    await snapshot.ref.set(
      {
        contentLogNotification: {
          ...result,
          updatedAt: Date.now(),
        },
      },
      { merge: true }
    )
  }
)
