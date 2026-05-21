"use client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { ensureNativePermissionGuide } from "@/lib/mobile/nativePermissionGuide";
export type GeofenceTrigger = "arrive" | "leave";
export type NativeGeofenceRecord = {
    id: string;
    workspaceId: string;
    workspaceName?: string;
    reminderId: string;
    label: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    trigger: GeofenceTrigger;
    deliveryMode?: "always" | "if_no_entry";
};
export type NativeGeofenceTriggeredEvent = {
    id: string;
    workspaceId: string;
    reminderId: string;
    trigger: GeofenceTrigger;
};
export type NativeGeofenceDiagnosticEvent = {
    ts: number;
    level: "info" | "error";
    stage: string;
    fields?: Record<string, unknown> | null;
};
export type NativeGeofenceWorkspaceEntryStatus = {
    workspaceId: string;
    dateKey: string;
    hasEntryToday: boolean;
};
export type NativeGeofenceStatus = {
    granted: boolean;
    backgroundGranted?: boolean;
    notificationGranted?: boolean;
    monitoredCount: number;
};
type NativeGeofencePlugin = {
    requestPermissions(): Promise<{
        granted: boolean;
        backgroundGranted?: boolean;
        notificationGranted?: boolean;
    }>;
    syncGeofences(options: {
        geofences: NativeGeofenceRecord[];
    }): Promise<{
        ok: boolean;
        count: number;
    }>;
    syncWorkspaceEntryStatus(options: {
        statuses: NativeGeofenceWorkspaceEntryStatus[];
    }): Promise<{
        ok: boolean;
        count: number;
    }>;
    getStatus(): Promise<NativeGeofenceStatus>;
    removeAllGeofences(): Promise<{
        ok: boolean;
    }>;
    drainDiagnostics(): Promise<{
        events: NativeGeofenceDiagnosticEvent[];
        count: number;
    }>;
    addListener(eventName: "geofenceTriggered", listenerFunc: (event: NativeGeofenceTriggeredEvent) => void): Promise<{
        remove: () => Promise<void> | void;
    }>;
    addListener(eventName: "geofenceDiagnostic", listenerFunc: (event: NativeGeofenceDiagnosticEvent) => void): Promise<{
        remove: () => Promise<void> | void;
    }>;
};
const CapacitorNativeGeofence = registerPlugin<NativeGeofencePlugin>("NativeGeofence");
export class NativeGeofence {
    static isNativeAvailable() {
        return typeof window !== "undefined" && Capacitor.isNativePlatform();
    }
    static async requestPermissions() {
        if (!this.isNativeAvailable()) {
            return {
                granted: false,
                backgroundGranted: false,
                notificationGranted: false,
            };
        }
        const status = await this.getStatus();
        if (status.granted && status.backgroundGranted && status.notificationGranted) {
            return {
                granted: true,
                backgroundGranted: true,
                notificationGranted: true,
            };
        }
        const shouldContinue = await ensureNativePermissionGuide();
        if (!shouldContinue) {
            return {
                granted: false,
                backgroundGranted: false,
                notificationGranted: false,
            };
        }
        const result = await CapacitorNativeGeofence.requestPermissions();
        return result;
    }
    static async syncGeofences(geofences: NativeGeofenceRecord[]) {
        if (!this.isNativeAvailable()) {
            return { ok: false, count: 0 };
        }
        const result = await CapacitorNativeGeofence.syncGeofences({ geofences });
        return result;
    }
    static async syncWorkspaceEntryStatus(statuses: NativeGeofenceWorkspaceEntryStatus[]) {
        if (!this.isNativeAvailable()) {
            return { ok: false, count: 0 };
        }
        const result = await CapacitorNativeGeofence.syncWorkspaceEntryStatus({ statuses });
        return result;
    }
    static async getStatus(): Promise<NativeGeofenceStatus> {
        if (!this.isNativeAvailable()) {
            return {
                granted: false,
                backgroundGranted: false,
                notificationGranted: false,
                monitoredCount: 0,
            };
        }
        const result = await CapacitorNativeGeofence.getStatus();
        return result;
    }
    static async removeAllGeofences() {
        if (!this.isNativeAvailable()) {
            return { ok: false };
        }
        const result = await CapacitorNativeGeofence.removeAllGeofences();
        return result;
    }
    static async drainDiagnostics() {
        if (!this.isNativeAvailable()) {
            return { events: [], count: 0 };
        }
        const result = await CapacitorNativeGeofence.drainDiagnostics();
        return result;
    }
    static async addTriggerListener(listener: (event: NativeGeofenceTriggeredEvent) => void) {
        if (!this.isNativeAvailable()) {
            return {
                remove: async () => { },
            };
        }
        return CapacitorNativeGeofence.addListener("geofenceTriggered", (event) => {
            listener(event);
        });
    }
    static async addDiagnosticListener(listener: (event: NativeGeofenceDiagnosticEvent) => void) {
        if (!this.isNativeAvailable()) {
            return {
                remove: async () => { },
            };
        }
        return CapacitorNativeGeofence.addListener("geofenceDiagnostic", (event) => {
            listener(event);
        });
    }
}
