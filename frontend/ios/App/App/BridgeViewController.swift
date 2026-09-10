import UIKit
import Capacitor

class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()

        bridge?.registerPluginInstance(NativeGeofencePlugin())
        bridge?.registerPluginInstance(NativePlacePickerPlugin())
        bridge?.registerPluginInstance(NativePrintPlugin())
        bridge?.registerPluginInstance(AppCheckPlugin())

        // WKWebView's own pinch gesture recognizer can zoom the page even
        // when the HTML viewport meta tag says user-scalable=no — the meta
        // tag only governs Safari/mobile-web zoom, not this native gesture.
        // Disabling it here is what actually stops in-app pinch-zoom (and
        // the "stuck zoomed in with no way back out" symptom that came with
        // it) instead of relying on the meta tag alone.
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
