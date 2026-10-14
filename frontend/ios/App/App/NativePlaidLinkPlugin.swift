import Foundation
import Capacitor
import LinkKit

// Runs Plaid Link with Plaid's native iOS SDK (LinkKit) instead of a web
// page in an in-app browser — see frontend/lib/mobile/nativePlaidLink.ts and
// frontend/components/plaid-connect-button.tsx.
//
// Two steps, so Link is already loaded by the time the user taps:
//   preload({ token }) — creates the LinkKit session right away. Plaid starts
//     loading Link as soon as a session exists.
//   open({ token })    — shows that session (or creates one, if preload
//     wasn't called for this token) and resolves once the user finishes:
//     { status: "success", publicToken, institutionId, accounts } or
//     { status: "exit", errorMessage? }.
//
// A link token can only be used for one Link session, so the session is
// dropped after every open, and JS fetches a fresh token for the next one.
//
// Bank OAuth returns come back through the Universal Link registered as the
// token's redirect_uri (see PLAID_NATIVE_IOS_REDIRECT_URI in plaidService.ts
// and App.entitlements). LinkKit 6+ resumes from that on its own, with no
// continue(from:) call needed here.
@objc(NativePlaidLinkPlugin)
public class NativePlaidLinkPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "NativePlaidLinkPlugin"
  public let jsName = "NativePlaidLink"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "preload", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
  ]

  // Only touched on the main thread.
  private var session: PlaidLinkSession?
  private var sessionToken: String?
  private var pendingOpenCall: CAPPluginCall?
  // An onExit can arrive while preloading (e.g. an invalid or expired
  // token) before anyone has called open(). Kept so a later open() for the
  // same token reports it instead of showing a session that already failed.
  private var preloadExitMessage: String?

  @objc func preload(_ call: CAPPluginCall) {
    guard let token = call.getString("token"), !token.isEmpty else {
      call.reject("Missing token")
      return
    }
    DispatchQueue.main.async {
      // Never replace a session the user is looking at right now.
      if self.pendingOpenCall != nil {
        call.resolve()
        return
      }
      do {
        try self.createSession(token: token)
        call.resolve()
      } catch {
        call.reject(error.localizedDescription)
      }
    }
  }

  @objc func open(_ call: CAPPluginCall) {
    guard let token = call.getString("token"), !token.isEmpty else {
      call.reject("Missing token")
      return
    }
    DispatchQueue.main.async {
      if self.pendingOpenCall != nil {
        call.reject("Plaid Link is already open")
        return
      }
      if self.sessionToken != token || self.session == nil {
        do {
          try self.createSession(token: token)
        } catch {
          call.reject(error.localizedDescription)
          return
        }
      }
      if let message = self.preloadExitMessage {
        self.clearSession()
        call.resolve(["status": "exit", "errorMessage": message])
        return
      }
      guard let session = self.session, let viewController = self.bridge?.viewController else {
        self.clearSession()
        call.reject("Unable to present Plaid Link")
        return
      }
      call.keepAlive = true
      self.pendingOpenCall = call
      session.open(using: .viewController(viewController))
    }
  }

  private func createSession(token: String) throws {
    clearSession()
    let configuration = LinkTokenConfiguration(
      token: token,
      onSuccess: { [weak self] success in
        DispatchQueue.main.async {
          let accounts: [[String: Any]] = success.metadata.accounts.map { account in
            ["name": account.name, "mask": account.mask ?? NSNull()]
          }
          self?.finish(token: token, result: [
            "status": "success",
            "publicToken": success.publicToken,
            "institutionId": success.metadata.institution.id,
            "accounts": accounts,
          ])
        }
      },
      onExit: { [weak self] exit in
        DispatchQueue.main.async {
          var result: [String: Any] = ["status": "exit"]
          if let error = exit.error {
            result["errorMessage"] = error.displayMessage ?? error.errorMessage
          }
          self?.finish(token: token, result: result)
        }
      },
      onEvent: nil,
      onLoad: nil
    )
    session = try Plaid.createPlaidLinkSession(configuration: configuration)
    sessionToken = token
  }

  private func finish(token: String, result: [String: Any]) {
    // A late callback from a session that's since been replaced.
    guard sessionToken == token else { return }
    guard let call = pendingOpenCall else {
      // Exited during preload, before open() — remember it for open().
      if result["status"] as? String == "exit" {
        preloadExitMessage = (result["errorMessage"] as? String) ?? "Plaid Link couldn't load"
      }
      return
    }
    pendingOpenCall = nil
    clearSession()
    call.resolve(result)
    bridge?.releaseCall(call)
  }

  private func clearSession() {
    session = nil
    sessionToken = nil
    preloadExitMessage = nil
  }
}
