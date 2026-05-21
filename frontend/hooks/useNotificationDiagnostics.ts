"use client"

import { useEffect } from "react"
import { App } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { LocalNotifications, type LocalNotificationSchema } from "@capacitor/local-notifications"

const ENTRY_TIME_REMINDER_KIND = "entry-time-reminder"

function isEntryTimeReminder(notification: Pick<LocalNotificationSchema, "extra">) {
  return notification.extra?.kind === ENTRY_TIME_REMINDER_KIND
}

function normalizeScheduledAt(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }

  return null
}

function summarizeNotification(notification: LocalNotificationSchema) {
  const scheduledAt = normalizeScheduledAt(notification.schedule?.at)
  const nowIso = new Date().toISOString()
  const scheduledAtMs = scheduledAt ? new Date(scheduledAt).getTime() : null
  const deliveredAtMs = Date.now()

  return {
    id: notification.id,
    title: notification.title ?? null,
    body: notification.body ?? null,
    scheduledAt,
    deliveredAt: nowIso,
    deliveryDelayMs:
      scheduledAtMs !== null && Number.isFinite(scheduledAtMs)
        ? deliveredAtMs - scheduledAtMs
        : null,
    extra: notification.extra ?? null,
  }
}

async function logNotificationEnvironment(source: string) {
  try {
    const permission = await LocalNotifications.checkPermissions()
    const exactAlarm =
      Capacitor.getPlatform() === "android"
        ? await LocalNotifications.checkExactNotificationSetting().catch(() => null)
        : null
    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }))
    const delivered = await LocalNotifications.getDeliveredNotifications().catch(() => ({ notifications: [] }))

    const pendingEntryReminders = pending.notifications.filter((notification) =>
      isEntryTimeReminder(notification)
    )
    const deliveredEntryReminders = delivered.notifications.filter((notification) =>
      isEntryTimeReminder(notification)
    )

    console.info("[TimeReminder] environment_snapshot", {
      source,
      platform: Capacitor.getPlatform(),
      permissionDisplay: permission.display,
      exactAlarm: exactAlarm?.exact_alarm ?? null,
      pendingCount: pending.notifications.length,
      pendingEntryReminderCount: pendingEntryReminders.length,
      pendingEntryReminders: pendingEntryReminders.map(summarizeNotification),
      deliveredCount: delivered.notifications.length,
      deliveredEntryReminderCount: deliveredEntryReminders.length,
      deliveredEntryReminders: deliveredEntryReminders.map(summarizeNotification),
    })
  } catch (error) {
    console.error("[TimeReminder] environment_snapshot_failed", {
      source,
      platform: Capacitor.getPlatform(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    })
  }
}

export function useNotificationDiagnostics() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return
    }

    let receivedCleanup: { remove: () => Promise<void> | void } | null = null
    let actionCleanup: { remove: () => Promise<void> | void } | null = null
    let resumeCleanup: { remove: () => Promise<void> | void } | null = null
    let cancelled = false

    async function setup() {
      try {
        await logNotificationEnvironment("hook:setup")

        receivedCleanup = await LocalNotifications.addListener(
          "localNotificationReceived",
          (notification) => {
            if (cancelled) {
              return
            }

            console.info("[TimeReminder] notification_received", {
              platform: Capacitor.getPlatform(),
              ...summarizeNotification(notification),
            })
          }
        )

        actionCleanup = await LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (event) => {
            if (cancelled) {
              return
            }

            console.info("[TimeReminder] notification_action_performed", {
              platform: Capacitor.getPlatform(),
              actionId: event.actionId,
              inputValue: event.inputValue ?? null,
              notification: summarizeNotification(event.notification),
            })
          }
        )

        resumeCleanup = await App.addListener("resume", () => {
          void logNotificationEnvironment("hook:resume")
        })
      } catch (error) {
        console.error("[TimeReminder] listener_setup_failed", {
          platform: Capacitor.getPlatform(),
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : null,
        })
      }
    }

    void setup()

    return () => {
      cancelled = true
      void receivedCleanup?.remove()
      void actionCleanup?.remove()
      void resumeCleanup?.remove()
    }
  }, [])
}
