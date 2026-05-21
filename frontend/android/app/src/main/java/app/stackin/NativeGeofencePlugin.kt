package app.stackin

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ApiException
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(
    name = "NativeGeofence",
    permissions = [
        Permission(
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ],
            alias = "location"
        ),
        Permission(
            strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION],
            alias = "backgroundLocation"
        ),
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = "notifications"
        )
    ]
)
class NativeGeofencePlugin : Plugin() {

    private lateinit var geofencingClient: GeofencingClient
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    override fun load() {
        geofencingClient = LocationServices.getGeofencingClient(context)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
        activeInstance = this
        recordDiagnostic(
            context,
            "plugin_loaded",
            fields = JSONObject().apply {
                put("granted", getPermissionState("location") == PermissionState.GRANTED)
                put("preciseGranted", hasPreciseLocationPermission())
                put("approximateOnly", hasApproximateOnlyPermission())
                put("backgroundGranted", getPermissionState("backgroundLocation") == PermissionState.GRANTED)
                put("notificationGranted", getPermissionState("notifications") == PermissionState.GRANTED)
            }
        )
    }

    override fun handleOnDestroy() {
        if (activeInstance === this) {
            activeInstance = null
        }
        super.handleOnDestroy()
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val locationState = getPermissionState("location")
        val notificationState = getPermissionState("notifications")
        val backgroundState = getPermissionState("backgroundLocation")

        recordDiagnostic(
            context,
            "request_permissions_start",
            fields = JSONObject().apply {
                put("location", locationState.toString())
                put("background", backgroundState.toString())
                put("notifications", notificationState.toString())
            }
        )

        if (
            locationState == PermissionState.GRANTED &&
            backgroundState == PermissionState.GRANTED &&
            notificationState == PermissionState.GRANTED
        ) {
            recordDiagnostic(context, "request_permissions_already_granted", fields = buildPermissionFields())
            call.resolve(buildStatusObject())
            return
        }

        if (locationState != PermissionState.GRANTED) {
            recordDiagnostic(context, "request_permissions_prompt_location", fields = buildPermissionFields())
            requestPermissionForAlias("location", call, "locationPermissionsCallback")
            return
        }

        if (notificationState != PermissionState.GRANTED) {
            recordDiagnostic(context, "request_permissions_prompt_notifications", fields = buildPermissionFields())
            requestPermissionForAlias("notifications", call, "notificationPermissionsCallback")
            return
        }

        if (backgroundState != PermissionState.GRANTED) {
            recordDiagnostic(context, "request_permissions_prompt_background", fields = buildPermissionFields())
            requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionsCallback")
            return
        }

        recordDiagnostic(context, "request_permissions_resolved", fields = buildPermissionFields())
        call.resolve(buildStatusObject())
    }

    @PermissionCallback
    private fun locationPermissionsCallback(call: PluginCall) {
        recordDiagnostic(context, "request_permissions_location_callback", fields = buildPermissionFields())
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.resolve(buildStatusObject())
            return
        }

        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionsCallback")
            return
        }

        if (getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionsCallback")
            return
        }

        call.resolve(buildStatusObject())
    }

    @PermissionCallback
    private fun notificationPermissionsCallback(call: PluginCall) {
        recordDiagnostic(context, "request_permissions_notifications_callback", fields = buildPermissionFields())
        if (getPermissionState("backgroundLocation") != PermissionState.GRANTED &&
            getPermissionState("location") == PermissionState.GRANTED
        ) {
            requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionsCallback")
            return
        }

        call.resolve(buildStatusObject())
    }

    @PermissionCallback
    private fun backgroundPermissionsCallback(call: PluginCall) {
        recordDiagnostic(context, "request_permissions_background_callback", fields = buildPermissionFields())
        call.resolve(buildStatusObject())
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(buildStatusObject())
    }

    @PluginMethod
    fun drainDiagnostics(call: PluginCall) {
        val drained = drainDiagnostics(context)
        val events = JSArray()

        for (index in 0 until drained.length()) {
            events.put(drained.optJSONObject(index))
        }

        call.resolve(
            JSObject().apply {
                put("events", events)
                put("count", events.length())
            }
        )
    }

    @PluginMethod
    fun syncWorkspaceEntryStatus(call: PluginCall) {
        val statuses = call.getArray("statuses") ?: JSArray()
        val payload = JSONArray()

        for (index in 0 until statuses.length()) {
            val item = statuses.optJSONObject(index) ?: continue
            payload.put(item)
        }

        context
            .getSharedPreferences(ENTRY_STATUS_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(ENTRY_STATUS_KEY, payload.toString())
            .apply()

        recordDiagnostic(
            context,
            "entry_status_synced",
            fields = JSONObject().apply {
                put("count", payload.length())
                put("workspaceIds", JSONArray().apply {
                    for (index in 0 until payload.length()) {
                        val item = payload.optJSONObject(index) ?: continue
                        put(item.optString("workspaceId"))
                    }
                })
            }
        )

        call.resolve(
            JSObject().apply {
                put("ok", true)
                put("count", payload.length())
            }
        )
    }

    @PluginMethod
    fun removeAllGeofences(call: PluginCall) {
        recordDiagnostic(context, "remove_all_geofences_start")
        geofencingClient.removeGeofences(getGeofencePendingIntent())
            .addOnSuccessListener {
                removeLocationFallbackUpdates("remove_all_geofences")
                    .addOnSuccessListener {
                        clearStoredGeofences()
                        recordDiagnostic(context, "remove_all_geofences_success")
                        call.resolve(JSObject().put("ok", true))
                    }
                    .addOnFailureListener { err ->
                        recordDiagnostic(
                            context,
                            "remove_all_geofences_location_fallback_remove_failed",
                            level = "error",
                            fields = JSONObject().apply {
                                put("message", err.message ?: "Failed to remove location fallback updates")
                            }
                        )
                        clearStoredGeofences()
                        recordDiagnostic(context, "remove_all_geofences_success")
                        call.resolve(JSObject().put("ok", true))
                    }
            }
            .addOnFailureListener { err ->
                recordDiagnostic(
                    context,
                    "remove_all_geofences_failed",
                    level = "error",
                    fields = JSONObject().apply {
                        put("message", err.message ?: "Failed to remove geofences")
                    }
                )
                call.reject(err.message ?: "Failed to remove geofences")
            }
    }

    @PluginMethod
    fun syncGeofences(call: PluginCall) {
        val geofencePayload = call.getArray("geofences") ?: JSArray()

        recordDiagnostic(
            context,
            "sync_geofences_start",
            fields = JSONObject().apply {
                put("requestedCount", geofencePayload.length())
                put("granted", hasLocationPermission())
                put("preciseGranted", hasPreciseLocationPermission())
                put("approximateOnly", hasApproximateOnlyPermission())
                put("backgroundGranted", getPermissionState("backgroundLocation") == PermissionState.GRANTED)
                put("notificationGranted", getPermissionState("notifications") == PermissionState.GRANTED)
            }
        )

        if (!hasLocationPermission()) {
            recordDiagnostic(context, "sync_geofences_rejected_no_location", level = "error", fields = buildPermissionFields())
            call.reject("Location permission not granted")
            return
        }

        if (!hasPreciseLocationPermission()) {
            recordDiagnostic(context, "sync_geofences_rejected_no_precise", level = "error", fields = buildPermissionFields())
            call.reject("Precise location permission required for Android geofences")
            return
        }

        if (getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
            recordDiagnostic(context, "sync_geofences_rejected_no_background", level = "error", fields = buildPermissionFields())
            call.reject("Background location permission not granted")
            return
        }

        val payload = JSONArray()
        val geofences = mutableListOf<Geofence>()
        var skippedInvalidCount = 0

        for (index in 0 until geofencePayload.length()) {
            val item = geofencePayload.optJSONObject(index) ?: continue
            val id = item.optString("id")
            val latitude = item.optDouble("latitude", Double.NaN)
            val longitude = item.optDouble("longitude", Double.NaN)
            val radiusMeters = item.optDouble("radiusMeters", 150.0)

            if (id.isBlank() || latitude.isNaN() || longitude.isNaN()) {
                skippedInvalidCount += 1
                continue
            }

            payload.put(item)

            val appliedRadiusMeters = radiusMeters.toFloat().coerceAtLeast(MIN_GEOFENCE_RADIUS_METERS)

            val geofence = Geofence.Builder()
                .setRequestId(id)
                .setCircularRegion(latitude, longitude, appliedRadiusMeters)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                .setNotificationResponsiveness(GEOFENCE_NOTIFICATION_RESPONSIVENESS_MS)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .build()

            geofences.add(geofence)
        }

        val prefs = context.getSharedPreferences(GEOFENCE_PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(GEOFENCE_KEY, payload.toString()).apply()

        recordDiagnostic(
            context,
            "sync_geofences_payload_stored",
            fields = JSONObject().apply {
                put("requestedCount", geofencePayload.length())
                put("storedCount", payload.length())
                put("skippedInvalidCount", skippedInvalidCount)
                put("minAppliedRadiusMeters", MIN_GEOFENCE_RADIUS_METERS)
                put("notificationResponsivenessMs", GEOFENCE_NOTIFICATION_RESPONSIVENESS_MS)
                put("ids", JSONArray().apply {
                    for (index in 0 until payload.length()) {
                        val item = payload.optJSONObject(index) ?: continue
                        put(item.optString("id"))
                    }
                })
                put("geofences", JSONArray().apply {
                    for (index in 0 until payload.length()) {
                        val item = payload.optJSONObject(index) ?: continue
                        put(JSONObject().apply {
                            put("id", item.optString("id"))
                            put("latitude", item.optDouble("latitude", Double.NaN))
                            put("longitude", item.optDouble("longitude", Double.NaN))
                            put("configuredRadiusMeters", item.optDouble("radiusMeters", Double.NaN))
                            put(
                                "appliedRadiusMeters",
                                item.optDouble("radiusMeters", MIN_GEOFENCE_RADIUS_METERS.toDouble())
                                    .toFloat()
                                    .coerceAtLeast(MIN_GEOFENCE_RADIUS_METERS)
                                    .toDouble()
                            )
                            put("trigger", item.optString("trigger"))
                            put("workspaceId", item.optString("workspaceId"))
                            put("reminderId", item.optString("reminderId"))
                        })
                    }
                })
            }
        )

        geofencingClient.removeGeofences(getGeofencePendingIntent())
            .addOnCompleteListener {
                recordDiagnostic(
                    context,
                    "sync_geofences_cleared_existing",
                    fields = JSONObject().apply {
                        put("requestedCount", geofences.size)
                    }
                )

                if (geofences.isEmpty()) {
                    removeLocationFallbackUpdates("sync_empty_payload")
                        .addOnSuccessListener {
                            recordDiagnostic(context, "location_fallback_updates_stopped", fields = JSONObject().apply {
                                put("reason", "sync_empty_payload")
                            })
                        }
                        .addOnFailureListener { error ->
                            recordDiagnostic(
                                context,
                                "location_fallback_updates_stop_failed",
                                level = "error",
                                fields = JSONObject().apply {
                                    put("reason", "sync_empty_payload")
                                    put("message", error.message ?: "Failed to stop location fallback updates")
                                }
                            )
                        }
                    recordDiagnostic(context, "sync_geofences_empty_payload")
                    call.resolve(
                        JSObject().apply {
                            put("ok", true)
                            put("count", 0)
                        }
                    )
                    return@addOnCompleteListener
                }

                val request = GeofencingRequest.Builder()
                    .setInitialTrigger(0)
                    .addGeofences(geofences)
                    .build()

                if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                    ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
                ) {
                    recordDiagnostic(context, "sync_geofences_permission_check_failed", level = "error", fields = buildPermissionFields())
                    call.reject("Location permission not granted")
                    return@addOnCompleteListener
                }

                geofencingClient.addGeofences(request, getGeofencePendingIntent())
                    .addOnSuccessListener {
                        bootstrapGeofenceStates(payload)
                        startLocationFallbackUpdates(payload)
                        recordDiagnostic(
                            context,
                            "sync_geofences_add_success",
                            fields = JSONObject().apply {
                                put("count", geofences.size)
                                put("initialTrigger", 0)
                                put("notificationResponsivenessMs", GEOFENCE_NOTIFICATION_RESPONSIVENESS_MS)
                                put("pendingIntentAction", GEOFENCE_ACTION)
                                put("ids", JSONArray().apply {
                                    for (index in 0 until payload.length()) {
                                        val item = payload.optJSONObject(index) ?: continue
                                        put(item.optString("id"))
                                    }
                                })
                            }
                        )
                        call.resolve(
                            JSObject().apply {
                                put("ok", true)
                                put("count", geofences.size)
                            }
                        )
                    }
                    .addOnFailureListener { err ->
                        recordDiagnostic(
                            context,
                            "sync_geofences_add_failed",
                            level = "error",
                            fields = JSONObject().apply {
                                put("message", err.message ?: "Failed to register geofences")
                                put("errorClass", err.javaClass.simpleName)
                                put("count", geofences.size)
                                put("pendingIntentAction", GEOFENCE_ACTION)
                                put("ids", JSONArray().apply {
                                    for (index in 0 until payload.length()) {
                                        val item = payload.optJSONObject(index) ?: continue
                                        put(item.optString("id"))
                                    }
                                })
                                put("permissions", buildPermissionFields())
                            }
                        )
                        call.reject(err.message ?: "Failed to register geofences")
                    }
            }
    }

    private fun getGeofencePendingIntent(): PendingIntent {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        intent.action = GEOFENCE_ACTION

        return PendingIntent.getBroadcast(
            context,
            1002,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun getLocationFallbackPendingIntent(): PendingIntent {
        val intent = Intent(context, GeofenceLocationFallbackReceiver::class.java)
        intent.action = LOCATION_FALLBACK_ACTION

        return PendingIntent.getBroadcast(
            context,
            1003,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun clearStoredGeofences() {
        context
            .getSharedPreferences(GEOFENCE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(GEOFENCE_KEY)
            .apply()
        context
            .getSharedPreferences(GEOFENCE_STATE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(GEOFENCE_STATE_KEY)
            .apply()
    }

    private fun startLocationFallbackUpdates(payload: JSONArray) {
        if (!hasPreciseLocationPermission()) {
            recordDiagnostic(
                context,
                "location_fallback_updates_skipped",
                level = "error",
                fields = JSONObject().apply {
                    put("reason", "precise_location_not_granted")
                }
            )
            return
        }

        if (getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
            recordDiagnostic(
                context,
                "location_fallback_updates_skipped",
                level = "error",
                fields = JSONObject().apply {
                    put("reason", "background_location_not_granted")
                }
            )
            return
        }

        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            LOCATION_FALLBACK_INTERVAL_MS
        )
            .setMinUpdateIntervalMillis(LOCATION_FALLBACK_MIN_UPDATE_INTERVAL_MS)
            .setMinUpdateDistanceMeters(LOCATION_FALLBACK_MIN_DISTANCE_METERS)
            .build()

        fusedLocationClient.requestLocationUpdates(
            request,
            getLocationFallbackPendingIntent()
        )
            .addOnSuccessListener {
                recordDiagnostic(
                    context,
                    "location_fallback_updates_started",
                    fields = JSONObject().apply {
                        put("count", payload.length())
                        put("priority", "balanced_power_accuracy")
                        put("intervalMs", LOCATION_FALLBACK_INTERVAL_MS)
                        put("minUpdateIntervalMs", LOCATION_FALLBACK_MIN_UPDATE_INTERVAL_MS)
                        put("minDistanceMeters", LOCATION_FALLBACK_MIN_DISTANCE_METERS.toDouble())
                        put("maxAccuracyMeters", LOCATION_FALLBACK_MAX_ACCEPTABLE_ACCURACY_METERS.toDouble())
                        put("hysteresisMeters", LOCATION_FALLBACK_HYSTERESIS_METERS.toDouble())
                        put("transitionCooldownMs", LOCATION_FALLBACK_TRANSITION_COOLDOWN_MS)
                        put("action", LOCATION_FALLBACK_ACTION)
                    }
                )
            }
            .addOnFailureListener { err ->
                val apiException = err as? ApiException
                recordDiagnostic(
                    context,
                    "location_fallback_updates_failed",
                    level = "error",
                    fields = JSONObject().apply {
                        put("count", payload.length())
                        put("message", err.message ?: "Failed to start location fallback updates")
                        put("errorClass", err.javaClass.simpleName)
                        put("action", LOCATION_FALLBACK_ACTION)
                        put("hasPreciseLocationPermission", hasPreciseLocationPermission())
                        put("backgroundGranted", getPermissionState("backgroundLocation") == PermissionState.GRANTED)
                        put("notificationGranted", getPermissionState("notifications") == PermissionState.GRANTED)
                        if (apiException != null) {
                            put("statusCode", apiException.statusCode)
                            put("statusMessage", apiException.statusMessage ?: "")
                        }
                    }
                )
            }
    }

    private fun removeLocationFallbackUpdates(reason: String) =
        fusedLocationClient.removeLocationUpdates(getLocationFallbackPendingIntent())
            .addOnSuccessListener {
                recordDiagnostic(
                    context,
                    "location_fallback_updates_stopped",
                    fields = JSONObject().apply {
                        put("reason", reason)
                    }
                )
            }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return fine || coarse
    }

    private fun hasPreciseLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun hasApproximateOnlyPermission(): Boolean {
        val coarseGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return coarseGranted && !hasPreciseLocationPermission()
    }

    private fun bootstrapGeofenceStates(payload: JSONArray) {
        resolveCurrentLocation(
            onSuccess = { location ->
                val stateSummary = persistGeofenceStates(context, payload, location, "sync_bootstrap")
                recordDiagnostic(
                    context,
                    "sync_geofences_state_bootstrap_complete",
                    fields = JSONObject().apply {
                        put("storedCount", payload.length())
                        put("latitude", location.latitude)
                        put("longitude", location.longitude)
                        put("states", stateSummary)
                    }
                )
            },
            onFailure = { message ->
                recordDiagnostic(
                    context,
                    "sync_geofences_state_bootstrap_skipped",
                    level = "error",
                    fields = JSONObject().apply {
                        put("storedCount", payload.length())
                        put("message", message)
                    }
                )
            }
        )
    }

    private fun resolveCurrentLocation(
        onSuccess: (Location) -> Unit,
        onFailure: (String) -> Unit
    ) {
        if (!hasPreciseLocationPermission()) {
            onFailure("Precise location permission not granted")
            return
        }

        fusedLocationClient.lastLocation
            .addOnSuccessListener { location ->
                if (location != null) {
                    onSuccess(location)
                }
                else {
                    fusedLocationClient.getCurrentLocation(
                        Priority.PRIORITY_HIGH_ACCURACY,
                        CancellationTokenSource().token
                    )
                        .addOnSuccessListener { currentLocation ->
                            if (currentLocation != null) {
                                onSuccess(currentLocation)
                            } else {
                                onFailure("Current location unavailable")
                            }
                        }
                        .addOnFailureListener { error ->
                            onFailure(error.message ?: "Failed to resolve current location")
                        }
                }
            }
            .addOnFailureListener { error ->
                onFailure(error.message ?: "Failed to resolve last known location")
            }
    }

    private fun buildStatusObject(): JSObject {
        val stored = context
            .getSharedPreferences(GEOFENCE_PREFS, Context.MODE_PRIVATE)
            .getString(GEOFENCE_KEY, "[]") ?: "[]"
        val monitoredCount = try {
            JSONArray(stored).length()
        } catch (_: Exception) {
            0
        }

        return JSObject().apply {
            put("granted", getPermissionState("location") == PermissionState.GRANTED)
            put("preciseGranted", hasPreciseLocationPermission())
            put("approximateOnly", hasApproximateOnlyPermission())
            put("backgroundGranted", getPermissionState("backgroundLocation") == PermissionState.GRANTED)
            put("notificationGranted", getPermissionState("notifications") == PermissionState.GRANTED)
            put("monitoredCount", monitoredCount)
        }
    }

    private fun buildPermissionFields(): JSONObject {
        return JSONObject().apply {
            put("location", getPermissionState("location").toString())
            put("backgroundLocation", getPermissionState("backgroundLocation").toString())
            put("notifications", getPermissionState("notifications").toString())
            put("hasLocationPermission", hasLocationPermission())
            put("hasPreciseLocationPermission", hasPreciseLocationPermission())
            put("approximateOnlyPermission", hasApproximateOnlyPermission())
        }
    }

    companion object {
        private const val TAG = "NativeGeofence"
        private const val DIAGNOSTIC_PREFS = "stackin_native_geofence_diagnostics"
        private const val DIAGNOSTIC_KEY = "events"
        private const val DIAGNOSTIC_MAX_EVENTS = 200
        private const val MIN_GEOFENCE_RADIUS_METERS = 50f
        private const val GEOFENCE_NOTIFICATION_RESPONSIVENESS_MS = 5_000
        private const val LOCATION_FALLBACK_INTERVAL_MS = 60_000L
        private const val LOCATION_FALLBACK_MIN_UPDATE_INTERVAL_MS = 30_000L
        private const val LOCATION_FALLBACK_MIN_DISTANCE_METERS = 50f
        const val LOCATION_FALLBACK_MAX_ACCEPTABLE_ACCURACY_METERS = 150f
        const val LOCATION_FALLBACK_HYSTERESIS_METERS = 20f
        const val LOCATION_FALLBACK_TRANSITION_COOLDOWN_MS = 120_000L
        private const val GEOFENCE_STATE_PREFS = "stackin_native_geofence_state"
        private const val GEOFENCE_STATE_KEY = "states"

        const val GEOFENCE_ACTION = "app.stackin.GEOFENCE_EVENT"
        const val LOCATION_FALLBACK_ACTION = "app.stackin.GEOFENCE_LOCATION_FALLBACK"
        const val GEOFENCE_PREFS = "stackin_native_geofences"
        const val GEOFENCE_KEY = "registered_geofences"
        const val ENTRY_STATUS_PREFS = "stackin_native_geofence_entry_status"
        const val ENTRY_STATUS_KEY = "workspace_statuses"

        @Volatile
        private var activeInstance: NativeGeofencePlugin? = null

        @JvmStatic
        fun emitTriggeredEvent(
            requestId: String,
            workspaceId: String,
            reminderId: String,
            trigger: String
        ) {
            activeInstance?.notifyListeners(
                "geofenceTriggered",
                JSObject().apply {
                    put("id", requestId)
                    put("workspaceId", workspaceId)
                    put("reminderId", reminderId)
                    put("trigger", trigger)
                }
            )
        }

        @JvmStatic
        fun updateStoredGeofenceState(
            context: Context,
            requestId: String,
            inside: Boolean,
            source: String,
            distanceMeters: Double? = null,
            appliedRadiusMeters: Double? = null,
            lastTrigger: String? = null
        ) {
            val prefs = context.getSharedPreferences(GEOFENCE_STATE_PREFS, Context.MODE_PRIVATE)
            val existing = try {
                JSONObject(prefs.getString(GEOFENCE_STATE_KEY, "{}") ?: "{}")
            } catch (_: Exception) {
                JSONObject()
            }

            existing.put(
                requestId,
                JSONObject().apply {
                    put("inside", inside)
                    put("source", source)
                    put("ts", System.currentTimeMillis())
                    if (distanceMeters != null) {
                        put("distanceMeters", distanceMeters)
                    }
                    if (appliedRadiusMeters != null) {
                        put("appliedRadiusMeters", appliedRadiusMeters)
                    }
                    if (lastTrigger != null) {
                        put("lastTrigger", lastTrigger)
                        put("lastTransitionAt", System.currentTimeMillis())
                    }
                }
            )

            prefs.edit().putString(GEOFENCE_STATE_KEY, existing.toString()).apply()
        }

        @JvmStatic
        fun persistGeofenceStates(
            context: Context,
            geofences: JSONArray,
            location: Location,
            source: String
        ): JSONArray {
            val states = JSONObject()
            val summary = JSONArray()

            for (index in 0 until geofences.length()) {
                val item = geofences.optJSONObject(index) ?: continue
                val requestId = item.optString("id")
                val latitude = item.optDouble("latitude", Double.NaN)
                val longitude = item.optDouble("longitude", Double.NaN)
                val radiusMeters = item.optDouble("radiusMeters", MIN_GEOFENCE_RADIUS_METERS.toDouble())

                if (requestId.isBlank() || latitude.isNaN() || longitude.isNaN()) {
                    continue
                }

                val result = FloatArray(1)
                Location.distanceBetween(
                    location.latitude,
                    location.longitude,
                    latitude,
                    longitude,
                    result
                )
                val appliedRadiusMeters = radiusMeters.toFloat().coerceAtLeast(MIN_GEOFENCE_RADIUS_METERS)
                val inside = result[0] <= appliedRadiusMeters

                val stateObject = JSONObject().apply {
                    put("inside", inside)
                    put("distanceMeters", result[0].toDouble())
                    put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                    put("source", source)
                    put("ts", System.currentTimeMillis())
                }

                states.put(
                    requestId,
                    stateObject
                )

                summary.put(
                    JSONObject().apply {
                        put("id", requestId)
                        put("latitude", latitude)
                        put("longitude", longitude)
                        put("configuredRadiusMeters", radiusMeters)
                        put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                        put("distanceMeters", result[0].toDouble())
                        put("inside", inside)
                        put("source", source)
                    }
                )
            }

            context
                .getSharedPreferences(GEOFENCE_STATE_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(GEOFENCE_STATE_KEY, states.toString())
                .apply()

            return summary
        }

        @JvmStatic
        fun getStoredGeofenceState(context: Context, requestId: String): JSONObject? {
            val raw = context
                .getSharedPreferences(GEOFENCE_STATE_PREFS, Context.MODE_PRIVATE)
                .getString(GEOFENCE_STATE_KEY, "{}") ?: "{}"

            return try {
                JSONObject(raw).optJSONObject(requestId)
            } catch (_: Exception) {
                null
            }
        }

        @JvmStatic
        fun recordDiagnostic(
            context: Context,
            stage: String,
            level: String = "info",
            fields: JSONObject = JSONObject()
        ) {
            val event = JSONObject().apply {
                put("ts", System.currentTimeMillis())
                put("level", level)
                put("stage", stage)
                put("fields", fields)
            }

            val prefs = context.getSharedPreferences(DIAGNOSTIC_PREFS, Context.MODE_PRIVATE)
            val existing = try {
                JSONArray(prefs.getString(DIAGNOSTIC_KEY, "[]") ?: "[]")
            } catch (_: Exception) {
                JSONArray()
            }

            existing.put(event)

            val trimmed = JSONArray()
            val startIndex = maxOf(0, existing.length() - DIAGNOSTIC_MAX_EVENTS)
            for (index in startIndex until existing.length()) {
                trimmed.put(existing.opt(index))
            }

            prefs.edit().putString(DIAGNOSTIC_KEY, trimmed.toString()).apply()

            if (level == "error") {
                Log.e(TAG, "$stage ${fields}")
            } else {
                Log.i(TAG, "$stage ${fields}")
            }

            activeInstance?.notifyListeners(
                "geofenceDiagnostic",
                JSObject().apply {
                    put("ts", event.optLong("ts"))
                    put("level", level)
                    put("stage", stage)
                    put("fields", jsonObjectToJsObject(fields))
                }
            )
        }

        @JvmStatic
        fun drainDiagnostics(context: Context): JSONArray {
            val prefs = context.getSharedPreferences(DIAGNOSTIC_PREFS, Context.MODE_PRIVATE)
            val drained = try {
                JSONArray(prefs.getString(DIAGNOSTIC_KEY, "[]") ?: "[]")
            } catch (_: Exception) {
                JSONArray()
            }

            prefs.edit().putString(DIAGNOSTIC_KEY, "[]").apply()
            return drained
        }

        private fun jsonObjectToJsObject(source: JSONObject): JSObject {
            val result = JSObject()
            val keys = source.keys()

            while (keys.hasNext()) {
                val key = keys.next()
                result.put(key, source.opt(key))
            }

            return result
        }
    }
}
