package app.stackin

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.AutocompletePrediction
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.model.RectangularBounds
import com.google.android.libraries.places.api.net.FetchPlaceRequest
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.PlacesClient
import com.google.android.libraries.places.api.model.AutocompleteSessionToken
import java.io.IOException
import java.util.LinkedHashSet
import java.util.Locale
import java.util.concurrent.Executors

@CapacitorPlugin(name = "NativePlacePicker")
class NativePlacePickerPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val searchRadiusMeters = 25_000.0
    @Volatile
    private var autocompleteSessionToken: AutocompleteSessionToken? = null
    @Volatile
    private var placesClient: PlacesClient? = null

    @PluginMethod
    fun pickPlace(call: PluginCall) {
        call.unavailable("Android uses inline location search in this build.")
    }

    @PluginMethod
    fun resetSearchSession(call: PluginCall) {
        autocompleteSessionToken = null
        call.resolve()
    }

    @PluginMethod
    fun searchPlaces(call: PluginCall) {
        val query = call.getString("query")?.trim().orEmpty()
        val limit = (call.getInt("limit") ?: 6).coerceIn(1, 8)

        if (query.isBlank()) {
            autocompleteSessionToken = null
            call.resolve(JSObject().apply {
                put("results", JSArray())
            })
            return
        }

        val context = bridge?.activity ?: activity ?: this.context
        resolveCurrentLocation(context) { currentLocation ->
            val client = getPlacesClient(context)
            if (client == null) {
                performGeocoderSearch(context, query, limit, currentLocation, call)
                return@resolveCurrentLocation
            }

            val sessionToken = autocompleteSessionToken ?: AutocompleteSessionToken.newInstance().also {
                autocompleteSessionToken = it
            }

            val requestBuilder = FindAutocompletePredictionsRequest.builder()
                .setQuery(query)
                .setSessionToken(sessionToken)

            currentLocation?.let { location ->
                requestBuilder.setOrigin(LatLng(location.latitude, location.longitude))
                requestBuilder.setLocationBias(
                    RectangularBounds.newInstance(
                        LatLng(
                            location.latitude - latitudeDeltaForRadius(searchRadiusMeters),
                            location.longitude - longitudeDeltaForRadius(searchRadiusMeters, location.latitude)
                        ),
                        LatLng(
                            location.latitude + latitudeDeltaForRadius(searchRadiusMeters),
                            location.longitude + longitudeDeltaForRadius(searchRadiusMeters, location.latitude)
                        )
                    )
                )
            }

            client.findAutocompletePredictions(requestBuilder.build())
                .addOnSuccessListener { response ->
                    val results = JSArray()
                    val seen = LinkedHashSet<String>()

                    response.autocompletePredictions
                        .take(limit)
                        .forEach { prediction ->
                            val name = prediction.getPrimaryText(null)?.toString()?.trim().orEmpty()
                            val secondary = prediction.getSecondaryText(null)?.toString()?.trim().orEmpty()
                            val address = secondary.ifBlank {
                                prediction.getFullText(null)?.toString()?.trim().orEmpty()
                            }
                            val dedupeKey = "${prediction.placeId}|$name|$address"

                            if (!seen.add(dedupeKey)) {
                                return@forEach
                            }

                            results.put(
                                JSObject().apply {
                                    put("placeId", prediction.placeId)
                                    put("address", address.ifBlank { name.ifBlank { "Selected location" } })
                                    if (name.isNotBlank()) {
                                        put("name", name)
                                    }
                                }
                            )
                        }

                    call.resolve(
                        JSObject().apply {
                            put("results", results)
                        }
                    )
                }
                .addOnFailureListener { error ->
                    performGeocoderSearch(context, query, limit, currentLocation, call, error.message)
                }
        }
    }

    @PluginMethod
    fun resolvePlace(call: PluginCall) {
        val placeId = call.getString("placeId")?.trim().orEmpty()
        if (placeId.isBlank()) {
            call.reject("A placeId is required.")
            return
        }

        val context = bridge?.activity ?: activity ?: this.context
        val client = getPlacesClient(context)
        if (client == null) {
            call.reject("Google Places is not configured on Android yet.")
            return
        }

        val requestBuilder = FetchPlaceRequest.builder(
            placeId,
            listOf(
                Place.Field.ID,
                Place.Field.NAME,
                Place.Field.ADDRESS,
                Place.Field.LAT_LNG
            )
        )

        autocompleteSessionToken?.let { token ->
            requestBuilder.setSessionToken(token)
        }

        client.fetchPlace(requestBuilder.build())
            .addOnSuccessListener { response ->
                autocompleteSessionToken = null
                val place = response.place
                val location = place.latLng
                if (location == null) {
                    call.reject("The selected place did not include coordinates.")
                    return@addOnSuccessListener
                }

                call.resolve(
                    JSObject().apply {
                        put("lat", location.latitude)
                        put("lng", location.longitude)
                        put("address", place.address?.trim().orEmpty().ifBlank {
                            place.name?.trim().orEmpty().ifBlank { "Selected location" }
                        })
                        val displayName = place.name?.trim().orEmpty()
                        if (displayName.isNotBlank()) {
                            put("name", displayName)
                        }
                    }
                )
            }
            .addOnFailureListener { error ->
                autocompleteSessionToken = null
                call.reject(error.message ?: "Unable to load the selected location.")
            }
    }

    private fun getPlacesClient(context: Context): PlacesClient? {
        val apiKey = BuildConfig.GOOGLE_MAPS_API_KEY.trim()
        if (apiKey.isBlank()) {
            return null
        }

        if (!Places.isInitialized()) {
            Places.initializeWithNewPlacesApiEnabled(
                context.applicationContext,
                apiKey,
                Locale.getDefault()
            )
        }

        val existing = placesClient
        if (existing != null) {
            return existing
        }

        return Places.createClient(context.applicationContext).also {
            placesClient = it
        }
    }

    private fun performGeocoderSearch(
        context: Context,
        query: String,
        limit: Int,
        currentLocation: Location?,
        call: PluginCall,
        fallbackReason: String? = null
    ) {
        if (!Geocoder.isPresent()) {
            call.reject(
                fallbackReason ?: "Android location search is not available on this device."
            )
            return
        }

        val geocoder = Geocoder(context, Locale.getDefault())
        executor.execute {
            try {
                val addresses = searchAddresses(geocoder, query, limit, currentLocation)
                val results = JSArray()
                val seen = LinkedHashSet<String>()

                addresses
                    .filter { address ->
                        address.hasLatitude() && address.hasLongitude()
                    }
                    .sortedWith(compareBy<Address> { address ->
                        distanceFrom(currentLocation, address)
                    }.thenBy { address ->
                        buildPlaceName(address).orEmpty()
                    })
                    .forEach { address ->
                        val name = buildPlaceName(address)
                        val label = buildAddressLabel(address, name)
                        val dedupeKey = "${name.orEmpty()}|$label|${address.latitude}|${address.longitude}"

                        if (!seen.add(dedupeKey)) {
                            return@forEach
                        }

                        results.put(
                            JSObject().apply {
                                put("lat", address.latitude)
                                put("lng", address.longitude)
                                put("address", label)
                                if (!name.isNullOrBlank()) {
                                    put("name", name)
                                }
                            }
                        )
                    }

                runOnMainThread {
                    call.resolve(
                        JSObject().apply {
                            put("results", results)
                        }
                    )
                }
            } catch (error: Exception) {
                runOnMainThread {
                    call.reject(error.message ?: fallbackReason ?: "Unable to search locations right now.")
                }
            }
        }
    }

    private fun searchAddresses(
        geocoder: Geocoder,
        query: String,
        limit: Int,
        currentLocation: Location?
    ): List<Address> {
        val expandedLimit = limit.coerceAtLeast(1).coerceAtMost(10) * 2
        val bounds = currentLocation?.let { buildSearchBounds(it) }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val lock = java.lang.Object()
            val resultHolder = mutableListOf<Address>()
            var failure: String? = null

            val listener = object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) {
                    synchronized(lock) {
                        resultHolder.addAll(addresses)
                        lock.notify()
                    }
                }

                override fun onError(errorMessage: String?) {
                    synchronized(lock) {
                        failure = errorMessage ?: "Unable to search locations right now."
                        lock.notify()
                    }
                }
            }

            if (bounds != null) {
                geocoder.getFromLocationName(
                    query,
                    expandedLimit,
                    bounds.lowerLeftLatitude,
                    bounds.lowerLeftLongitude,
                    bounds.upperRightLatitude,
                    bounds.upperRightLongitude,
                    listener
                )
            } else {
                geocoder.getFromLocationName(query, expandedLimit, listener)
            }

            synchronized(lock) {
                lock.wait(10000)
            }

            if (failure != null) {
                throw IOException(failure)
            }

            resultHolder.toList()
        } else {
            @Suppress("DEPRECATION")
            if (bounds != null) {
                geocoder.getFromLocationName(
                    query,
                    expandedLimit,
                    bounds.lowerLeftLatitude,
                    bounds.lowerLeftLongitude,
                    bounds.upperRightLatitude,
                    bounds.upperRightLongitude
                ) ?: emptyList()
            } else {
                geocoder.getFromLocationName(query, expandedLimit) ?: emptyList()
            }
        }
    }

    private fun buildPlaceName(address: Address): String? {
        val candidates = listOf(
            address.featureName,
            address.premises,
            address.subLocality
        )
            .mapNotNull { value ->
                value?.trim()?.takeIf { it.isNotBlank() }
            }

        val addressLabel = buildStreetAddressParts(address)
        return candidates.firstOrNull { candidate ->
            !candidate.equals(addressLabel, ignoreCase = true)
        }
    }

    private fun buildAddressLabel(address: Address, preferredName: String? = null): String {
        val streetAddress = buildStreetAddressParts(address)
        if (streetAddress.isNotBlank()) {
            return streetAddress
        }

        val line = address.getAddressLine(0)?.trim()
        if (!line.isNullOrBlank()) {
            if (!preferredName.isNullOrBlank() && line.startsWith("$preferredName,", ignoreCase = true)) {
                return line.removePrefix("$preferredName,").trim().trimStart(',')
            }
            return line
        }

        val parts = listOfNotNull(
            address.thoroughfare,
            address.locality,
            address.adminArea,
            address.countryName
        )
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()

        return parts.joinToString(", ").ifBlank { preferredName ?: "Selected location" }
    }

    private fun buildStreetAddressParts(address: Address): String {
        val streetLine = listOfNotNull(
            address.subThoroughfare?.trim(),
            address.thoroughfare?.trim()
        )
            .filter { it.isNotBlank() }
            .joinToString(" ")

        val localityLine = listOfNotNull(
            address.locality?.trim(),
            address.adminArea?.trim(),
            address.postalCode?.trim()
        )
            .filter { it.isNotBlank() }
            .joinToString(", ")

        return listOf(streetLine, localityLine)
            .filter { it.isNotBlank() }
            .joinToString(", ")
    }

    private fun resolveCurrentLocation(context: Context, callback: (Location?) -> Unit) {
        if (!hasLocationPermission(context)) {
            callback(null)
            return
        }

        val fusedClient = LocationServices.getFusedLocationProviderClient(context)
        fusedClient.lastLocation
            .addOnSuccessListener { location ->
                if (location != null) {
                    callback(location)
                    return@addOnSuccessListener
                }

                fusedClient.getCurrentLocation(
                    Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                    CancellationTokenSource().token
                )
                    .addOnSuccessListener { currentLocation ->
                        callback(currentLocation)
                    }
                    .addOnFailureListener {
                        callback(null)
                    }
            }
            .addOnFailureListener {
                callback(null)
            }
    }

    private fun hasLocationPermission(context: Context): Boolean {
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

    private fun buildSearchBounds(location: Location): SearchBounds {
        val latitudeDelta = latitudeDeltaForRadius(searchRadiusMeters)
        val longitudeDelta = longitudeDeltaForRadius(searchRadiusMeters, location.latitude)

        return SearchBounds(
            lowerLeftLatitude = (location.latitude - latitudeDelta).coerceAtLeast(-90.0),
            lowerLeftLongitude = (location.longitude - longitudeDelta).coerceAtLeast(-180.0),
            upperRightLatitude = (location.latitude + latitudeDelta).coerceAtMost(90.0),
            upperRightLongitude = (location.longitude + longitudeDelta).coerceAtMost(180.0)
        )
    }

    private fun latitudeDeltaForRadius(radiusMeters: Double): Double {
        return radiusMeters / 111_320.0
    }

    private fun longitudeDeltaForRadius(radiusMeters: Double, latitude: Double): Double {
        return radiusMeters / (
            111_320.0 * kotlin.math.cos(Math.toRadians(latitude)).coerceAtLeast(0.2)
            )
    }

    private fun distanceFrom(currentLocation: Location?, address: Address): Float {
        if (currentLocation == null || !address.hasLatitude() || !address.hasLongitude()) {
            return Float.MAX_VALUE
        }

        val result = FloatArray(1)
        Location.distanceBetween(
            currentLocation.latitude,
            currentLocation.longitude,
            address.latitude,
            address.longitude,
            result
        )
        return result[0]
    }

    private fun runOnMainThread(action: () -> Unit) {
        bridge?.activity?.runOnUiThread(action) ?: action()
    }

    private data class SearchBounds(
        val lowerLeftLatitude: Double,
        val lowerLeftLongitude: Double,
        val upperRightLatitude: Double,
        val upperRightLongitude: Double
    )
}
