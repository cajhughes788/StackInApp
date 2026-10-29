"use client"

import { useEffect, useState } from "react"
import { CalendarX2, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cardClass, fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { addBusyCalendar, removeBusyCalendar, saveBookingSettings, type BusyCalendarSummary } from "@/lib/api/bookingApi"
import { saveInBackground } from "@/lib/domain/backgroundSave"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useBusyCalendarsStore } from "@/lib/stores/useBusyCalendarsStore"
import { cn } from "@/lib/utils"
import { BUSY_CALENDAR_NAME_MAX, MAX_BUSY_CALENDARS } from "@shared/busyTimes"
import { BookingSettingsSchema } from "@shared/schemas/booking"

// Booking setup's "Block busy times": the owner's own calendars, read from
// their private iCal links, so the booking page never offers a time they're
// busy (busyCalendarsService.ts). Adding checks the link right away; the
// links themselves never come back to the phone.

const HOW_TO: Array<{ app: string; steps: string }> = [
  {
    app: "Google Calendar",
    steps:
      "On a computer, open Google Calendar → Settings → pick your calendar under “Settings for my calendars” → Integrate calendar → copy “Secret address in iCal format”.",
  },
  {
    app: "Apple / iCloud",
    steps: "In the Calendar app, tap Calendars → the ⓘ next to your calendar → turn on Public Calendar → Share Link → Copy.",
  },
  {
    app: "Outlook",
    steps:
      "In Outlook on the web: Settings → Calendar → Shared calendars → Publish a calendar → pick your calendar and “Can view when I'm busy” → Publish → copy the ICS link.",
  },
]

function ago(iso: string | null): string {
  if (!iso) return "not yet"
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "")
}

function statusLine(calendar: BusyCalendarSummary): string {
  if (calendar.error) {
    return `Couldn't read it${calendar.okAt ? ` since ${clockTime(calendar.okAt)}` : ""} · ${calendar.error}`
  }
  const count = calendar.busyCount
  return `Checked ${ago(calendar.checkedAt)} · ${count === 0 ? "no busy times" : count === 1 ? "1 busy time" : `${count} busy times`} ahead`
}

export function BusyCalendarsSection({ workspaceId }: { workspaceId: string }) {
  const entry = useBusyCalendarsStore((state) => state.byWorkspaceId[workspaceId])
  const load = useBusyCalendarsStore((state) => state.load)
  const put = useBusyCalendarsStore((state) => state.put)
  const settings = useBookingSettingsStore((state) => state.byWorkspaceId[workspaceId]?.settings ?? null)
  const putSettings = useBookingSettingsStore((state) => state.put)
  const loadSettings = useBookingSettingsStore((state) => state.load)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState<"add" | string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void load(workspaceId).catch(() => {})
  }, [load, workspaceId])

  const calendars = entry?.calendars ?? []

  async function add() {
    if (!name.trim()) {
      setError("Name the calendar, like Personal.")
      return
    }
    if (!url.trim()) {
      setError("Paste the calendar's link.")
      return
    }
    setBusy("add")
    setError(null)
    try {
      put(workspaceId, await addBusyCalendar(workspaceId, { name: name.trim(), url: url.trim() }))
      setName("")
      setUrl("")
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that calendar. Try again.")
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    setError(null)
    try {
      put(workspaceId, await removeBusyCalendar(workspaceId, id))
      setConfirmingRemove(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove it. Try again.")
    } finally {
      setBusy(null)
    }
  }

  // Saves at once, on its own (the main form never sends it).
  function setAllDay(busyAllDay: boolean) {
    if (!settings) return
    const { updatedAt: _updatedAt, ...input } = { ...settings, busyAllDay }
    putSettings(workspaceId, BookingSettingsSchema.parse({ ...settings, busyAllDay }))
    saveInBackground({
      key: `booking-settings:${workspaceId}`,
      task: () => saveBookingSettings(workspaceId, input),
      onSaved: (saved) => {
        putSettings(workspaceId, saved)
        // Which busy times count just changed.
        void load(workspaceId).catch(() => {})
      },
      onFailed: () => void loadSettings(workspaceId).catch(() => {}),
      failTitle: "Couldn't save your booking setup",
    })
  }

  return (
    <section id="busy-calendars" className={cn(cardClass, "space-y-3")}>
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">Block busy times</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your personal calendars and your booking page won&apos;t offer times you&apos;re busy. 521 checks them every
          15 minutes and keeps only when you&apos;re busy — never what the event is.
        </p>
      </div>

      {calendars.length > 0 ? (
        <ul className="space-y-2">
          {calendars.map((calendar) => (
            <li key={calendar.id} className="rounded-[14px] bg-muted p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{calendar.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{calendar.host}</p>
                  <p className={cn("mt-1 text-xs", calendar.error ? "text-destructive" : "text-muted-foreground")}>{statusLine(calendar)}</p>
                </div>
                {confirmingRemove === calendar.id ? null : (
                  <button
                    type="button"
                    aria-label={`Remove ${calendar.name}`}
                    className="rounded-full p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                    onClick={() => setConfirmingRemove(calendar.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {confirmingRemove === calendar.id ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-9 flex-1 rounded-full"
                    disabled={busy !== null}
                    onClick={() => void remove(calendar.id)}
                  >
                    {busy === calendar.id ? "Removing..." : "Remove"}
                  </Button>
                  <Button type="button" variant="outline" className="h-9 flex-1 rounded-full" onClick={() => setConfirmingRemove(null)}>
                    Keep it
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : entry?.status === "ready" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarX2 className="size-4 shrink-0" aria-hidden="true" />
          No calendars added yet.
        </p>
      ) : null}

      {adding ? (
        <div className="space-y-3 rounded-[14px] border border-card-border p-3">
          <label className={fieldLabelClass}>
            Name
            <input
              className={softInputClass}
              value={name}
              maxLength={BUSY_CALENDAR_NAME_MAX}
              placeholder="Personal"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={fieldLabelClass}>
            Calendar link
            <input
              className={softInputClass}
              value={url}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://… or webcal://…"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <div className="space-y-1.5">
            {HOW_TO.map((item) => (
              <details key={item.app} className="rounded-[10px] bg-muted px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Where&apos;s the link in {item.app}?</summary>
                <p className="mt-1.5 text-muted-foreground">{item.steps}</p>
              </details>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Keep these links private, like a password. 521 never shows them again or shares them with clients.
          </p>
          <div className="flex gap-2">
            <Button type="button" className="h-10 flex-1 rounded-full" disabled={busy !== null} onClick={() => void add()}>
              {busy === "add" ? "Checking link..." : "Add calendar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 rounded-full"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      ) : calendars.length < MAX_BUSY_CALENDARS ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-full"
          onClick={() => {
            setError(null)
            setAdding(true)
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a calendar
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">You can add up to {MAX_BUSY_CALENDARS} calendars.</p>
      )}

      {calendars.length > 0 && settings ? (
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">All-day events block the whole day</span>
            <span className="block text-xs text-muted-foreground">
              Off, birthdays and holidays don&apos;t take your day. On, use all-day events for days off and trips.
            </span>
          </span>
          <Switch checked={settings.busyAllDay} onCheckedChange={setAllDay} aria-label="All-day events block the whole day" />
        </label>
      ) : null}

      {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
    </section>
  )
}
