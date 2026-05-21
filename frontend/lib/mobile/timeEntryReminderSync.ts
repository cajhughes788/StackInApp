"use client";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { DateTime } from "luxon";
import { getEntriesForPeriod } from "@/lib/api";
import * as settingsService from "@/lib/domain/settingsService";
import { debugError, debugLog } from "@/lib/debugLoop";
import { getCurrentPayPeriodAt } from "@shared/payPeriods";
import type { WorkspaceSummary } from "@shared/contracts/workspace";
import type {
  EntryReminderDeliveryModeType,
  SettingsType,
  TimeEntryReminderType,
} from "@shared/schemas/settings";
const ENTRY_REMINDER_KIND = "entry-time-reminder";
const REMINDER_HORIZON_DAYS = 7;
type NotificationPlugin = typeof LocalNotifications;
const NOTIFICATION_CALL_TIMEOUT_MS = 8000;

function logTimeReminderInfo(stage: string, payload: Record<string, unknown> = {}) {
    console.info(`[TimeReminder] ${stage}`, payload);
}

function logTimeReminderError(stage: string, payload: Record<string, unknown> = {}) {
    console.error(`[TimeReminder] ${stage}`, payload);
}

function isEntryTimeReminderNotification(notification: {
    id: number;
    extra?: {
        kind?: unknown;
        workspaceId?: unknown;
        reminderId?: unknown;
        dateKey?: unknown;
    };
}, workspaceId: string, reminderId: string) {
    return notification?.extra?.kind === ENTRY_REMINDER_KIND &&
        notification?.extra?.workspaceId === workspaceId &&
        notification?.extra?.reminderId === reminderId;
}

async function getExactAlarmState(notifications: NotificationPlugin) {
    if (Capacitor.getPlatform() !== "android") {
        return null;
    }

    try {
        const exactSetting = await withNotificationTimeout(
            "checkExactNotificationSetting",
            notifications.checkExactNotificationSetting()
        );
        return exactSetting.exact_alarm ?? null;
    }
    catch (error) {
        logTimeReminderError("exact_alarm_status_failed", {
            platform: Capacitor.getPlatform(),
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        return null;
    }
}

async function loadMatchingPendingReminderSummaries(
    notifications: NotificationPlugin,
    workspaceId: string,
    reminderId: string
) {
    try {
        const pending = await withNotificationTimeout(
            "getPending",
            notifications.getPending()
        );

        return pending.notifications
            .filter((notification) =>
                isEntryTimeReminderNotification(notification as any, workspaceId, reminderId)
            )
            .map((notification) => ({
                id: notification.id,
                title: notification.title ?? null,
                body: notification.body ?? null,
                scheduleAt:
                    notification.schedule?.at instanceof Date
                        ? notification.schedule.at.toISOString()
                        : notification.schedule?.at ?? null,
                dateKey:
                    typeof notification.extra?.dateKey === "string"
                        ? notification.extra.dateKey
                        : null,
            }));
    }
    catch (error) {
        logTimeReminderError("pending_load_failed", {
            workspaceId,
            reminderId,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        return [];
    }
}

function isNativeReminderEnvironment() {
    return typeof window !== "undefined";
}
async function withNotificationTimeout<T>(label: string, task: Promise<T>): Promise<T> {
    ;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        const result = await Promise.race([
            task,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`${label} timed out`));
                }, NOTIFICATION_CALL_TIMEOUT_MS);
            }),
        ]);
        ;
        return result;
    }
    catch (error) {
        ;
        throw error;
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
function toNumericId(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 2147483647;
}
function buildNotificationId(workspaceId: string, reminderId: string, dateKey: string) {
    return toNumericId(`${ENTRY_REMINDER_KIND}:${workspaceId}:${reminderId}:${dateKey}`);
}

function getReminderZone(settings: SettingsType | null) {
    return settings?.common?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function ensureNotificationPermission(notifications: NotificationPlugin) {
    ;
    const current = await withNotificationTimeout("checkPermissions", notifications.checkPermissions());
    ;
    if (current.display === "granted")
        return true;
    const requested = await withNotificationTimeout("requestPermissions", notifications.requestPermissions());
    ;
    return requested.display === "granted";
}
async function cancelWorkspaceTimeReminders(notifications: NotificationPlugin, workspaceId: string, reminderId: string) {
    const matchingIds = Array.from({ length: REMINDER_HORIZON_DAYS }, (_, dayOffset) => {
        const dateKey = DateTime.now()
            .plus({ days: dayOffset })
            .toISODate();
        if (!dateKey)
            return null;
        return {
            id: buildNotificationId(workspaceId, reminderId, dateKey),
        };
    }).filter((notification): notification is {
        id: number;
    } => {
        return notification !== null && Number.isFinite(notification.id);
    });
    if (matchingIds.length === 0)
        return;
    ;
    await withNotificationTimeout("cancel", notifications.cancel({ notifications: matchingIds }));
}

async function cancelTimeReminderForDate(notifications: NotificationPlugin, workspaceId: string, reminderId: string, dateKey: string) {
    const id = buildNotificationId(workspaceId, reminderId, dateKey);
    await withNotificationTimeout("cancel", notifications.cancel({
        notifications: [{ id }],
    }));
}

async function getScheduledEntryDateKeys(
    workspaceId: string,
    settings: SettingsType,
    zone: string,
    now: DateTime
) {
    const periodIds = new Set<string>();

    for (let dayOffset = 0; dayOffset < REMINDER_HORIZON_DAYS; dayOffset += 1) {
        const dateKey = now.startOf("day").plus({ days: dayOffset }).toISODate();
        if (!dateKey) {
            continue;
        }

        const period = getCurrentPayPeriodAt(settings, `${dateKey}T12:00:00`);
        periodIds.add(period.periodId);
    }

    const entriesByPeriod = await Promise.all(
        Array.from(periodIds).map(async (periodId) => {
            try {
                return await getEntriesForPeriod(workspaceId, periodId);
            }
            catch {
                return [];
            }
        })
    );

    return new Set(
        entriesByPeriod
            .flat()
            .map((entry) => entry.date)
            .filter((dateKey): dateKey is string => typeof dateKey === "string" && dateKey.length > 0)
    );
}
function formatReminderTime(time: string, zone?: string) {
    const parsed = DateTime.fromFormat(time, "HH:mm", {
        zone: zone || undefined,
    });
    if (!parsed.isValid) {
        return time;
    }
    return parsed.toFormat("h:mm a");
}
function getReminderDeliveryMode(
    reminder: Pick<TimeEntryReminderType, "deliveryMode">
): EntryReminderDeliveryModeType {
    return reminder.deliveryMode ?? "if_no_entry";
}
function buildReminderTitleForTime(reminderTime: string, zone?: string) {
    return `It is ${formatReminderTime(reminderTime, zone)}`;
}
function buildReminderBody(workspaceName: string) {
    return `Add your entry for your ${workspaceName} workspace`;
}

function getEnabledReminder(settings: SettingsType): TimeEntryReminderType | null {
    const reminder = settings.common?.timeEntryReminders?.[0] ?? null;
    if (!reminder?.enabled)
        return null;
    return reminder;
}

function buildTriggerAt(dateKey: string, reminderTime: string, zone: string) {
    const day = DateTime.fromISO(dateKey, { zone });
    if (!day.isValid) {
        return null;
    }

    const [hourText, minuteText] = reminderTime.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    return day.set({
        hour,
        minute,
        second: 0,
        millisecond: 0,
    });
}

function isManagedReminderDate(dateKey: string, zone: string, now: DateTime) {
    const day = DateTime.fromISO(dateKey, { zone }).startOf("day");
    if (!day.isValid) {
        return false;
    }

    const today = now.startOf("day");
    const horizonEnd = today.plus({ days: REMINDER_HORIZON_DAYS - 1 });
    return day >= today && day <= horizonEnd;
}

function buildScheduledTimeNotification(
    workspace: WorkspaceSummary,
    reminder: TimeEntryReminderType,
    dateKey: string,
    zone: string,
    now: DateTime
) {
    const triggerAt = buildTriggerAt(dateKey, reminder.time, zone);
    if (!triggerAt || triggerAt <= now.plus({ seconds: 30 })) {
        return null;
    }

    return {
        id: buildNotificationId(workspace.id, reminder.id, dateKey),
        title: buildReminderTitleForTime(reminder.time, zone),
        body: buildReminderBody(workspace.name),
        schedule: {
            at: triggerAt.toJSDate(),
            allowWhileIdle: true,
        },
        extra: {
            kind: ENTRY_REMINDER_KIND,
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
        },
    };
}

function shouldRequireExactAlarms() {
    return Capacitor.getPlatform() === "android";
}

export async function syncWorkspaceTimeEntryReminderForDate(
    workspace: WorkspaceSummary,
    settings: SettingsType | null,
    dateKey: string,
    hasEntryForDateKey: boolean
) {
    logTimeReminderInfo("date_sync_start", {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        dateKey,
        hasEntryForDateKey,
        platform: Capacitor.getPlatform(),
    });

    if (!isNativeReminderEnvironment()) {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            dateKey,
            reason: "not_native_environment",
        });
        return;
    }
    if (!settings?.common?.entryRemindersEnabled) {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            dateKey,
            reason: "entry_reminders_disabled",
        });
        return;
    }

    const reminder = getEnabledReminder(settings);
    if (!reminder) {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            dateKey,
            reason: "no_enabled_time_reminder",
        });
        return;
    }

    const notifications: NotificationPlugin = LocalNotifications;
    const permission = await withNotificationTimeout(
        "checkPermissions",
        notifications.checkPermissions()
    ).catch(() => null);
    const exactAlarm = await getExactAlarmState(notifications);

    logTimeReminderInfo("date_sync_permission_state", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        dateKey,
        displayPermission: permission?.display ?? null,
        exactAlarm,
    });

    if (permission?.display !== "granted") {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
            reason: "notification_permission_not_granted",
        });
        return;
    }

    await cancelTimeReminderForDate(notifications, workspace.id, reminder.id, dateKey);
    logTimeReminderInfo("date_sync_existing_cancelled", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        dateKey,
    });

    const zone = getReminderZone(settings);
    const now = DateTime.now().setZone(zone);
    if (shouldRequireExactAlarms() && exactAlarm !== "granted") {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
            reason: "exact_alarm_not_granted",
            exactAlarm,
        });
        return;
    }

    if (!isManagedReminderDate(dateKey, zone, now)) {
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
            reason: "date_outside_managed_horizon",
            zone,
            now: now.toISO(),
        });
        return;
    }

    const deliveryMode = getReminderDeliveryMode(reminder);
    if (deliveryMode === "if_no_entry" && hasEntryForDateKey) {
        logTimeReminderInfo("date_sync_suppressed_existing_entry", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
            deliveryMode,
        });
        return;
    }

    const notification = buildScheduledTimeNotification(
        workspace,
        reminder,
        dateKey,
        zone,
        now
    );

    if (!notification) {
        const triggerAt = buildTriggerAt(dateKey, reminder.time, zone);
        logTimeReminderInfo("date_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            dateKey,
            reason: "notification_trigger_invalid_or_too_close",
            zone,
            now: now.toISO(),
            triggerAt: triggerAt?.toISO() ?? null,
        });
        return;
    }

    logTimeReminderInfo("date_sync_schedule_request", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        dateKey,
        notificationId: notification.id,
        deliveryMode,
        reminderTime: reminder.time,
        scheduledAt:
            notification.schedule.at instanceof Date
                ? notification.schedule.at.toISOString()
                : String(notification.schedule.at),
        zone,
        now: now.toISO(),
        exactAlarm,
        allowWhileIdle: notification.schedule.allowWhileIdle,
    });

    await withNotificationTimeout("schedule", notifications.schedule({
        notifications: [notification],
    }));

    const pendingMatches = await loadMatchingPendingReminderSummaries(
        notifications,
        workspace.id,
        reminder.id
    );

    logTimeReminderInfo("date_sync_schedule_success", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        dateKey,
        notificationId: notification.id,
        pendingMatchingCount: pendingMatches.length,
        pendingMatches,
    });
}

export async function syncWorkspaceTimeEntryReminders(workspace: WorkspaceSummary, settings: SettingsType | null) {
    logTimeReminderInfo("workspace_sync_start", {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        platform: Capacitor.getPlatform(),
    });
    if (!isNativeReminderEnvironment()) {
        logTimeReminderInfo("workspace_sync_skipped", {
            workspaceId: workspace.id,
            reason: "not_native_environment",
        });
        return;
    }
    if (!settings?.common?.entryRemindersEnabled) {
        logTimeReminderInfo("workspace_sync_skipped", {
            workspaceId: workspace.id,
            reason: "entry_reminders_disabled",
        });
        return;
    }
    const reminder = getEnabledReminder(settings);
    if (!reminder) {
        logTimeReminderInfo("workspace_sync_skipped", {
            workspaceId: workspace.id,
            reason: "no_enabled_time_reminder",
        });
        return;
    }
    const notifications: NotificationPlugin = LocalNotifications;
    let hasPermission = false;
    try {
        hasPermission = await ensureNotificationPermission(notifications);
    }
    catch (error) {
        logTimeReminderError("workspace_sync_permission_failed", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        return;
    }
    const exactAlarm = await getExactAlarmState(notifications);
    logTimeReminderInfo("workspace_sync_permission_state", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        deliveryMode: getReminderDeliveryMode(reminder),
        displayPermissionGranted: hasPermission,
        exactAlarm,
    });
    if (!hasPermission) {
        logTimeReminderInfo("workspace_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            reason: "notification_permission_not_granted",
        });
        return;
    }
    await cancelWorkspaceTimeReminders(notifications, workspace.id, reminder.id);
    logTimeReminderInfo("workspace_sync_existing_cancelled", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        horizonDays: REMINDER_HORIZON_DAYS,
    });
    if (shouldRequireExactAlarms() && exactAlarm !== "granted") {
        logTimeReminderInfo("workspace_sync_skipped", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            reason: "exact_alarm_not_granted",
            exactAlarm,
        });
        return;
    }
    const deliveryMode = getReminderDeliveryMode(reminder);
    const zone = getReminderZone(settings);
    const now = DateTime.now().setZone(zone);
    const scheduledEntryDateKeys = deliveryMode === "if_no_entry"
        ? await getScheduledEntryDateKeys(workspace.id, settings, zone, now)
        : new Set<string>();
    logTimeReminderInfo("workspace_sync_entry_date_keys_loaded", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        deliveryMode,
        zone,
        now: now.toISO(),
        scheduledEntryDateKeyCount: scheduledEntryDateKeys.size,
        scheduledEntryDateKeys: Array.from(scheduledEntryDateKeys).sort(),
    });
    const notificationsToSchedule: any[] = [];
    for (let dayOffset = 0; dayOffset < REMINDER_HORIZON_DAYS; dayOffset += 1) {
        const day = now.startOf("day").plus({ days: dayOffset });
        const dateKey = day.toISODate();
        if (!dateKey)
            continue;
        if (deliveryMode === "if_no_entry" && scheduledEntryDateKeys.has(dateKey)) {
            logTimeReminderInfo("workspace_sync_date_skipped_existing_entry", {
                workspaceId: workspace.id,
                reminderId: reminder.id,
                dateKey,
            });
            continue;
        }
        const notification = buildScheduledTimeNotification(
            workspace,
            reminder,
            dateKey,
            zone,
            now
        );
        if (!notification) {
            continue;
        }
        notificationsToSchedule.push(notification);
    }
    if (notificationsToSchedule.length === 0) {
        logTimeReminderInfo("workspace_sync_complete_no_notifications", {
            workspaceId: workspace.id,
            reminderId: reminder.id,
            deliveryMode,
            zone,
            now: now.toISO(),
        });
        return;
    }
    logTimeReminderInfo("workspace_sync_schedule_request", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        deliveryMode,
        reminderTime: reminder.time,
        exactAlarm,
        notificationCount: notificationsToSchedule.length,
        notifications: notificationsToSchedule.map((notification) => ({
            id: notification.id,
            dateKey: notification.extra?.dateKey ?? null,
            scheduledAt:
                notification.schedule.at instanceof Date
                    ? notification.schedule.at.toISOString()
                    : String(notification.schedule.at),
            allowWhileIdle: notification.schedule.allowWhileIdle,
        })),
    });
    await withNotificationTimeout("schedule", notifications.schedule({
        notifications: notificationsToSchedule,
    }));
    const pendingMatches = await loadMatchingPendingReminderSummaries(
        notifications,
        workspace.id,
        reminder.id
    );
    logTimeReminderInfo("workspace_sync_schedule_success", {
        workspaceId: workspace.id,
        reminderId: reminder.id,
        pendingMatchingCount: pendingMatches.length,
        pendingMatches,
    });
}
export async function syncAllWorkspaceTimeEntryReminders(workspaces: WorkspaceSummary[]) {
    logTimeReminderInfo("all_workspace_sync_start", {
        workspaceCount: workspaces.length,
    });
    for (const workspace of workspaces) {
        const settings = await settingsService.loadForWorkspace(workspace.id);
        await syncWorkspaceTimeEntryReminders(workspace, settings);
    }
    logTimeReminderInfo("all_workspace_sync_complete", {
        workspaceCount: workspaces.length,
    });
}

function isWorkspaceNotification(notification: {
    id: number;
    extra?: {
        workspaceId?: unknown;
    };
}, workspaceId: string): boolean {
    return notification?.extra?.workspaceId === workspaceId;
}

export async function purgeWorkspaceTimeEntryReminders(workspaceId: string): Promise<void> {
    debugLog("workspace-delete", "time_reminder_purge_start", {
        workspaceId,
    });
    if (!isNativeReminderEnvironment()) {
        debugLog("workspace-delete", "time_reminder_purge_skipped", {
            workspaceId,
            reason: "not_native_environment",
        });
        return;
    }

    const notifications: NotificationPlugin = LocalNotifications;

    try {
        const pending = await withNotificationTimeout(
            "getPending",
            notifications.getPending()
        );
        const pendingMatches = pending.notifications.filter((notification) =>
            isWorkspaceNotification(notification as any, workspaceId)
        );
        debugLog("workspace-delete", "time_reminder_pending_loaded", {
            workspaceId,
            pendingCount: pending.notifications.length,
            matchingPendingCount: pendingMatches.length,
        });

        if (pendingMatches.length > 0) {
            await withNotificationTimeout(
                "cancel",
                notifications.cancel({
                    notifications: pendingMatches.map((notification) => ({
                        id: notification.id,
                    })),
                })
            );
            debugLog("workspace-delete", "time_reminder_pending_cancelled", {
                workspaceId,
                cancelledCount: pendingMatches.length,
            });
        }
    }
    catch (error) {
        debugError("workspace-delete", "time_reminder_pending_cleanup_failed", {
            workspaceId,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
    }

    try {
        const delivered = await withNotificationTimeout(
            "getDeliveredNotifications",
            notifications.getDeliveredNotifications()
        );
        const deliveredMatches = delivered.notifications.filter((notification) =>
            isWorkspaceNotification(notification as any, workspaceId)
        );
        debugLog("workspace-delete", "time_reminder_delivered_loaded", {
            workspaceId,
            deliveredCount: delivered.notifications.length,
            matchingDeliveredCount: deliveredMatches.length,
        });

        if (deliveredMatches.length > 0) {
            await withNotificationTimeout(
                "removeDeliveredNotifications",
                notifications.removeDeliveredNotifications({
                    notifications: deliveredMatches,
                })
            );
            debugLog("workspace-delete", "time_reminder_delivered_removed", {
                workspaceId,
                removedCount: deliveredMatches.length,
            });
        }
    }
    catch (error) {
        debugError("workspace-delete", "time_reminder_delivered_cleanup_failed", {
            workspaceId,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
    }

    debugLog("workspace-delete", "time_reminder_purge_complete", {
        workspaceId,
    });
}
