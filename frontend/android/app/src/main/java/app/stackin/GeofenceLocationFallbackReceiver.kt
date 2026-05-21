package app.stackin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.LocationResult
import org.json.JSONObject

class GeofenceLocationFallbackReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val result = LocationResult.extractResult(intent)
        if (result == null) {
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "location_fallback_update_missing",
                level = "error",
                fields = JSONObject().apply {
                    put("action", intent.action ?: "")
                }
            )
            return
        }

        val location = result.lastLocation
        if (location == null) {
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "location_fallback_location_missing",
                level = "error",
                fields = JSONObject().apply {
                    put("action", intent.action ?: "")
                    put("locationCount", result.locations.size)
                }
            )
            return
        }

        GeofenceBroadcastReceiver.processLocationFallbackUpdate(
            context,
            location,
            "location_fallback:receiver"
        )
    }
}
