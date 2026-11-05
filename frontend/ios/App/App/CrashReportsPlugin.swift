import Foundation
import Capacitor
import FirebaseCrashlytics

enum CrashReports {
  // Reports go out from App Store / TestFlight builds only. A debug build
  // (Xcode, the Simulator) sends them only when launched with
  // CRASH_REPORTS_IN_DEBUG=1, for checking the setup. Crashlytics remembers
  // this setting between launches, so it's set every time.
  static func start() {
    #if DEBUG
    let enabled = ProcessInfo.processInfo.environment["CRASH_REPORTS_IN_DEBUG"] == "1"
    #else
    let enabled = true
    #endif
    Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(enabled)
  }
}

// Sends errors from the web app to Crashlytics as non-fatal reports — see
// frontend/lib/crashReports.ts, which scrubs them first. Crashes of the app
// itself are caught by Crashlytics on its own.
@objc(CrashReportsPlugin)
public class CrashReportsPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "CrashReportsPlugin"
  public let jsName = "CrashReports"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "recordError", returnType: CAPPluginReturnPromise),
  ]

  @objc public func recordError(_ call: CAPPluginCall) {
    let kind = call.getString("kind") ?? "error"
    let message = call.getString("message") ?? "Unknown error"
    let crashlytics = Crashlytics.crashlytics()
    crashlytics.setCustomValue(call.getString("screen") ?? "", forKey: "screen")
    let exception = ExceptionModel(name: kind, reason: message)
    exception.stackTrace = (call.getArray("frames", JSObject.self) ?? []).map { frame in
      StackFrame(
        symbol: frame["symbol"] as? String ?? "?",
        file: frame["file"] as? String ?? "?",
        line: frame["line"] as? Int ?? 0
      )
    }
    crashlytics.record(exceptionModel: exception)
    call.resolve()
  }
}
