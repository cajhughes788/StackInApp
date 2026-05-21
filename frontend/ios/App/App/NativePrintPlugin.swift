import Foundation
import Capacitor
import UIKit

@objc(NativePrintPlugin)
public class NativePrintPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "NativePrintPlugin"
  public let jsName = "NativePrint"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise)
  ]

  @objc func printHtml(_ call: CAPPluginCall) {
    guard let html = call.getString("html"), !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      call.reject("Missing HTML content")
      return
    }

    let jobName = call.getString("jobName") ?? "Document"

    DispatchQueue.main.async {
      let printController = UIPrintInteractionController.shared
      let printInfo = UIPrintInfo(dictionary: nil)
      printInfo.jobName = jobName
      printInfo.outputType = .general

      printController.printInfo = printInfo
      printController.showsNumberOfCopies = true
      printController.printFormatter = UIMarkupTextPrintFormatter(markupText: html)

      printController.present(animated: true) { _, completed, error in
        if let error {
          call.reject("Unable to print document", nil, error)
          return
        }

        call.resolve([
          "completed": completed
        ])
      }
    }
  }
}
