// lib/mobile/nativeSignupEligibility.ts
// Account creation and the external subscription link are offered in the
// iOS app only where App Review allows linking out to purchase (US).

const NATIVE_SIGNUP_ALLOWED_COUNTRIES = new Set((process.env.NEXT_PUBLIC_NATIVE_SIGNUP_ALLOWED_COUNTRIES ?? "US")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean));
const US_TIMEZONE_HINTS = new Set([
    "America/Adak",
    "America/Anchorage",
    "America/Boise",
    "America/Chicago",
    "America/Denver",
    "America/Detroit",
    "America/Indiana/Indianapolis",
    "America/Juneau",
    "America/Kentucky/Louisville",
    "America/Los_Angeles",
    "America/Menominee",
    "America/Metlakatla",
    "America/New_York",
    "America/Nome",
    "America/North_Dakota/Beulah",
    "America/North_Dakota/Center",
    "America/North_Dakota/New_Salem",
    "America/Phoenix",
    "America/Sitka",
    "America/Yakutat",
    "Pacific/Honolulu",
]);

function getLocaleRegion(locale: string): string | null {
    try {
        if (typeof Intl !== "undefined" && "Locale" in Intl) {
            const region = new Intl.Locale(locale).region;
            if (region) {
                return region.toUpperCase();
            }
        }
    }
    catch {
    }
    const segments = locale
        .split(/[-_]/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (/^[A-Za-z]{2}$/.test(segment)) {
            return segment.toUpperCase();
        }
    }
    return null;
}

export function detectNativeSignupCountryEligibility() {
    if (typeof window === "undefined") {
        return false;
    }
    const locales = Array.from(new Set([
        ...(navigator.languages ?? []),
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().locale,
    ].filter(Boolean)));
    for (const locale of locales) {
        const region = getLocaleRegion(locale);
        if (region && NATIVE_SIGNUP_ALLOWED_COUNTRIES.has(region)) {
            return true;
        }
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return US_TIMEZONE_HINTS.has(timeZone);
}
