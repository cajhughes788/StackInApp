import { registerPlugin } from "@capacitor/core"

// Native bridge (see frontend/ios/App/App/FcmTokenPlugin.swift) that
// converts the raw APNs device token from @capacitor/push-notifications into
// an FCM registration token via FirebaseMessaging — the backend's
// admin.messaging() calls only accept FCM tokens, not raw APNs tokens.
export type FcmTokenReceivedEvent = { token: string }

type FcmTokenPlugin = {
  getToken(): Promise<{ token?: string }>
  addListener(
    eventName: "fcmTokenReceived",
    listenerFunc: (event: FcmTokenReceivedEvent) => void
  ): Promise<{ remove: () => void }>
}

export const FcmToken = registerPlugin<FcmTokenPlugin>("FcmToken")
