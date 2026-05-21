import UIKit
import Capacitor

class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()

        bridge?.registerPluginInstance(NativeGeofencePlugin())
        bridge?.registerPluginInstance(NativePlacePickerPlugin())
        bridge?.registerPluginInstance(NativePrintPlugin())
    }
}
