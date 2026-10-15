import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { FcmToken } from "@/plugins/FcmToken"
import { registerDeviceToken } from "@/lib/api/devicesApi"
import { debugError, debugLog } from "@/lib/debugLoop"
import { deepLinkRequestFromPushData, useDeepLinkStore } from "@/lib/push/deepLinkStore"

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

    // Tapping a notification (see pushNotificationService.ts's data) lands
    // on the right workspace and tab with the review list open: expense and
    // refund reviews on Expenses, deposits on Income, "reconnect your bank"
    // on the Bank connections page. This only records the request — no
    // window.location navigation, which reboots the native app through the
    // landing page and loses the destination (see deepLinkStore.ts).
    // DeepLinkHandler performs it once the workspace list is ready. Capacitor
    // retains a tap that launched the app until this listener is attached.
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const request = deepLinkRequestFromPushData(action.notification.data)
      debugLog("push-notifications", "action_performed", {
        deepLink: action.notification.data?.deepLink ?? null,
        workspaceId: action.notification.data?.workspaceId ?? null,
        recognized: request !== null,
      })
      if (request) useDeepLinkStore.getState().request(request)
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
