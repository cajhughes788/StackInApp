import Foundation
import Capacitor
import FirebaseMessaging

extension Notification.Name {
  static let fcmTokenReceived = Notification.Name("fcmTokenReceived")
}

// Bridges the FCM registration token (see AppDelegate's MessagingDelegate
// conformance) to JS. @capacitor/push-notifications only ever exposes the
// raw APNs token on iOS, which the backend's admin.messaging() calls cannot
// use directly — this plugin is what frontend/lib/push/registerPush.ts
// actually listens to for the token it sends to registerDeviceToken.
@objc(FcmTokenPlugin)
public class FcmTokenPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "FcmTokenPlugin"
  public let jsName = "FcmToken"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise)
  ]

  private var latestToken: String?

  override public func load() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleTokenReceived(_:)),
      name: .fcmTokenReceived,
      object: nil
    )
    // Covers the case where Firebase already had a cached token before this
    // plugin's listener was registered.
    if let cachedToken = Messaging.messaging().fcmToken {
      latestToken = cachedToken
    }
  }

  @objc private func handleTokenReceived(_ notification: Notification) {
    guard let token = notification.object as? String else { return }
    latestToken = token
    notifyListeners("fcmTokenReceived", data: ["token": token])
  }

  @objc public func getToken(_ call: CAPPluginCall) {
    guard let token = latestToken else {
      call.resolve([:])
      return
    }
    call.resolve(["token": token])
  }
}
