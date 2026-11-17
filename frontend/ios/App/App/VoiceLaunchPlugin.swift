import Foundation
import Capacitor
import AppIntents

// Siri, Shortcuts, Spotlight and the Action Button: "Ask 521", "Log in
// 521", "Add an expense in 521", "Book in 521". Each one opens 521 already
// listening on that screen — the same mics as in the app, so nothing new
// handles anyone's money. Nothing here answers inside Siri: the app does.
//
// How it reaches the app: the intent runs inside 521 (openAppWhenRun),
// records which mic to open, and tells VoiceLaunchPlugin. The app (JS) takes
// it with takePending() when it starts cold, or hears a "launch" event when
// it was already running (components/voice-launch-handler.tsx).
//
// Needs iOS 16 for App Intents; on iOS 15 the phrases just don't exist.

extension Notification.Name {
  static let voiceLaunchRequested = Notification.Name("voiceLaunchRequested")
}

enum VoiceLaunch {
  // Waiting for the app to take it: "ask", "entry", "expense" or "booking".
  static var pending: String?

  static func request(_ target: String) {
    pending = target
    NotificationCenter.default.post(name: .voiceLaunchRequested, object: target)
  }
}

@objc(VoiceLaunchPlugin)
public class VoiceLaunchPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "VoiceLaunchPlugin"
  public let jsName = "VoiceLaunch"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise)
  ]

  private var observer: NSObjectProtocol?

  override public func load() {
    observer = NotificationCenter.default.addObserver(forName: .voiceLaunchRequested, object: nil, queue: .main) { [weak self] note in
      guard let self, let target = note.object as? String else { return }
      // Running already: hand it over now. Otherwise takePending() gets it.
      if self.hasListeners("launch") {
        VoiceLaunch.pending = nil
        self.notifyListeners("launch", data: ["target": target])
      }
    }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
  }

  @objc func takePending(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      let target = VoiceLaunch.pending
      VoiceLaunch.pending = nil
      call.resolve(["target": target ?? NSNull()])
    }
  }
}

// MARK: - The intents

@available(iOS 16.0, *)
struct AskIntent: AppIntent {
  static var title: LocalizedStringResource = "Ask 521"
  static var description = IntentDescription("Opens 521 listening: ask about your money, invoices or appointments, or say something to log.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    VoiceLaunch.request("ask")
    return .result()
  }
}

@available(iOS 16.0, *)
struct LogEntryIntent: AppIntent {
  static var title: LocalizedStringResource = "Log an entry"
  static var description = IntentDescription("Opens Add entry in 521, listening.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    VoiceLaunch.request("entry")
    return .result()
  }
}

@available(iOS 16.0, *)
struct AddExpenseIntent: AppIntent {
  static var title: LocalizedStringResource = "Add an expense"
  static var description = IntentDescription("Opens Add expense in 521, listening.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    VoiceLaunch.request("expense")
    return .result()
  }
}

@available(iOS 16.0, *)
struct BookIntent: AppIntent {
  static var title: LocalizedStringResource = "Book or move an appointment"
  static var description = IntentDescription("Opens Booking in 521, listening.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    VoiceLaunch.request("booking")
    return .result()
  }
}

// The Siri phrases (Siri also accepts close variations). Each must name the app; Siri also matches "five twenty
// one" through INAlternativeAppNames in Info.plist.
@available(iOS 16.0, *)
struct VoiceShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AskIntent(),
      phrases: [
        "Ask \(.applicationName)",
        "Talk to \(.applicationName)",
        "Ask \(.applicationName) a question",
        "Open \(.applicationName) and listen",
        "Check my money in \(.applicationName)",
        "Check my numbers in \(.applicationName)",
        "What did I make in \(.applicationName)",
        "Who owes me in \(.applicationName)",
        "What's on my schedule in \(.applicationName)",
      ]
    )
    AppShortcut(
      intent: LogEntryIntent(),
      phrases: [
        "Log in \(.applicationName)",
        "Add an entry in \(.applicationName)",
        "Log my shift in \(.applicationName)",
        "Add my shift to \(.applicationName)",
        "Log my day in \(.applicationName)",
        "Log a tip in \(.applicationName)",
        "Log my tips in \(.applicationName)",
        "Log income in \(.applicationName)",
        "Add income to \(.applicationName)",
      ]
    )
    AppShortcut(
      intent: AddExpenseIntent(),
      phrases: [
        "Add an expense in \(.applicationName)",
        "Log an expense in \(.applicationName)",
        "Add an expense to \(.applicationName)",
        "Log a receipt in \(.applicationName)",
        "Log gas in \(.applicationName)",
        "Add mileage in \(.applicationName)",
        "Log my miles in \(.applicationName)",
        "Log a purchase in \(.applicationName)",
      ]
    )
    AppShortcut(
      intent: BookIntent(),
      phrases: [
        "Book in \(.applicationName)",
        "Book an appointment in \(.applicationName)",
        "Make an appointment in \(.applicationName)",
        "Schedule a client in \(.applicationName)",
        "Book a client in \(.applicationName)",
        "Reschedule in \(.applicationName)",
        "Move an appointment in \(.applicationName)",
      ]
    )
  }
}
