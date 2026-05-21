"use client";
import { useEffect } from "react";
import { App } from "@capacitor/app";
import { flushNativeGeofenceDiagnostics } from "@/lib/mobile/geofenceDiagnostics";
import { NativeGeofence } from "@/plugins/NativeGeofence";

export function useGeofenceReminderEvents() {
    useEffect(() => {
        let triggerCleanup: {
            remove: () => Promise<void> | void;
        } | null = null;
        let diagnosticCleanup: {
            remove: () => Promise<void> | void;
        } | null = null;
        let resumeCleanup: {
            remove: () => Promise<void> | void;
        } | null = null;
        let cancelled = false;
        async function setup() {
            if (!NativeGeofence.isNativeAvailable()) {
                return;
            }
            try {
                const status = await NativeGeofence.getStatus().catch(() => null);
                if (cancelled) {
                    return;
                }

                await flushNativeGeofenceDiagnostics("hook:setup");
                diagnosticCleanup = await NativeGeofence.addDiagnosticListener(async (event) => {
                    const payload = {
                        source: "hook:live",
                        ts: event.ts,
                        ...(event.fields ?? {}),
                    };

                    if (event.level === "error") {
                        console.error(`[NativeGeofence] ${event.stage}`, payload);
                        return;
                    }

                    console.info(`[NativeGeofence] ${event.stage}`, payload);
                });

                resumeCleanup = await App.addListener("resume", () => {
                    void flushNativeGeofenceDiagnostics("hook:resume");
                });

                if (!status?.granted) {
                    console.info("[NativeGeofence] listener setup skipped until location permission is granted", status);
                    return;
                }

                triggerCleanup = await NativeGeofence.addTriggerListener(async (event) => {
                    console.info("[NativeGeofence] native trigger received", event);
                });
            }
            catch (error) {
                console.error("[NativeGeofence] listener setup failed", error);
            }
        }
        void setup();
        return () => {
            cancelled = true;
            void triggerCleanup?.remove();
            void diagnosticCleanup?.remove();
            void resumeCleanup?.remove();
        };
    }, []);
}
