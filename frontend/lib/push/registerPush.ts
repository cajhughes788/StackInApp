import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { FcmToken } from "@/plugins/FcmToken"
import { registerDeviceToken } from "@/lib/api/devicesApi"
import { debugError, debugLog } from "@/lib/debugLoop"

let hasRegistered = false

// iOS-only for this pass — Android FCM setup (google-services.json, manifest
// changes) is a follow-up using the same backend registerDeviceToken route.
//
// @capacitor/push-notifications only ever exposes the raw APNs device token
// on iOS, and the backend's admin.messaging() calls need an FCM registration
// token instead. PushNotifications.register() below is still what triggers
// the OS permission prompt and registerForRemoteNotifications() — but the
// actual token we send to the backend comes from FcmTokenPlugin.swift, which
// bridges the APNs token into an FCM token via native FirebaseMessaging.
export async function registerPushNotifications(): Promise<void> {
  if (hasRegistered) return
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return
  hasRegistered = true

  try {
    const permission = await PushNotifications.requestPermissions()
    if (permission.receive !== "granted") {
      debugLog("push-notifications", "permission_denied", {})
      return
    }

    FcmToken.addListener("fcmTokenReceived", (event) => {
      registerDeviceToken(event.token, "ios").catch((error) => {
        debugError("push-notifications", "register_device_token_failed", {
          reason: error instanceof Error ? error.message : String(error),
        })
      })
    })

    PushNotifications.addListener("registrationError", (error) => {
      debugError("push-notifications", "registration_error", { error: String(error) })
    })

    // Tapping a transaction notification (see pushNotificationService.ts's
    // data.deepLink) should land the user on the Expenses tab where pending
    // transactions are reviewed, not wherever the app happened to be left.
    // A hard navigation (window.location.href) is used rather than the
    // Next.js router since this runs outside any component's render tree.
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const deepLink = action.notification.data?.deepLink as string | undefined
      if (typeof deepLink === "string" && deepLink.startsWith("stackin://plaid/pending/")) {
        // openReview=1 tells plaid-pending-transactions-panel.tsx to skip its
        // own auto-collapse-when-many-pending behavior — tapping a "review
        // your new transactions" notification should always land on an
        // already-expanded list, not a collapsed one.
        window.location.href = "/app/home?mode=expenses&openReview=1"
      } else if (typeof deepLink === "string" && deepLink.startsWith("stackin://plaid/reconnect")) {
        // "Reconnect your bank" (flagStalePlaidItemsDaily.ts) — land
        // straight on the account page, where the broken connection already
        // shows "Connection needs attention" plus a Reconnect button
        // (plaid-connect-button.tsx), instead of leaving the user to find
        // Settings on their own.
        window.location.href = "/app/account"
      }
    })

    await PushNotifications.register()

    const existing = await FcmToken.getToken()
    if (existing.token) {
      await registerDeviceToken(existing.token, "ios")
    }
  } catch (error) {
    debugError("push-notifications", "register_failed", {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
