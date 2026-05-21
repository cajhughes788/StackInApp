import Foundation
import Capacitor
import CoreLocation
import UserNotifications

@objc(NativeGeofencePlugin)
public class NativeGeofencePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
  public let identifier = "NativeGeofencePlugin"
  public let jsName = "NativeGeofence"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "syncWorkspaceEntryStatus", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "removeAllGeofences", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "syncGeofences", returnType: CAPPluginReturnPromise)
  ]

  private let manager = CLLocationManager()
  private let geofenceStoreKey = "stackin.nativeGeofences"
  private let entryStatusStoreKey = "stackin.nativeGeofenceEntryStatus"
  private var lastSyncStartedAt: Date?
  private var pendingPermissionCall: CAPPluginCall?
  private var pendingNotificationGranted: Bool?
  private var pendingPermissionStage: PermissionRequestStage?

  override public func load() {
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    NSLog("[NativeGeofencePlugin] load complete")
  }

  @objc override public func requestPermissions(_ call: CAPPluginCall) {
    NSLog("[NativeGeofencePlugin] requestPermissions invoked")
    DispatchQueue.main.async {
      self.pendingPermissionCall = call
      self.pendingNotificationGranted = nil
      self.pendingPermissionStage = nil

      let status = self.manager.authorizationStatus
      switch status {
      case .notDetermined:
        self.pendingPermissionStage = .requestingWhenInUse
        self.manager.requestWhenInUseAuthorization()
      case .authorizedWhenInUse:
        self.pendingPermissionStage = .requestingAlways
        self.manager.requestAlwaysAuthorization()
      default:
        self.pendingPermissionStage = .resolving
      }

      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
        self.resolveNotificationStatus { notificationGranted in
          self.pendingNotificationGranted = notificationGranted
          self.resolvePendingPermissionCallIfPossible()
        }
      }
    }
  }

  @objc func getStatus(_ call: CAPPluginCall) {
    let status = manager.authorizationStatus
    NSLog("[NativeGeofencePlugin] getStatus invoked monitored=%lu", manager.monitoredRegions.count)
    resolveNotificationStatus { notificationGranted in
      NSLog(
        "[NativeGeofencePlugin] getStatus resolved granted=%@ background=%@ notifications=%@ monitored=%lu",
        self.isAuthorized(status).description,
        self.isBackgroundAuthorized(status).description,
        notificationGranted.description,
        self.manager.monitoredRegions.count
      )
      call.resolve([
        "granted": self.isAuthorized(status),
        "backgroundGranted": self.isBackgroundAuthorized(status),
        "notificationGranted": notificationGranted,
        "monitoredCount": self.manager.monitoredRegions.count
      ])
    }
  }

  @objc func syncWorkspaceEntryStatus(_ call: CAPPluginCall) {
    let statuses = call.getArray("statuses", JSObject.self) ?? []
    NSLog("[NativeGeofencePlugin] syncWorkspaceEntryStatus invoked count=%lu payload=%@", statuses.count, "\(statuses)")
    UserDefaults.standard.set(statuses, forKey: entryStatusStoreKey)
    call.resolve([
      "ok": true,
      "count": statuses.count
    ])
  }

  @objc func removeAllGeofences(_ call: CAPPluginCall) {
    NSLog("[NativeGeofencePlugin] removeAllGeofences invoked monitored=%lu", manager.monitoredRegions.count)
    for region in manager.monitoredRegions {
      manager.stopMonitoring(for: region)
    }

    UserDefaults.standard.removeObject(forKey: geofenceStoreKey)
    NSLog("[NativeGeofencePlugin] removeAllGeofences completed")
    call.resolve(["ok": true])
  }

  @objc func syncGeofences(_ call: CAPPluginCall) {
    guard let geofences = call.getArray("geofences", JSObject.self) else {
      call.reject("Missing geofences array")
      return
    }

    lastSyncStartedAt = Date()
    NSLog("[NativeGeofencePlugin] syncGeofences invoked count=%lu payload=%@", geofences.count, "\(geofences)")

    for region in manager.monitoredRegions {
      manager.stopMonitoring(for: region)
    }

    var saved: [[String: Any]] = []

    for geofence in geofences {
      guard
        let id = geofence["id"] as? String,
        let latitude = geofence["latitude"] as? Double,
        let longitude = geofence["longitude"] as? Double,
        let radiusMeters = geofence["radiusMeters"] as? Double
      else {
        continue
      }

      let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
      let radius = min(max(radiusMeters, 50), manager.maximumRegionMonitoringDistance)
      let region = CLCircularRegion(center: center, radius: radius, identifier: id)
      region.notifyOnEntry = true
      region.notifyOnExit = true
      NSLog(
        "[NativeGeofencePlugin] startMonitoring id=%@ lat=%f lon=%f requestedRadius=%f appliedRadius=%f trigger=%@",
        id,
        latitude,
        longitude,
        radiusMeters,
        radius,
        (geofence["trigger"] as? String) ?? "unknown"
      )
      manager.startMonitoring(for: region)
      manager.requestState(for: region)
      saved.append(geofence)
    }

    UserDefaults.standard.set(saved, forKey: geofenceStoreKey)
    NSLog("[NativeGeofencePlugin] syncGeofences completed saved=%lu monitored=%lu", saved.count, manager.monitoredRegions.count)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
      guard let self else { return }
      let identifiers = self.manager.monitoredRegions.map(\.identifier).sorted()
      NSLog(
        "[NativeGeofencePlugin] syncGeofences post-check monitored=%lu identifiers=%@ secondsSinceSyncStart=%.3f",
        self.manager.monitoredRegions.count,
        "\(identifiers)",
        self.lastSyncStartedAt.map { Date().timeIntervalSince($0) } ?? -1
      )
    }
    call.resolve([
      "ok": true,
      "count": saved.count
    ])
  }

  public func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
    NSLog(
      "[NativeGeofencePlugin] didStartMonitoringFor id=%@ monitored=%lu circular=%@",
      region.identifier,
      manager.monitoredRegions.count,
      (region is CLCircularRegion).description
    )
    if let circularRegion = region as? CLCircularRegion {
      NSLog(
        "[NativeGeofencePlugin] didStartMonitoringFor details id=%@ lat=%f lon=%f radius=%f notifyOnEntry=%@ notifyOnExit=%@",
        circularRegion.identifier,
        circularRegion.center.latitude,
        circularRegion.center.longitude,
        circularRegion.radius,
        circularRegion.notifyOnEntry.description,
        circularRegion.notifyOnExit.description
      )
    }
  }

  public func locationManager(
    _ manager: CLLocationManager,
    monitoringDidFailFor region: CLRegion?,
    withError error: Error
  ) {
    let nsError = error as NSError
    NSLog(
      "[NativeGeofencePlugin] monitoringDidFailFor id=%@ domain=%@ code=%ld description=%@ monitored=%lu",
      region?.identifier ?? "nil",
      nsError.domain,
      nsError.code,
      nsError.localizedDescription,
      manager.monitoredRegions.count
    )
  }

  public func locationManager(
    _ manager: CLLocationManager,
    didDetermineState state: CLRegionState,
    for region: CLRegion
  ) {
    let stateLabel: String
    switch state {
    case .inside:
      stateLabel = "inside"
    case .outside:
      stateLabel = "outside"
    case .unknown:
      stateLabel = "unknown"
    @unknown default:
      stateLabel = "unrecognized"
    }

    NSLog(
      "[NativeGeofencePlugin] didDetermineState id=%@ state=%@ monitored=%lu",
      region.identifier,
      stateLabel,
      manager.monitoredRegions.count
    )
  }

  public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    NSLog("[NativeGeofencePlugin] didEnterRegion id=%@", region.identifier)
    emitTrigger(for: region.identifier, trigger: "arrive")
  }

  public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    NSLog("[NativeGeofencePlugin] didExitRegion id=%@", region.identifier)
    emitTrigger(for: region.identifier, trigger: "leave")
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    NSLog(
      "[NativeGeofencePlugin] authorization changed granted=%@ background=%@",
      isAuthorized(manager.authorizationStatus).description,
      isBackgroundAuthorized(manager.authorizationStatus).description
    )
    resolvePendingPermissionCallIfPossible()
    notifyListeners("geofenceAuthorizationChanged", data: [
      "granted": isAuthorized(manager.authorizationStatus),
      "backgroundGranted": isBackgroundAuthorized(manager.authorizationStatus)
    ])
  }

  private func emitTrigger(for identifier: String, trigger: String) {
    guard
      let geofences = UserDefaults.standard.array(forKey: geofenceStoreKey) as? [[String: Any]],
      let geofence = geofences.first(where: { ($0["id"] as? String) == identifier }),
      let workspaceId = geofence["workspaceId"] as? String,
      let reminderId = geofence["reminderId"] as? String,
      let configuredTrigger = geofence["trigger"] as? String,
      configuredTrigger == trigger
    else {
      NSLog("[NativeGeofencePlugin] emitTrigger skipped id=%@ trigger=%@", identifier, trigger)
      return
    }

    NSLog(
      "[NativeGeofencePlugin] emitTrigger id=%@ workspace=%@ reminder=%@ trigger=%@",
      identifier,
      workspaceId,
      reminderId,
      trigger
    )
    scheduleNotification(for: geofence, identifier: identifier, trigger: trigger)
    notifyListeners("geofenceTriggered", data: [
      "id": identifier,
      "workspaceId": workspaceId,
      "reminderId": reminderId,
      "trigger": trigger
    ])
  }

  private func isAuthorized(_ status: CLAuthorizationStatus) -> Bool {
    status == .authorizedAlways || status == .authorizedWhenInUse
  }

  private func isBackgroundAuthorized(_ status: CLAuthorizationStatus) -> Bool {
    status == .authorizedAlways
  }

  private func resolveNotificationStatus(
    completion: @escaping (Bool) -> Void
  ) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      completion(settings.authorizationStatus == .authorized)
    }
  }

  private func resolvePendingPermissionCallIfPossible() {
    guard let call = pendingPermissionCall else {
      return
    }

    let status = manager.authorizationStatus
    guard let notificationGranted = pendingNotificationGranted else {
      return
    }

    switch pendingPermissionStage {
    case .requestingWhenInUse:
      guard status != .notDetermined else {
        return
      }

      if status == .authorizedWhenInUse {
        pendingPermissionStage = .requestingAlways
        DispatchQueue.main.async {
          self.manager.requestAlwaysAuthorization()
        }
        return
      }

    case .requestingAlways:
      guard status != .notDetermined else {
        return
      }

    case .resolving, .none:
      guard status != .notDetermined else {
        return
      }
    }

    NSLog(
      "[NativeGeofencePlugin] requestPermissions resolved granted=%@ background=%@ notifications=%@",
      isAuthorized(status).description,
      isBackgroundAuthorized(status).description,
      notificationGranted.description
    )
    call.resolve([
      "granted": isAuthorized(status),
      "backgroundGranted": isBackgroundAuthorized(status),
      "notificationGranted": notificationGranted
    ])
    pendingPermissionCall = nil
    pendingNotificationGranted = nil
    pendingPermissionStage = nil
  }

  private enum PermissionRequestStage {
    case requestingWhenInUse
    case requestingAlways
    case resolving
  }

  private func scheduleNotification(
    for geofence: [String: Any],
    identifier: String,
    trigger: String
  ) {
    let deliveryMode = (geofence["deliveryMode"] as? String) ?? "if_no_entry"
    let workspaceId = (geofence["workspaceId"] as? String) ?? ""
    let workspaceName = (geofence["workspaceName"] as? String) ?? "your"
    let reminderLabel = (geofence["label"] as? String) ?? "your location"

    if deliveryMode == "if_no_entry" && workspaceHasEntryToday(workspaceId: workspaceId) {
      NSLog("[NativeGeofencePlugin] scheduleNotification skipped existing entry workspace=%@", workspaceId)
      return
    }

    resolveNotificationStatus { notificationGranted in
      guard notificationGranted else {
        NSLog("[NativeGeofencePlugin] scheduleNotification skipped notifications disabled")
        return
      }

      let content = UNMutableNotificationContent()
      content.title = trigger == "leave"
        ? "You have left \(reminderLabel)"
        : "You have arrived at \(reminderLabel)"
      content.body = "Add your entry for today for your \(workspaceName) workspace"
      content.sound = .default
      content.userInfo = [
        "workspaceId": workspaceId,
        "reminderId": (geofence["reminderId"] as? String) ?? "",
        "trigger": trigger,
        "kind": "entry-location-reminder"
      ]

      let request = UNNotificationRequest(
        identifier: "geofence-notification:\(identifier):\(trigger)",
        content: content,
        trigger: nil
      )

      UNUserNotificationCenter.current().add(request) { error in
        if let error {
          NSLog("[NativeGeofencePlugin] scheduleNotification failed error=%@", error.localizedDescription)
          return
        }

        NSLog(
          "[NativeGeofencePlugin] scheduleNotification queued id=%@ workspace=%@ trigger=%@",
          identifier,
          workspaceId,
          trigger
        )
      }
    }
  }

  private func workspaceHasEntryToday(workspaceId: String) -> Bool {
    guard
      let statuses = UserDefaults.standard.array(forKey: entryStatusStoreKey) as? [[String: Any]]
    else {
      return false
    }

    let today = ISO8601DateFormatter().string(from: Date()).prefix(10)

    return statuses.contains { status in
      (status["workspaceId"] as? String) == workspaceId
        && (status["dateKey"] as? String) == String(today)
        && ((status["hasEntryToday"] as? Bool) ?? false)
    }
  }
}
