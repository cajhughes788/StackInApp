//lib/register-sw.ts
"use client";
/**
 * Registers the service worker.
 * Enables background operations for entry reminders.
 */
export async function registerServiceWorker() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        return;
    }
    //Idempotent guard to prevent double registration
    if ((window as any).swRegistered)
        return;
    (window as any).swRegistered = true;
    // Keep registration triggered on window load
    window.addEventListener("load", async () => {
        try {
            const registration = await navigator.serviceWorker.register("/sw.js", {
                scope: "/",
            });
            (window as any).swRegistration = registration;
        }
        catch (error) {
        }
    });
}
