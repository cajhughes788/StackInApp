// /frontend/plugins/NativePlacePicker.ts
// Cross-platform wrapper around the native place picker, with a browser
// geolocation fallback so the settings flow still works on web.
import { Capacitor, registerPlugin } from "@capacitor/core";
export type PlaceResult = {
    lat: number;
    lng: number;
    address: string;
    name?: string;
};
export type PlaceSuggestion = {
    address: string;
    name?: string;
    placeId?: string;
    lat?: number;
    lng?: number;
};
type NativePlacePickerPlugin = {
    pickPlace(): Promise<PlaceResult | null>;
    searchPlaces(options: {
        query: string;
        limit?: number;
    }): Promise<{
        results: PlaceSuggestion[];
    }>;
    resetSearchSession(): Promise<void>;
    resolvePlace(options: {
        placeId: string;
    }): Promise<PlaceResult | null>;
};
const CapacitorNativePlacePicker = registerPlugin<NativePlacePickerPlugin>("NativePlacePicker");
function getErrorCode(err: unknown) {
    if (err && typeof err === "object" && "code" in err) {
        const code = (err as {
            code?: unknown;
        }).code;
        return typeof code === "string" ? code : null;
    }
    return null;
}
function formatCoords(lat: number, lng: number) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function normalizePlaceName(name: string | null | undefined) {
    const trimmed = name?.trim();
    return trimmed ? trimmed : undefined;
}

function splitBrowserDisplayName(displayName: string) {
    const parts = displayName
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length <= 1) {
        return {
            name: normalizePlaceName(displayName),
            address: displayName,
        };
    }

    return {
        name: normalizePlaceName(parts[0]),
        address: parts.slice(1).join(", "),
    };
}

function getBrowserLocation(): Promise<PlaceResult | null> {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
        return Promise.reject(new Error("Location access is not available in this browser."));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            resolve({
                lat,
                lng,
                address: `Current location (${formatCoords(lat, lng)})`,
            });
        }, (error) => {
            if (error.code === error.PERMISSION_DENIED) {
                reject(new Error("Location permission was denied. Make sure location is allowed for this site and for Safari in your device or system location settings, then try again."));
                return;
            }
            reject(new Error(error.message || "Unable to access your location."));
        }, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
        });
    });
}

async function searchBrowserPlaces(query: string, limit = 6): Promise<PlaceSuggestion[]> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("dedupe", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("q", query);

    const response = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        throw new Error("Unable to search locations right now.");
    }
    const results = (await response.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
        namedetails?: {
            name?: string;
            [key: string]: string | undefined;
        };
    }>;
    return results.map((item) => {
        const parsed = splitBrowserDisplayName(item.display_name);
        const preferredName = normalizePlaceName(item.name)
            ?? normalizePlaceName(item.namedetails?.name)
            ?? parsed.name;
        return {
            lat: Number(item.lat),
            lng: Number(item.lon),
            address: parsed.address,
            name: preferredName,
        };
    });
}
export class NativePlacePicker {
    static shouldUseNativePicker() {
        return typeof window !== "undefined" &&
            Capacitor.isNativePlatform() &&
            Capacitor.getPlatform() === "ios";
    }

    static isNativeAvailable() {
        return this.shouldUseNativePicker();
    }

    static isAndroidNativeSearchAvailable() {
        return typeof window !== "undefined" &&
            Capacitor.isNativePlatform() &&
            Capacitor.getPlatform() === "android";
    }

    static async pickPlace(): Promise<PlaceResult | null> {
        try {
            if (this.shouldUseNativePicker()) {
                const result = await CapacitorNativePlacePicker.pickPlace();
                if (!result) {
                    return null;
                }
                if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
                    throw new Error("The selected location did not include coordinates.");
                }
                if (result.lat === 0 && result.lng === 0 && !result.address) {
                    return null;
                }
                return {
                    lat: result.lat,
                    lng: result.lng,
                    address: result.address?.trim() || `Selected location (${formatCoords(result.lat, result.lng)})`,
                };
            }
            return await getBrowserLocation();
        }
        catch (err) {
            if (getErrorCode(err) === "UNIMPLEMENTED") {
                throw new Error("The native location picker is not available in this build yet. Sync Capacitor and rebuild the app.");
            }
            throw err;
        }
    }

    static async searchPlaces(query: string, limit = 6): Promise<PlaceSuggestion[]> {
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }
        if (this.isAndroidNativeSearchAvailable()) {
            const result = await CapacitorNativePlacePicker.searchPlaces({
                query: trimmed,
                limit,
            });
            return result.results ?? [];
        }
        return searchBrowserPlaces(trimmed, limit);
    }

    static async resolvePlace(placeId: string): Promise<PlaceResult | null> {
        const trimmed = placeId.trim();
        if (!trimmed) {
            return null;
        }

        if (this.isAndroidNativeSearchAvailable()) {
            const result = await CapacitorNativePlacePicker.resolvePlace({
                placeId: trimmed,
            });
            if (!result) {
                return null;
            }
            return result;
        }

        return null;
    }

    static async resetSearchSession(): Promise<void> {
        if (!this.isAndroidNativeSearchAvailable()) {
            return;
        }

        try {
            await CapacitorNativePlacePicker.resetSearchSession();
        }
        catch (err) {
            if (getErrorCode(err) !== "UNIMPLEMENTED") {
                throw err;
            }
        }
    }
}
