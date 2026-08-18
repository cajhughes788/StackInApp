"use client"

import { useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { ChevronDown, ChevronUp } from "lucide-react"

import {
  CommonSettingsType,
  EntryReminderDeliveryModeType,
  LocationEntryReminderType,
  TimeEntryReminderType,
} from "@shared/schemas/settings"
import { NativeLocationPicker } from "@/components/NativeLocationPicker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { NativeGeofence } from "@/plugins/NativeGeofence"

export default function CommonSettingsSection({
  data,
  onChange,
}: {
  data?: Partial<CommonSettingsType>
  onChange: (
    patch: Partial<CommonSettingsType>,
    behavior?: "immediate" | "deferred"
  ) => void
}) {
  const DEFAULT_REMINDER_DELIVERY_MODE: EntryReminderDeliveryModeType = "if_no_entry"
  const DEFAULT_LOCATION_RADIUS_METERS = 100
  const LOCATION_PLACEHOLDER_ADDRESS = "Pick a location"
  const [local, setLocal] = useState<Partial<CommonSettingsType>>(data ?? {})
  const [timeReminderExpanded, setTimeReminderExpanded] = useState(false)
  const [locationReminderExpanded, setLocationReminderExpanded] = useState(false)
  const [timeReminderDraft, setTimeReminderDraft] = useState<Partial<TimeEntryReminderType> | null>(null)
  const [locationReminderDraft, setLocationReminderDraft] = useState<Partial<LocationEntryReminderType> | null>(null)
  const [requestingLocationAccess, setRequestingLocationAccess] = useState(false)
  const [locationActionError, setLocationActionError] = useState<string | null>(
    null
  )
  const [showLocationSettingsDialog, setShowLocationSettingsDialog] = useState(false)
  const { toast } = useToast()
  const nativePlatform =
    typeof window !== "undefined" && Capacitor.isNativePlatform()
      ? Capacitor.getPlatform()
      : null
  const remindersEnabled =
    local.entryRemindersEnabled ?? local.autoEntryReminders ?? false
  const timeReminder = getSingleTimeReminder(local)
  const locationReminder = getSingleLocationReminder(local)
  const hasEnabledTimeReminder = !!timeReminder?.enabled
  const hasEnabledLocationReminder = !!locationReminder?.enabled
  const showEntryReminderControls = nativePlatform !== null
  const showLocationReminderControls = nativePlatform !== "android"

  useEffect(() => {
    setLocal(data ?? {})
  }, [data])

  useEffect(() => {
    if (!timeReminderExpanded || !timeReminder) return
    setTimeReminderDraft({
      time: timeReminder.time,
      deliveryMode:
        timeReminder.deliveryMode ?? DEFAULT_REMINDER_DELIVERY_MODE,
    })
  }, [
    timeReminderExpanded,
    timeReminder?.id,
    timeReminder?.time,
    timeReminder?.deliveryMode,
  ])

  useEffect(() => {
    if (!locationReminderExpanded || !locationReminder) return
    setLocationReminderDraft({
      label: locationReminder.label,
      latitude: locationReminder.latitude,
      longitude: locationReminder.longitude,
      address: locationReminder.address,
      radiusMeters: locationReminder.radiusMeters,
      trigger: locationReminder.trigger,
      deliveryMode:
        locationReminder.deliveryMode ?? DEFAULT_REMINDER_DELIVERY_MODE,
    })
  }, [
    locationReminderExpanded,
    locationReminder?.id,
    locationReminder?.label,
    locationReminder?.latitude,
    locationReminder?.longitude,
    locationReminder?.address,
    locationReminder?.radiusMeters,
    locationReminder?.trigger,
    locationReminder?.deliveryMode,
  ])

  function applyPatch(
    patch: Partial<CommonSettingsType>,
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    setLocal((prev) => ({ ...prev, ...patch }))
    onChange(patch, behavior)
  }

  function updateField(
    field: keyof CommonSettingsType,
    value: CommonSettingsType[keyof CommonSettingsType],
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    applyPatch({ [field]: value } as Partial<CommonSettingsType>, behavior)
  }

  function getSingleTimeReminder(
    settings: Partial<CommonSettingsType>
  ): TimeEntryReminderType | null {
    return settings.timeEntryReminders?.[0] ?? null
  }

  function getSingleLocationReminder(
    settings: Partial<CommonSettingsType>
  ): LocationEntryReminderType | null {
    const reminders = settings.locationEntryReminders ?? []
    if (reminders.length === 0) return null

    return (
      reminders.find(
        (reminder) => reminder.address !== LOCATION_PLACEHOLDER_ADDRESS
      ) ?? reminders[0]
    )
  }

  function updateTimeReminders(
    next: TimeEntryReminderType[],
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    updateField("timeEntryReminders", next.slice(0, 1), behavior)
  }

  function updateTimeReminder(
    reminderId: string,
    patch: Partial<TimeEntryReminderType>,
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    const next = (local.timeEntryReminders ?? []).map((reminder) =>
      reminder.id === reminderId ? { ...reminder, ...patch } : reminder
    )
    updateField("timeEntryReminders", next.slice(0, 1), behavior)
  }

  function ensureTimeReminder(enabled = true) {
    const existing = getSingleTimeReminder(local)
    if (existing) return existing

    const reminder: TimeEntryReminderType = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      time: "18:00",
      enabled,
      deliveryMode: DEFAULT_REMINDER_DELIVERY_MODE,
    }

    updateTimeReminders([reminder], "immediate")
    return reminder
  }

  function updateLocationReminders(
    next: LocationEntryReminderType[],
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    const prioritized = [...next].sort((left, right) => {
      const leftHasChosenLocation =
        left.address !== LOCATION_PLACEHOLDER_ADDRESS
      const rightHasChosenLocation =
        right.address !== LOCATION_PLACEHOLDER_ADDRESS

      return Number(rightHasChosenLocation) - Number(leftHasChosenLocation)
    })

    updateField("locationEntryReminders", prioritized.slice(0, 1), behavior)
  }

  function updateLocationReminder(
    reminderId: string,
    patch: Partial<LocationEntryReminderType>,
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    const next = (local.locationEntryReminders ?? []).map((reminder) =>
      reminder.id === reminderId ? { ...reminder, ...patch } : reminder
    )
    updateField("locationEntryReminders", next.slice(0, 1), behavior)
  }

  function ensureLocationReminder() {
    const existing = getSingleLocationReminder(local)
    if (existing) return existing

    const reminder: LocationEntryReminderType = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      label: "Work Location",
      latitude: 37.7749,
      longitude: -122.4194,
      address: LOCATION_PLACEHOLDER_ADDRESS,
      radiusMeters: DEFAULT_LOCATION_RADIUS_METERS,
      trigger: "arrive",
      enabled: true,
      deliveryMode: DEFAULT_REMINDER_DELIVERY_MODE,
    }

    updateLocationReminders([reminder], "immediate")
    return reminder
  }

  function setTimeReminderEnabled(
    value: boolean,
    behavior: "immediate" | "deferred" = "immediate"
  ) {
    const existing = getSingleTimeReminder(local)
    if (existing) {
      updateTimeReminder(existing.id, { enabled: value }, behavior)
      return
    }

    const reminder: TimeEntryReminderType = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      time: "18:00",
      enabled: value,
      deliveryMode: DEFAULT_REMINDER_DELIVERY_MODE,
    }

    updateTimeReminders([reminder], behavior)
  }

  function setLocationReminderEnabled(
    value: boolean,
    behavior: "immediate" | "deferred" = "immediate"
  ) {
    const existing = getSingleLocationReminder(local)
    if (existing) {
      updateLocationReminder(existing.id, { enabled: value }, behavior)
      return
    }

    const reminder: LocationEntryReminderType = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      label: "Work Location",
      latitude: 37.7749,
      longitude: -122.4194,
      address: LOCATION_PLACEHOLDER_ADDRESS,
      radiusMeters: DEFAULT_LOCATION_RADIUS_METERS,
      trigger: "arrive",
      enabled: value,
      deliveryMode: DEFAULT_REMINDER_DELIVERY_MODE,
    }

    updateLocationReminders([reminder], behavior)
  }

  async function requestReminderNotificationsPermission() {
    if (typeof window === "undefined") return true

    try {
      const mod = await import("@capacitor/local-notifications")
      const current = await mod.LocalNotifications.checkPermissions()
      if (current.display === "granted") return true

      const requested = await mod.LocalNotifications.requestPermissions()
      return requested.display === "granted"
    } catch {
      if (typeof Notification === "undefined") return true
      if (Notification.permission === "granted") return true
      const result = await Notification.requestPermission()
      return result === "granted"
    }
  }

  function buildExactAlarmErrorMessage() {
    return "On Android, exact alarms must be allowed for time reminders to fire at the exact time you set."
  }

  async function requestAndroidExactAlarmAccess() {
    if (nativePlatform !== "android") return true

    try {
      const mod = await import("@capacitor/local-notifications")
      const current = await mod.LocalNotifications.checkExactNotificationSetting()
      if (current.exact_alarm === "granted") return true

      const updated =
        await mod.LocalNotifications.changeExactNotificationSetting()
      if (updated.exact_alarm === "granted") return true

      const rechecked = await mod.LocalNotifications
        .checkExactNotificationSetting()
        .catch(() => updated)
      if (rechecked.exact_alarm === "granted") return true

      toast({
        title: "Exact alarms are required",
        description: buildExactAlarmErrorMessage(),
        variant: "destructive",
      })
      return false
    } catch (error) {
      toast({
        title: "Unable to enable exact alarms",
        description:
          error instanceof Error
            ? error.message
            : buildExactAlarmErrorMessage(),
        variant: "destructive",
      })
      return false
    }
  }

  function buildLocationPermissionError(params: {
    granted?: boolean
    backgroundGranted?: boolean
    notificationGranted?: boolean
  }) {
    const { granted, backgroundGranted, notificationGranted } = params
    const isAndroid = nativePlatform === "android"

    if (!granted) {
      return isAndroid
        ? "Location access was not granted. Allow location access to keep Android location reminders available."
        : "Location access was not granted. Enable Always Allow location access in your device settings if you want location-based reminders."
    }

    if (!backgroundGranted && !notificationGranted) {
      return isAndroid
        ? "Android still needs both notification access and Allow all the time location access before location reminders can work."
        : "Location reminders still need both notifications and Always Allow location access before they can work."
    }

    if (!backgroundGranted) {
      return isAndroid
        ? "Background location is still off. Choose Allow all the time if Android shows the follow-up location step, or enable it later in Android settings."
        : "Background location is still off. On iPhone, choose Allow While Using App first, then approve the follow-up prompt to Change to Always Allow. If you already tapped Allow Once, reopen the app and try again, or enable Always in Settings."
    }

    if (!notificationGranted) {
      return isAndroid
        ? "Notifications are still off. Allow Android notifications too, or location reminders will not alert you."
        : "Notifications are still off. Allow notifications too, or location reminders will not alert you."
    }

    return "Please check your device settings and try again."
  }

  // Navigating a WKWebView to the app-settings: URL scheme is how Capacitor
  // iOS apps deep-link into their own page in the Settings app — iOS
  // intercepts the navigation and hands it to UIApplication.open, no native
  // plugin required. There's no Android equivalent available without a
  // custom plugin, and location reminder controls are hidden on Android
  // anyway (see showLocationReminderControls above).
  function openIosAppSettings() {
    if (typeof window !== "undefined") {
      window.location.href = "app-settings:"
    }
  }

  async function requestLocationAccess() {
    try {
      setRequestingLocationAccess(true)
      setLocationActionError(null)

      if (!NativeGeofence.isNativeAvailable()) {
        if (typeof window === "undefined" || !("geolocation" in navigator)) {
          throw new Error("Location access is not available in this browser.")
        }

        const granted = await new Promise<boolean>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            (error) => {
              if (error.code === error.PERMISSION_DENIED) {
                reject(
                  new Error(
                    "Location permission was denied. Make sure location is allowed for this site and for Safari in your device or system location settings, then try again."
                  )
                )
                return
              }

              reject(
                new Error(
                  error.message || "Unable to access your current location."
                )
              )
            },
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0,
            }
          )
        })

        return granted
      }

      const result = await NativeGeofence.requestPermissions()
      const hasRequiredLocationAccess =
        nativePlatform === "android"
          ? !!(
              result.granted &&
              result.backgroundGranted &&
              result.notificationGranted
            )
          : !!(result.granted && result.backgroundGranted)

      if (hasRequiredLocationAccess) {
        return true
      }

      const message = buildLocationPermissionError(result)
      setLocationActionError(message)
      // Toasts aren't reliably visible to the user — this needs an
      // explanation they can't miss, so it's a persistent dialog instead.
      setShowLocationSettingsDialog(true)
      return false
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Please check your browser or device settings and try again."
      setLocationActionError(message)
      toast({
        title: "Unable to request location access",
        description: message,
        variant: "destructive",
      })
      return false
    } finally {
      setRequestingLocationAccess(false)
    }
  }

  async function enableLocationReminderFlow() {
    const granted = await requestLocationAccess()
    if (!granted) {
      setLocationReminderEnabled(false, "immediate")
      setLocationReminderExpanded(false)
      return
    }

    setLocationReminderEnabled(true, "immediate")
    setLocationReminderExpanded(true)
    setLocationActionError(null)
  }

  function handleTimeReminderSave() {
    if (!timeReminder || !timeReminderDraft) {
      setTimeReminderExpanded(false)
      return
    }

    void (async () => {
      if (nativePlatform === "android" && timeReminder.enabled) {
        const notificationsGranted =
          await requestReminderNotificationsPermission()
        if (!notificationsGranted) {
          toast({
            title: "Notifications not enabled",
            description:
              "Allow notifications if you want time reminders to work.",
            variant: "destructive",
          })
          return
        }

        const exactGranted = await requestAndroidExactAlarmAccess()
        if (!exactGranted) {
          return
        }
      }

      updateTimeReminder(
        timeReminder.id,
        {
          time: timeReminderDraft.time ?? timeReminder.time,
          deliveryMode:
            timeReminderDraft.deliveryMode ?? DEFAULT_REMINDER_DELIVERY_MODE,
        },
        "immediate"
      )
      setTimeReminderExpanded(false)
    })()
  }

  function handleLocationReminderSave() {
    if (!locationReminder || !locationReminderDraft) {
      setLocationReminderExpanded(false)
      return
    }

    updateLocationReminder(
      locationReminder.id,
      {
        label: locationReminderDraft.label ?? locationReminder.label,
        latitude: locationReminderDraft.latitude ?? locationReminder.latitude,
        longitude:
          locationReminderDraft.longitude ?? locationReminder.longitude,
        address: locationReminderDraft.address ?? locationReminder.address,
        radiusMeters:
          locationReminderDraft.radiusMeters ??
          DEFAULT_LOCATION_RADIUS_METERS,
        trigger: locationReminderDraft.trigger ?? locationReminder.trigger,
        deliveryMode:
          locationReminderDraft.deliveryMode ??
          DEFAULT_REMINDER_DELIVERY_MODE,
      },
      "immediate"
    )
    setLocationReminderExpanded(false)
  }

  return (
    <>
      <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label>Enable Notes on Entries</Label>
            <Switch
              checked={local.useNotes ?? false}
              onCheckedChange={(value) => updateField("useNotes", value, "immediate")}
            />
          </div>
        </CardContent>
      </Card>

      {showEntryReminderControls ? (
      <Card>
        <CardHeader>
          <CardTitle>Entry Reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable Entry Reminders</Label>
            <Switch
              checked={remindersEnabled}
              onCheckedChange={async (value) => {
                if (value) {
                  const granted =
                    await requestReminderNotificationsPermission()
                  if (!granted) {
                    toast({
                      title: "Notifications not enabled",
                      description:
                        "Allow notifications if you want entry reminders to work.",
                      variant: "destructive",
                    })
                    return
                  }
                }

                updateField("entryRemindersEnabled", value, "immediate")
                updateField("autoEntryReminders", value, "immediate")

                if (value) {
                  const exactGranted =
                    nativePlatform === "android"
                      ? await requestAndroidExactAlarmAccess()
                      : true
                  const reminder = ensureTimeReminder(exactGranted)
                  if (!exactGranted) {
                    updateTimeReminder(reminder.id, { enabled: false }, "immediate")
                  }
                  setTimeReminderExpanded(exactGranted)
                } else {
                  if (timeReminder) {
                    updateTimeReminder(timeReminder.id, { enabled: false })
                  }
                  if (locationReminder) {
                    updateLocationReminder(locationReminder.id, {
                      enabled: false,
                    })
                  }
                  setTimeReminderExpanded(false)
                  setLocationReminderExpanded(false)
                }
              }}
            />
          </div>

          {remindersEnabled ? (
            <>
              <div className="space-y-4 border-l pl-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Label className="block text-sm">Time-Based Reminder</Label>
                    <Switch
                      checked={hasEnabledTimeReminder}
                      onCheckedChange={async (value) => {
                        if (value) {
                          const notificationsGranted =
                            await requestReminderNotificationsPermission()
                          if (!notificationsGranted) {
                            toast({
                              title: "Notifications not enabled",
                              description:
                                "Allow notifications if you want time reminders to work.",
                              variant: "destructive",
                            })
                            return
                          }

                          const exactGranted =
                            await requestAndroidExactAlarmAccess()
                          if (!exactGranted) {
                            return
                          }
                        }

                        setTimeReminderEnabled(value, "immediate")
                        setTimeReminderExpanded(value)
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!hasEnabledTimeReminder}
                    onClick={() => {
                      if (!hasEnabledTimeReminder) return
                      setTimeReminderExpanded((current) => !current)
                    }}
                    aria-label={
                      timeReminderExpanded
                        ? "Collapse time reminder"
                        : "Expand time reminder"
                    }
                  >
                    {timeReminderExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {timeReminderExpanded && timeReminder ? (
                  <div className="rounded-md border border-border bg-card px-3 py-3">
                    <div className="flex items-end justify-between gap-3">
                      <div className="w-[8.5rem] max-w-full space-y-2">
                        <Label htmlFor={`time-reminder-${timeReminder.id}`}>
                          Reminder Time
                        </Label>
                        <Input
                          className="w-full"
                          id={`time-reminder-${timeReminder.id}`}
                          type="time"
                          value={timeReminderDraft?.time ?? timeReminder.time}
                          onChange={(event) =>
                            setTimeReminderDraft((current) => ({
                              ...(current ?? {}),
                              time: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        onClick={handleTimeReminderSave}
                      >
                        Save
                      </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <Label>Reminder Behavior</Label>
                      <Select
                        value={
                          timeReminderDraft?.deliveryMode ??
                          timeReminder.deliveryMode ??
                          DEFAULT_REMINDER_DELIVERY_MODE
                        }
                        onValueChange={(value) =>
                          setTimeReminderDraft((current) => ({
                            ...(current ?? {}),
                            deliveryMode:
                              value as EntryReminderDeliveryModeType,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="always">
                            Always remind me
                          </SelectItem>
                          <SelectItem value="if_no_entry">
                            Only if no entry exists yet
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Press Save to apply changes to the time and
                      reminder behavior.
                    </p>
                    {nativePlatform === "android" ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        On Android, exact alarms must be allowed for this
                        reminder to fire at the exact time you choose.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {showLocationReminderControls ? (
                <div className="space-y-4 border-l pl-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Label className="block text-sm">
                      Location-Based Reminders
                    </Label>
                    <Switch
                      checked={hasEnabledLocationReminder}
                      onCheckedChange={async (value) => {
                        if (value) {
                          await enableLocationReminderFlow()
                          return
                        }

                        setLocationReminderEnabled(value, "immediate")
                        setLocationReminderExpanded(value)
                        setLocationActionError(null)
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!hasEnabledLocationReminder}
                    onClick={() => {
                      if (!hasEnabledLocationReminder) return
                      setLocationReminderExpanded((current) => !current)
                    }}
                    aria-label={
                      locationReminderExpanded
                        ? "Collapse location reminder"
                        : "Expand location reminder"
                    }
                  >
                    {locationReminderExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {locationReminderExpanded && locationReminder ? (
                  <div className="space-y-4 rounded-md border border-border bg-card px-3 py-3">
                    <div className="space-y-2">
                      <Label htmlFor={`location-label-${locationReminder.id}`}>
                        Work Location Name
                      </Label>
                      <Input
                        id={`location-label-${locationReminder.id}`}
                        value={
                          locationReminderDraft?.label ?? locationReminder.label
                        }
                        onChange={(event) =>
                          setLocationReminderDraft((current) => ({
                            ...(current ?? {}),
                            label: event.target.value,
                          }))
                        }
                        placeholder="Example: Salon, Office, Shop"
                      />
                    </div>

                    <NativeLocationPicker
                      value={
                        locationReminderDraft?.address ??
                        locationReminder.address
                      }
                      onBeforePick={requestLocationAccess}
                      onSelect={(location) => {
                        setLocationActionError(null)
                        setLocationReminderDraft((current) => ({
                          ...(current ?? {}),
                          label:
                            location.name ??
                            current?.label ??
                            locationReminder.label,
                          latitude: location.lat,
                          longitude: location.lng,
                          address: location.address,
                          radiusMeters: DEFAULT_LOCATION_RADIUS_METERS,
                        }))
                      }}
                      onError={(message) => setLocationActionError(message)}
                    />

                    <div className="space-y-2">
                      <Label>Trigger</Label>
                      <Select
                        value={
                          locationReminderDraft?.trigger ??
                          locationReminder.trigger
                        }
                        onValueChange={(value) =>
                          setLocationReminderDraft((current) => ({
                            ...(current ?? {}),
                            trigger: value as "arrive" | "leave",
                            radiusMeters: DEFAULT_LOCATION_RADIUS_METERS,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="arrive">When I arrive</SelectItem>
                          <SelectItem value="leave">When I leave</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Reminder Behavior</Label>
                      <Select
                        value={
                          locationReminderDraft?.deliveryMode ??
                          locationReminder.deliveryMode ??
                          DEFAULT_REMINDER_DELIVERY_MODE
                        }
                        onValueChange={(value) =>
                          setLocationReminderDraft((current) => ({
                            ...(current ?? {}),
                            deliveryMode:
                              value as EntryReminderDeliveryModeType,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="always">
                            Always remind me
                          </SelectItem>
                          <SelectItem value="if_no_entry">
                            Only if no entry exists yet
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {nativePlatform === "android" ? (
                      <p className="text-sm text-muted-foreground">
                        On Android, location reminders may not work unless you
                        allow StackIn to auto-launch in your phone settings.
                      </p>
                    ) : null}

                    <p className="text-sm text-muted-foreground">
                      Press Save to apply your location,
                      trigger, and reminder behavior changes.
                    </p>

                    {locationActionError ? (
                      <p className="text-sm text-destructive">
                        {locationActionError}
                      </p>
                    ) : null}

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleLocationReminderSave}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      ) : null}
      </div>

      <AlertDialog
        open={showLocationSettingsDialog}
        onOpenChange={setShowLocationSettingsDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn On &ldquo;Always&rdquo; Location Access</AlertDialogTitle>
            <AlertDialogDescription>
              Location-based reminders need location access set to{" "}
              <strong>Always</strong>, but StackIn currently only has partial
              or no access.
              <br />
              <br />
              To fix this:
              <br />
              1. Open the <strong>Settings</strong> app
              <br />
              2. Tap <strong>StackIn</strong>
              <br />
              3. Tap <strong>Location</strong>
              <br />
              4. Choose <strong>Always</strong>
              <br />
              <br />
              Then come back and turn the reminder on again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowLocationSettingsDialog(false)}>
              Not Now
            </AlertDialogCancel>
            {nativePlatform === "ios" ? (
              <AlertDialogAction
                onClick={() => {
                  setShowLocationSettingsDialog(false)
                  openIosAppSettings()
                }}
              >
                Open Settings
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
