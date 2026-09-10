import Foundation
import Capacitor
import FirebaseCore
import FirebaseAppCheck

// The provider factory must be set before FirebaseApp.configure() runs (see
// AppDelegate.swift), which is well before this plugin — or any Capacitor
// plugin — loads. iOS 15 is this project's minimum deployment target (see
// Podfile), so App Attest (iOS 14+) is always available; no DeviceCheck
// fallback is needed.
public class StackInAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
  public func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
    return AppAttestProvider(app: app)
  }
}

// Bridges Firebase App Check tokens to JS — see
// frontend/lib/appCheck/registerAppCheck.ts, which attaches the token as the
// X-Firebase-AppCheck header on every backend request (verified server-side
// in withCorsAuth.ts, currently monitor-only).
@objc(AppCheckPlugin)
public class AppCheckPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AppCheckPlugin"
  public let jsName = "StackInAppCheck"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise)
  ]

  @objc public func getToken(_ call: CAPPluginCall) {
    AppCheck.appCheck().token(forcingRefresh: false) { token, error in
      if let error = error {
        call.reject(error.localizedDescription)
        return
      }
      guard let token = token else {
        call.reject("No App Check token returned")
        return
      }
      call.resolve(["token": token.token])
    }
  }
}
