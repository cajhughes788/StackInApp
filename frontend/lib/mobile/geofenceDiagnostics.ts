"use client";

import { NativeGeofence, type NativeGeofenceDiagnosticEvent } from "@/plugins/NativeGeofence";

function writeDiagnosticToConsole(source: string, event: NativeGeofenceDiagnosticEvent) {
    const payload = {
        source,
        ts: event.ts,
        ...(event.fields ?? {}),
    };

    if (event.level === "error") {
        console.error(`[NativeGeofence] ${event.stage}`, payload);
        return;
    }

    console.info(`[NativeGeofence] ${event.stage}`, payload);
}

export async function flushNativeGeofenceDiagnostics(source: string) {
    if (!NativeGeofence.isNativeAvailable()) {
        return [];
    }

    try {
        const result = await NativeGeofence.drainDiagnostics();
        console.info("[NativeGeofence] diagnostic_flush", {
            source,
            count: result.count,
        });
        for (const event of result.events) {
            writeDiagnosticToConsole(source, event);
        }
        return result.events;
    }
    catch (error) {
        console.error("[NativeGeofence] diagnostic_flush_failed", {
            source,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        return [];
    }
}
