import { db, messaging } from "../admin"
import { DeviceTokenSchema, type DeviceTokenType } from "@shared/schemas/deviceToken"

function deviceTokensCol(uid: string) {
  return db.collection("users").doc(uid).collection("deviceTokens")
}

export async function registerDeviceToken(
  uid: string,
  fcmToken: string,
  platform: "ios" | "android" | "web",
  appVersion?: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const ref = deviceTokensCol(uid).doc(fcmToken)
  const existing = await ref.get()
  const canonical: DeviceTokenType = {
    id: fcmToken,
    uid,
    fcmToken,
    platform,
    appVersion,
    createdAt: existing.exists ? (existing.data()?.createdAt ?? nowIso) : nowIso,
    updatedAt: nowIso,
  }
  await ref.set(DeviceTokenSchema.parse(canonical), { merge: true })
}

export async function sendTransactionNotification(
  uid: string,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<void> {
  const snap = await deviceTokensCol(uid).get()
  if (snap.empty) {
    console.warn("pushNotificationService.sendTransactionNotification: no device tokens registered, nothing sent", { uid })
    return
  }

  const tokens = snap.docs.map((doc) => doc.id)
  // Explicit apns-topic (the app's real bundle id) instead of letting FCM
  // infer it from the token — avoids any ambiguity if this Firebase project
  // ever has more than one Apple app registered.
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    apns: {
      headers: { "apns-topic": "com.cajetanhughes.stackin" },
    },
  })

  const staleTokens: string[] = []
  response.responses.forEach((result, index) => {
    if (!result.success && result.error?.code === "messaging/registration-token-not-registered") {
      staleTokens.push(tokens[index])
    }
  })
  if (staleTokens.length > 0) {
    await Promise.all(staleTokens.map((token) => deviceTokensCol(uid).doc(token).delete()))
  }

  console.info("pushNotificationService.sendTransactionNotification: send complete", {
    uid,
    tokenCount: tokens.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
    failures: response.responses.map((result, index) => {
      if (result.success) return null
      const error = result.error
      return {
        token: tokens[index].slice(0, 20) + "...",
        code: error?.code,
        message: error?.message,
        // Captures any additional properties FirebaseMessagingError attaches
        // beyond code/message (e.g. underlying APNs response details) that
        // wouldn't otherwise survive a plain console.info of the object.
        raw: error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : null,
      }
    }).filter(Boolean),
  })
}
