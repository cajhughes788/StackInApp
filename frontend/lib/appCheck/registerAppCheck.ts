import { Capacitor, registerPlugin } from "@capacitor/core"
import { debugError } from "@/lib/debugLoop"

// Custom native plugin (see frontend/ios/App/App/AppCheckPlugin.swift)
// instead of @capacitor-firebase/app-check — that package's last version
// supporting Capacitor 7 pulls Firebase iOS SDK 11.x, which conflicts with
// the Firebase 12.x already locked in by Firebase/Messaging (FcmTokenPlugin)
// in this project's Podfile. The provider factory (App Attest, since this
// project's iOS 15 minimum deployment target means DeviceCheck is never
// needed) is registered natively at launch in AppDelegate.swift, before
// FirebaseApp.configure() runs — there's no separate JS-triggered
// initialization step.
interface StackInAppCheckPlugin {
  getToken(): Promise<{ token?: string }>
}

const StackInAppCheck = registerPlugin<StackInAppCheckPlugin>("StackInAppCheck")

// Android isn't wired up yet (no Play Integrity provider registered
// natively), matching this project's existing "iOS-only for this pass"
// pattern for push notifications (see registerPush.ts).
function isSupportedPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
}

// Best-effort — a missing/failed App Check token should never block an API
// call while server-side enforcement is off (see withCorsAuth.ts's
// monitor-only check). Returns null rather than throwing so callers can
// simply omit the header on failure.
export async function getAppCheckToken(): Promise<string | null> {
  if (!isSupportedPlatform()) return null
  try {
    const result = await StackInAppCheck.getToken()
    return result.token ?? null
  } catch (error) {
    debugError("app-check", "get_token_failed", {
      reason: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
