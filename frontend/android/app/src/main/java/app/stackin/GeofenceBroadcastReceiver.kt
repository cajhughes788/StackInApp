package app.stackin

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Bundle
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

class GeofenceBroadcastReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent)
        if (event == null) {
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "receiver_event_missing",
                level = "error",
                fields = JSONObject().apply {
                    put("action", intent.action ?: "")
                    put("component", intent.component?.className ?: "")
                    put("package", intent.`package` ?: "")
                    put("data", intent.dataString ?: "")
                    put("flags", intent.flags)
                    put("categories", JSONArray().apply {
                        for (category in intent.categories ?: emptySet()) {
                            put(category)
                        }
                    })
                    put("extrasKeys", JSONArray().apply {
                        for (key in intent.extras?.keySet() ?: emptySet()) {
                            put(key)
                        }
                    })
                    put("extrasPreview", bundleToJson(intent.extras))
                }
            )
            return
        }

        if (event.hasError()) {
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "receiver_event_error",
                level = "error",
                fields = JSONObject().apply {
                    put("action", intent.action ?: "")
                    put("component", intent.component?.className ?: "")
                    put("flags", intent.flags)
                    put("errorCode", event.errorCode)
                    put("errorName", GeofenceStatusCodes.getStatusCodeString(event.errorCode))
                    put("extrasKeys", JSONArray().apply {
                        for (key in intent.extras?.keySet() ?: emptySet()) {
                            put(key)
                        }
                    })
                    put("extrasPreview", bundleToJson(intent.extras))
                }
            )
            return
        }

        NativeGeofencePlugin.recordDiagnostic(
            context,
            "receiver_event_received",
            fields = JSONObject().apply {
                put("action", intent.action ?: "")
                put("transition", event.geofenceTransition)
                put("triggeringCount", event.triggeringGeofences?.size ?: 0)
                put("triggeringRequestIds", JSONArray().apply {
                    for (geofence in event.triggeringGeofences ?: emptyList()) {
                        put(geofence.requestId)
                    }
                })
            }
        )

        val geofenceTransition = event.geofenceTransition
        val trigger = when (geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "arrive"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "leave"
            else -> {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "receiver_transition_unsupported",
                    fields = JSONObject().apply {
                        put("transition", geofenceTransition)
                    }
                )
                return
            }
        }

        for (triggeringGeofence in event.triggeringGeofences ?: emptyList()) {
            processResolvedTrigger(
                context,
                triggeringGeofence.requestId,
                trigger,
                "receiver:$trigger"
            )
        }
    }

    companion object {
        private fun bundleToJson(bundle: Bundle?): JSONObject {
            val json = JSONObject()
            if (bundle == null) {
                return json
            }

            for (key in bundle.keySet()) {
                val value = bundle.get(key)
                when (value) {
                    null -> json.put(key, JSONObject.NULL)
                    is Boolean, is Int, is Long, is Double, is Float, is String -> json.put(key, value)
                    is Array<*> -> json.put(key, JSONArray(value.toList()))
                    is IntArray -> json.put(key, JSONArray().apply {
                        for (item in value) {
                            put(item)
                        }
                    })
                    is LongArray -> json.put(key, JSONArray().apply {
                        for (item in value) {
                            put(item)
                        }
                    })
                    is FloatArray -> json.put(key, JSONArray().apply {
                        for (item in value) {
                            put(item.toDouble())
                        }
                    })
                    is DoubleArray -> json.put(key, JSONArray().apply {
                        for (item in value) {
                            put(item)
                        }
                    })
                    is BooleanArray -> json.put(key, JSONArray().apply {
                        for (item in value) {
                            put(item)
                        }
                    })
                    else -> json.put(key, value.toString())
                }
            }

            return json
        }

        private fun findGeofenceMetadata(items: JSONArray, requestId: String): JSONObject? {
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                if (item.optString("id") == requestId) {
                    return item
                }
            }
            return null
        }

        private fun workspaceHasEntryToday(context: Context, workspaceId: String): Boolean {
            val raw = context
                .getSharedPreferences(
                    NativeGeofencePlugin.ENTRY_STATUS_PREFS,
                    Context.MODE_PRIVATE
                )
                .getString(NativeGeofencePlugin.ENTRY_STATUS_KEY, "[]") ?: "[]"

            val statuses = try {
                JSONArray(raw)
            } catch (_: Exception) {
                JSONArray()
            }

            val today = LocalDate.now().toString()

            for (index in 0 until statuses.length()) {
                val item = statuses.optJSONObject(index) ?: continue
                if (item.optString("workspaceId") == workspaceId &&
                    item.optString("dateKey") == today
                ) {
                    return item.optBoolean("hasEntryToday", false)
                }
            }

            return false
        }

        @JvmStatic
        fun processLocationFallbackUpdate(context: Context, location: Location, source: String = "location_fallback:update") {
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "location_fallback_update_received",
                fields = JSONObject().apply {
                    put("source", source)
                    put("latitude", location.latitude)
                    put("longitude", location.longitude)
                    put("accuracyMeters", location.accuracy.toDouble())
                    put("provider", location.provider ?: "")
                    put("ts", location.time)
                }
            )

            val prefs = context.getSharedPreferences(
                NativeGeofencePlugin.GEOFENCE_PREFS,
                Context.MODE_PRIVATE
            )
            val raw = prefs.getString(NativeGeofencePlugin.GEOFENCE_KEY, "[]") ?: "[]"
            val geofences = try {
                JSONArray(raw)
            } catch (error: Exception) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "location_fallback_metadata_parse_failed",
                    level = "error",
                    fields = JSONObject().apply {
                        put("message", error.message ?: "Unknown parse error")
                    }
                )
                JSONArray()
            }

            if (geofences.length() == 0) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "location_fallback_no_geofences",
                    fields = JSONObject().apply {
                        put("source", source)
                    }
                )
                return
            }

            for (index in 0 until geofences.length()) {
                val item = geofences.optJSONObject(index) ?: continue
                val requestId = item.optString("id")
                val latitude = item.optDouble("latitude", Double.NaN)
                val longitude = item.optDouble("longitude", Double.NaN)
                val configuredRadiusMeters = item.optDouble("radiusMeters", Double.NaN)
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
                val appliedRadiusMeters = configuredRadiusMeters
                    .toFloat()
                    .coerceAtLeast(50f)
                val maxAcceptableAccuracyMeters = maxOf(
                    NativeGeofencePlugin.LOCATION_FALLBACK_MAX_ACCEPTABLE_ACCURACY_METERS,
                    appliedRadiusMeters * 1.5f
                )
                if (location.hasAccuracy() && location.accuracy > maxAcceptableAccuracyMeters) {
                    NativeGeofencePlugin.recordDiagnostic(
                        context,
                        "location_fallback_state_skipped_accuracy",
                        fields = JSONObject().apply {
                            put("source", source)
                            put("requestId", requestId)
                            put("accuracyMeters", location.accuracy.toDouble())
                            put("maxAcceptableAccuracyMeters", maxAcceptableAccuracyMeters.toDouble())
                            put("distanceMeters", result[0].toDouble())
                            put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                        }
                    )
                    continue
                }

                val hysteresisMeters = minOf(
                    NativeGeofencePlugin.LOCATION_FALLBACK_HYSTERESIS_METERS,
                    appliedRadiusMeters * 0.25f
                )
                val insideThreshold = maxOf(0f, appliedRadiusMeters - hysteresisMeters)
                val outsideThreshold = appliedRadiusMeters + hysteresisMeters
                val currentInside = result[0] <= appliedRadiusMeters
                val previousState = NativeGeofencePlugin.getStoredGeofenceState(context, requestId)
                val hasPreviousInside = previousState != null && previousState.has("inside")
                val previousInside = if (hasPreviousInside) previousState?.optBoolean("inside") else null
                val stableInside = when {
                    result[0] <= insideThreshold -> true
                    result[0] >= outsideThreshold -> false
                    else -> null
                }

                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "location_fallback_state_evaluated",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("distanceMeters", result[0].toDouble())
                        put("configuredRadiusMeters", configuredRadiusMeters)
                        put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                        put("insideThresholdMeters", insideThreshold.toDouble())
                        put("outsideThresholdMeters", outsideThreshold.toDouble())
                        put("hysteresisMeters", hysteresisMeters.toDouble())
                        put("currentInside", currentInside)
                        put("stableInside", stableInside)
                        put("previousInside", previousInside)
                        put("accuracyMeters", location.accuracy.toDouble())
                    }
                )

                if (stableInside == null) {
                    NativeGeofencePlugin.recordDiagnostic(
                        context,
                        "location_fallback_state_boundary_zone",
                        fields = JSONObject().apply {
                            put("source", source)
                            put("requestId", requestId)
                            put("distanceMeters", result[0].toDouble())
                            put("insideThresholdMeters", insideThreshold.toDouble())
                            put("outsideThresholdMeters", outsideThreshold.toDouble())
                        }
                    )
                    if (!hasPreviousInside) {
                        NativeGeofencePlugin.updateStoredGeofenceState(
                            context,
                            requestId,
                            currentInside,
                            "$source:init_boundary",
                            result[0].toDouble(),
                            appliedRadiusMeters.toDouble()
                        )
                    } else {
                        NativeGeofencePlugin.updateStoredGeofenceState(
                            context,
                            requestId,
                            previousInside == true,
                            "$source:boundary",
                            result[0].toDouble(),
                            appliedRadiusMeters.toDouble()
                        )
                    }
                    continue
                }

                if (!hasPreviousInside) {
                    NativeGeofencePlugin.updateStoredGeofenceState(
                        context,
                        requestId,
                        stableInside,
                        "$source:init",
                        result[0].toDouble(),
                        appliedRadiusMeters.toDouble()
                    )
                    NativeGeofencePlugin.recordDiagnostic(
                        context,
                        "location_fallback_state_initialized",
                        fields = JSONObject().apply {
                            put("source", source)
                            put("requestId", requestId)
                            put("inside", stableInside)
                            put("distanceMeters", result[0].toDouble())
                            put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                        }
                    )
                    continue
                }

                if (previousInside == stableInside) {
                    NativeGeofencePlugin.updateStoredGeofenceState(
                        context,
                        requestId,
                        stableInside,
                        "$source:steady",
                        result[0].toDouble(),
                        appliedRadiusMeters.toDouble()
                    )
                    continue
                }

                val lastTransitionAt = previousState?.optLong("lastTransitionAt", 0L) ?: 0L
                val now = System.currentTimeMillis()
                if (lastTransitionAt > 0L &&
                    now - lastTransitionAt < NativeGeofencePlugin.LOCATION_FALLBACK_TRANSITION_COOLDOWN_MS
                ) {
                    NativeGeofencePlugin.recordDiagnostic(
                        context,
                        "location_fallback_transition_suppressed_cooldown",
                        fields = JSONObject().apply {
                            put("source", source)
                            put("requestId", requestId)
                            put("previousInside", previousInside)
                            put("stableInside", stableInside)
                            put("lastTransitionAt", lastTransitionAt)
                            put(
                                "cooldownRemainingMs",
                                NativeGeofencePlugin.LOCATION_FALLBACK_TRANSITION_COOLDOWN_MS - (now - lastTransitionAt)
                            )
                        }
                    )
                    continue
                }

                val trigger = if (stableInside) "arrive" else "leave"
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "location_fallback_transition_detected",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("trigger", trigger)
                        put("previousInside", previousInside)
                        put("currentInside", currentInside)
                        put("stableInside", stableInside)
                        put("distanceMeters", result[0].toDouble())
                        put("appliedRadiusMeters", appliedRadiusMeters.toDouble())
                    }
                )

                processResolvedTrigger(
                    context,
                    requestId,
                    trigger,
                    source,
                    result[0].toDouble(),
                    appliedRadiusMeters.toDouble()
                )
            }
        }

        @JvmStatic
        fun processResolvedTrigger(
            context: Context,
            requestId: String,
            trigger: String,
            source: String,
            distanceMeters: Double? = null,
            appliedRadiusMeters: Double? = null
        ) {
            val stagePrefix = if (source.startsWith("location_fallback")) {
                "location_fallback"
            } else {
                "receiver"
            }

            val prefs = context.getSharedPreferences(
                NativeGeofencePlugin.GEOFENCE_PREFS,
                Context.MODE_PRIVATE
            )
            val raw = prefs.getString(NativeGeofencePlugin.GEOFENCE_KEY, "[]") ?: "[]"
            val geofences = try {
                JSONArray(raw)
            } catch (error: Exception) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "${stagePrefix}_metadata_parse_failed",
                    level = "error",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("message", error.message ?: "Unknown parse error")
                    }
                )
                JSONArray()
            }

            val metadata = findGeofenceMetadata(geofences, requestId)
            if (metadata == null) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "${stagePrefix}_metadata_missing",
                    level = "error",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("trigger", trigger)
                    }
                )
                return
            }

            val workspaceId = metadata.optString("workspaceId")
            val reminderId = metadata.optString("reminderId")
            val deliveryMode = metadata.optString("deliveryMode", "if_no_entry")
            val previousState = NativeGeofencePlugin.getStoredGeofenceState(context, requestId)

            NativeGeofencePlugin.recordDiagnostic(
                context,
                "${stagePrefix}_metadata_matched",
                fields = JSONObject().apply {
                    put("source", source)
                    put("requestId", requestId)
                    put("workspaceId", workspaceId)
                    put("reminderId", reminderId)
                    put("trigger", trigger)
                    put("configuredTrigger", metadata.optString("trigger"))
                    put("deliveryMode", deliveryMode)
                    put("label", metadata.optString("label"))
                    put("latitude", metadata.optDouble("latitude", Double.NaN))
                    put("longitude", metadata.optDouble("longitude", Double.NaN))
                    put("configuredRadiusMeters", metadata.optDouble("radiusMeters", Double.NaN))
                    put(
                        "appliedRadiusMeters",
                        appliedRadiusMeters ?: metadata.optDouble("radiusMeters", Double.NaN)
                            .toFloat()
                            .coerceAtLeast(50f)
                            .toDouble()
                    )
                    put("previousInside", previousState?.optBoolean("inside"))
                    put("previousDistanceMeters", previousState?.optDouble("distanceMeters"))
                    put("previousAppliedRadiusMeters", previousState?.optDouble("appliedRadiusMeters"))
                    put("previousStateSource", previousState?.optString("source"))
                    put("previousStateTs", previousState?.optLong("ts"))
                    if (distanceMeters != null) {
                        put("distanceMeters", distanceMeters)
                    }
                }
            )

            if (metadata.optString("trigger") != trigger) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "${stagePrefix}_trigger_mismatch",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("receivedTrigger", trigger)
                        put("configuredTrigger", metadata.optString("trigger"))
                    }
                )
                return
            }

            NativeGeofencePlugin.updateStoredGeofenceState(
                context,
                requestId,
                trigger == "arrive",
                source,
                distanceMeters,
                appliedRadiusMeters,
                trigger
            )
            NativeGeofencePlugin.emitTriggeredEvent(requestId, workspaceId, reminderId, trigger)

            val hasEntryToday = if (deliveryMode == "if_no_entry") {
                workspaceHasEntryToday(context, workspaceId)
            } else {
                false
            }

            NativeGeofencePlugin.recordDiagnostic(
                context,
                "${stagePrefix}_entry_status_evaluated",
                fields = JSONObject().apply {
                    put("source", source)
                    put("requestId", requestId)
                    put("workspaceId", workspaceId)
                    put("deliveryMode", deliveryMode)
                    put("hasEntryToday", hasEntryToday)
                    put("dateKey", LocalDate.now().toString())
                }
            )

            if (deliveryMode == "if_no_entry" && hasEntryToday) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "${stagePrefix}_notification_skipped_existing_entry",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("workspaceId", workspaceId)
                        put("deliveryMode", deliveryMode)
                        put("trigger", trigger)
                    }
                )
                return
            }

            val workspaceName = metadata.optString("workspaceName", "your")
            val reminderLabel = metadata.optString("label", "your location")
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "${stagePrefix}_notification_preparing",
                fields = JSONObject().apply {
                    put("source", source)
                    put("requestId", requestId)
                    put("workspaceId", workspaceId)
                    put("reminderId", reminderId)
                    put("workspaceName", workspaceName)
                    put("label", reminderLabel)
                    put("trigger", trigger)
                    put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled())
                    put("channelId", "stackin_entry_reminders")
                }
            )

            sendNotification(
                context,
                requestId,
                workspaceId,
                reminderId,
                workspaceName,
                reminderLabel,
                trigger,
                stagePrefix,
                source
            )
        }

        private fun sendNotification(
            context: Context,
            requestId: String,
            workspaceId: String,
            reminderId: String,
            workspaceName: String,
            reminderLabel: String,
            trigger: String,
            stagePrefix: String,
            source: String
        ) {
        val channelId = "stackin_entry_reminders"
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val managerCompat = NotificationManagerCompat.from(context)
        val notificationsEnabled = managerCompat.areNotificationsEnabled()
        val postPermissionGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        NativeGeofencePlugin.recordDiagnostic(
            context,
            "${stagePrefix}_notification_attempt",
            fields = JSONObject().apply {
                put("source", source)
                put("requestId", requestId)
                put("workspaceId", workspaceId)
                put("reminderId", reminderId)
                put("trigger", trigger)
                put("notificationsEnabled", notificationsEnabled)
                put("postPermissionGranted", postPermissionGranted)
                put("channelId", channelId)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val existingChannel = manager.getNotificationChannel(channelId)
                    put("channelExists", existingChannel != null)
                    put("channelImportance", existingChannel?.importance ?: -1)
                }
            }
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!postPermissionGranted) {
                NativeGeofencePlugin.recordDiagnostic(
                    context,
                    "${stagePrefix}_notification_blocked_no_permission",
                    level = "error",
                    fields = JSONObject().apply {
                        put("source", source)
                        put("requestId", requestId)
                        put("workspaceId", workspaceId)
                        put("reminderId", reminderId)
                        put("trigger", trigger)
                    }
                )
                return
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Entry Reminders",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            manager.createNotificationChannel(channel)
            NativeGeofencePlugin.recordDiagnostic(
                context,
                "${stagePrefix}_notification_channel_ready",
                fields = JSONObject().apply {
                    put("source", source)
                    put("requestId", requestId)
                    put("channelId", channelId)
                    put("channelImportance", channel.importance)
                }
            )
        }

        val title = if (trigger == "leave") {
            "You have left $reminderLabel"
        } else {
            "You have arrived at $reminderLabel"
        }
        val body = "Add your entry for today for your $workspaceName workspace"

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val notificationId = requestId.hashCode()
        managerCompat.notify(notificationId, notification)
        NativeGeofencePlugin.recordDiagnostic(
            context,
            "${stagePrefix}_notification_sent",
            fields = JSONObject().apply {
                put("source", source)
                put("requestId", requestId)
                put("workspaceId", workspaceId)
                put("reminderId", reminderId)
                put("trigger", trigger)
                put("workspaceName", workspaceName)
                put("label", reminderLabel)
                put("notificationId", notificationId)
                put("notificationsEnabled", notificationsEnabled)
                put("postedAt", System.currentTimeMillis())
            }
        )
    }
    }
}
