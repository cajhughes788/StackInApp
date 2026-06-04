"use client";
import { DateTime } from "luxon";
import { getEntriesForPeriod } from "@/lib/api";
import * as settingsService from "@/lib/domain/settingsService";
import { debugError, debugLog } from "@/lib/debugLoop";
import { flushNativeGeofenceDiagnostics } from "@/lib/mobile/geofenceDiagnostics";
import { NativeGeofence, type NativeGeofenceRecord, type NativeGeofenceWorkspaceEntryStatus, } from "@/plugins/NativeGeofence";
import { getCurrentPayPeriodAt } from "@shared/payPeriods";
import type { WorkspaceSummary } from "@shared/contracts/workspace";
import type { SettingsType } from "@shared/schemas/settings";

const LOCATION_PLACEHOLDER_ADDRESS = "Pick a location";

function logGeofenceSyncInfo(stage: string, payload: Record<string, unknown> = {}) {
    console.info(`[NativeGeofenceSync] ${stage}`, payload);
}

function logGeofenceSyncError(stage: string, payload: Record<string, unknown> = {}) {
    console.error(`[NativeGeofenceSync] ${stage}`, payload);
}

function hasChosenLocationReminderAddress(address?: string): boolean {
    const normalized = address?.trim();
    return !!normalized && normalized !== LOCATION_PLACEHOLDER_ADDRESS;
}

function getUsableLocationReminders(settings: SettingsType | null) {
    return (settings?.common?.locationEntryReminders ?? []).filter((reminder) => reminder.enabled && hasChosenLocationReminderAddress(reminder.address));
}

function hasEnabledGeofenceReminder(settings: SettingsType | null): boolean {
    if (!settings?.common?.entryRemindersEnabled) {
        return false;
    }
    return getUsableLocationReminders(settings).length > 0;
}
function buildWorkspaceGeofences(workspace: WorkspaceSummary, settings: SettingsType | null): NativeGeofenceRecord[] {
    if (!settings?.common?.entryRemindersEnabled) {
        ;
        return [];
    }
    const geofences = getUsableLocationReminders(settings)
        .map((reminder) => ({
        id: `geofence:${workspace.id}:${reminder.id}`,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        reminderId: reminder.id,
        label: reminder.label,
        latitude: reminder.latitude,
        longitude: reminder.longitude,
        radiusMeters: reminder.radiusMeters,
        trigger: reminder.trigger,
        deliveryMode: reminder.deliveryMode ?? "if_no_entry",
    }));
    ;
    return geofences;
}
export async function syncWorkspaceGeofenceReminders(workspace: WorkspaceSummary, settings: SettingsType | null) {
    if (!NativeGeofence.isNativeAvailable())
        return;
    logGeofenceSyncInfo("single_workspace_sync_start", {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        remindersEnabled: !!settings?.common?.entryRemindersEnabled,
    });
    debugLog("native-geofence", "single_workspace_sync_start", {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        remindersEnabled: !!settings?.common?.entryRemindersEnabled,
    });
    if (!hasEnabledGeofenceReminder(settings)) {
        await flushNativeGeofenceDiagnostics(`single_workspace_sync:${workspace.id}:skipped`);
        return;
    }
    let status = await NativeGeofence.getStatus();
    await flushNativeGeofenceDiagnostics(`single_workspace_sync:${workspace.id}:status`);
    logGeofenceSyncInfo("single_workspace_sync_status", {
        workspaceId: workspace.id,
        granted: status.granted,
        backgroundGranted: status.backgroundGranted ?? false,
        notificationGranted: status.notificationGranted ?? false,
        monitoredCount: status.monitoredCount,
    });
    debugLog("native-geofence", "single_workspace_sync_status", {
        workspaceId: workspace.id,
        granted: status.granted,
        backgroundGranted: status.backgroundGranted ?? false,
        notificationGranted: status.notificationGranted ?? false,
        monitoredCount: status.monitoredCount,
    });
    if (!status.granted || !status.backgroundGranted || !status.notificationGranted) {
        const permission = await NativeGeofence.requestPermissions();
        await flushNativeGeofenceDiagnostics(`single_workspace_sync:${workspace.id}:permissions`);
        logGeofenceSyncInfo("single_workspace_sync_permissions", {
            workspaceId: workspace.id,
            granted: permission.granted,
            backgroundGranted: permission.backgroundGranted ?? false,
            notificationGranted: permission.notificationGranted ?? false,
        });
        debugLog("native-geofence", "single_workspace_sync_permissions", {
            workspaceId: workspace.id,
            granted: permission.granted,
            backgroundGranted: permission.backgroundGranted ?? false,
            notificationGranted: permission.notificationGranted ?? false,
        });
        if (!permission.granted || !permission.backgroundGranted || !permission.notificationGranted)
            return;
    }
    const geofences = buildWorkspaceGeofences(workspace, settings);
    try {
        const result = await NativeGeofence.syncGeofences(geofences);
        await flushNativeGeofenceDiagnostics(`single_workspace_sync:${workspace.id}:sync`);
        logGeofenceSyncInfo("single_workspace_sync_complete", {
            workspaceId: workspace.id,
            geofenceCount: geofences.length,
            syncedCount: result.count,
            ok: result.ok,
        });
        debugLog("native-geofence", "single_workspace_sync_complete", {
            workspaceId: workspace.id,
            geofenceCount: geofences.length,
            syncedCount: result.count,
            ok: result.ok,
        });
    }
    catch (error) {
        await flushNativeGeofenceDiagnostics(`single_workspace_sync:${workspace.id}:sync_failed`);
        logGeofenceSyncError("single_workspace_sync_failed", {
            workspaceId: workspace.id,
            geofenceCount: geofences.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("native-geofence", "single_workspace_sync_failed", {
            workspaceId: workspace.id,
            geofenceCount: geofences.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
}
export async function syncAllWorkspaceGeofenceReminders(workspaces: WorkspaceSummary[]) {
    ;
    if (!NativeGeofence.isNativeAvailable())
        return;
    logGeofenceSyncInfo("all_workspace_sync_start", {
        workspaceCount: workspaces.length,
        workspaceIds: workspaces.map((workspace) => workspace.id),
    });
    debugLog("workspace-delete", "geofence_sync_start", {
        workspaceCount: workspaces.length,
        workspaceIds: workspaces.map((workspace) => workspace.id),
    });
    const geofences: NativeGeofenceRecord[] = [];
    let shouldRequestPermissions = false;
    try {
        const allSettings = await Promise.all(
            workspaces.map((workspace) => settingsService.loadForWorkspace(workspace.id))
        );
        for (let i = 0; i < workspaces.length; i++) {
            const workspace = workspaces[i];
            const settings = allSettings[i];
            if (hasEnabledGeofenceReminder(settings)) {
                shouldRequestPermissions = true;
            }
            geofences.push(...buildWorkspaceGeofences(workspace, settings));
        }
    }
    catch (error) {
        logGeofenceSyncError("all_workspace_sync_settings_load_failed", {
            workspaceCount: workspaces.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("workspace-delete", "geofence_sync_settings_load_failed", {
            workspaceCount: workspaces.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
    if (!shouldRequestPermissions) {
        await NativeGeofence.syncGeofences([]);
        await flushNativeGeofenceDiagnostics("all_workspace_sync:cleared_all");
        logGeofenceSyncInfo("all_workspace_sync_cleared_all", {
            workspaceCount: workspaces.length,
        });
        debugLog("workspace-delete", "geofence_sync_cleared_all", {
            workspaceCount: workspaces.length,
        });
        return;
    }
    let status = await NativeGeofence.getStatus();
    await flushNativeGeofenceDiagnostics("all_workspace_sync:status");
    if (!status.granted || !status.backgroundGranted || !status.notificationGranted) {
        const permission = await NativeGeofence.requestPermissions();
        await flushNativeGeofenceDiagnostics("all_workspace_sync:permissions");
        if (!permission.granted || !permission.backgroundGranted || !permission.notificationGranted)
            return;
    }
    try {
        const result = await NativeGeofence.syncGeofences(geofences);
        await flushNativeGeofenceDiagnostics("all_workspace_sync:sync");
        logGeofenceSyncInfo("all_workspace_sync_complete", {
            workspaceCount: workspaces.length,
            geofenceCount: geofences.length,
            syncedCount: result.count,
            ok: result.ok,
        });
        debugLog("workspace-delete", "geofence_sync_complete", {
            workspaceCount: workspaces.length,
            geofenceCount: geofences.length,
            syncedCount: result.count,
            ok: result.ok,
        });
    }
    catch (error) {
        await flushNativeGeofenceDiagnostics("all_workspace_sync:sync_failed");
        logGeofenceSyncError("all_workspace_sync_failed", {
            workspaceCount: workspaces.length,
            geofenceCount: geofences.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("workspace-delete", "geofence_sync_failed", {
            workspaceCount: workspaces.length,
            geofenceCount: geofences.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
}
async function buildWorkspaceEntryStatus(workspace: WorkspaceSummary, settings: SettingsType | null): Promise<NativeGeofenceWorkspaceEntryStatus> {
    const zone = settings?.common?.timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateKey = DateTime.now().setZone(zone).toISODate()!;
    if (!settings) {
        ;
        return {
            workspaceId: workspace.id,
            dateKey,
            hasEntryToday: false,
        };
    }
    const period = getCurrentPayPeriodAt(settings, `${dateKey}T12:00:00`);
    const entries = await getEntriesForPeriod(workspace.id, period.periodId).catch(() => []);
    ;
    return {
        workspaceId: workspace.id,
        dateKey,
        hasEntryToday: entries.some((entry) => entry.date === dateKey),
    };
}
export async function syncAllWorkspaceGeofenceEntryStatus(workspaces: WorkspaceSummary[]) {
    if (!NativeGeofence.isNativeAvailable())
        return;
    logGeofenceSyncInfo("entry_status_sync_start", {
        workspaceCount: workspaces.length,
        workspaceIds: workspaces.map((workspace) => workspace.id),
    });
    debugLog("workspace-delete", "geofence_entry_status_sync_start", {
        workspaceCount: workspaces.length,
        workspaceIds: workspaces.map((workspace) => workspace.id),
    });
    let statuses: NativeGeofenceWorkspaceEntryStatus[];
    try {
        statuses = await Promise.all(
            workspaces.map(async (workspace) => {
                const settings = await settingsService.loadForWorkspace(workspace.id);
                return buildWorkspaceEntryStatus(workspace, settings);
            })
        );
    }
    catch (error) {
        logGeofenceSyncError("entry_status_prepare_failed", {
            workspaceCount: workspaces.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("workspace-delete", "geofence_entry_status_prepare_failed", {
            workspaceCount: workspaces.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
    try {
        const result = await NativeGeofence.syncWorkspaceEntryStatus(statuses);
        await flushNativeGeofenceDiagnostics("all_workspace_entry_status:sync");
        logGeofenceSyncInfo("entry_status_sync_complete", {
            workspaceCount: workspaces.length,
            statusCount: statuses.length,
            syncedCount: result.count,
            ok: result.ok,
        });
        debugLog("workspace-delete", "geofence_entry_status_sync_complete", {
            workspaceCount: workspaces.length,
            statusCount: statuses.length,
            syncedCount: result.count,
            ok: result.ok,
        });
    }
    catch (error) {
        await flushNativeGeofenceDiagnostics("all_workspace_entry_status:sync_failed");
        logGeofenceSyncError("entry_status_sync_failed", {
            workspaceCount: workspaces.length,
            statusCount: statuses.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("workspace-delete", "geofence_entry_status_sync_failed", {
            workspaceCount: workspaces.length,
            statusCount: statuses.length,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
}
export async function syncWorkspaceGeofenceEntryStatus(workspace: WorkspaceSummary, settings: SettingsType | null) {
    if (!NativeGeofence.isNativeAvailable())
        return;
    const status = await buildWorkspaceEntryStatus(workspace, settings);
    try {
        const result = await NativeGeofence.syncWorkspaceEntryStatus([status]);
        await flushNativeGeofenceDiagnostics(`single_workspace_entry_status:${workspace.id}:sync`);
        logGeofenceSyncInfo("single_workspace_entry_status_sync_complete", {
            workspaceId: workspace.id,
            dateKey: status.dateKey,
            hasEntryToday: status.hasEntryToday,
            syncedCount: result.count,
            ok: result.ok,
        });
        debugLog("native-geofence", "single_workspace_entry_status_sync_complete", {
            workspaceId: workspace.id,
            dateKey: status.dateKey,
            hasEntryToday: status.hasEntryToday,
            syncedCount: result.count,
            ok: result.ok,
        });
    }
    catch (error) {
        await flushNativeGeofenceDiagnostics(`single_workspace_entry_status:${workspace.id}:sync_failed`);
        logGeofenceSyncError("single_workspace_entry_status_sync_failed", {
            workspaceId: workspace.id,
            dateKey: status.dateKey,
            hasEntryToday: status.hasEntryToday,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        debugError("native-geofence", "single_workspace_entry_status_sync_failed", {
            workspaceId: workspace.id,
            dateKey: status.dateKey,
            hasEntryToday: status.hasEntryToday,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        throw error;
    }
}
