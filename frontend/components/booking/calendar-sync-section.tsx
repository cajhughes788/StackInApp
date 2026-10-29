"use client"

import { useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Browser } from "@capacitor/browser"
import { CalendarPlus, Copy, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cardClass } from "@/components/invoices/invoice-ui"
import { getCalendarFeedLink } from "@/lib/api/bookingApi"
import { cn } from "@/lib/utils"
import {
  calendarFeedUrl,
  calendarFeedWebcalUrl,
  googleCalendarSubscribeUrl,
  outlookCalendarSubscribeUrl,
} from "@shared/calendarFeed"

const STORAGE_PREFIX = "521.calendarFeed."

function savedToken(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + workspaceId)
  } catch {
    return null
  }
}

function saveToken(workspaceId: string, token: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + workspaceId, token)
  } catch {
    // Only a head start; the server has it.
  }
}

async function openWeb(url: string) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url })
  else window.open(url, "_blank", "noopener,noreferrer")
}

// Booking setup's "Calendar sync": the private link calendar apps subscribe
// to (shared/calendarFeed.ts), with one-tap adds for Apple, Google and Outlook.
export function CalendarSyncSection({ workspaceId }: { workspaceId: string }) {
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState<"get" | "reset" | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The link this phone already got shows at once, then is checked (it may
  // have been reset on another device).
  useEffect(() => {
    const saved = savedToken(workspaceId)
    setToken(saved)
    if (!saved) return
    let cancelled = false
    void getCalendarFeedLink(workspaceId)
      .then((link) => {
        if (cancelled) return
        saveToken(workspaceId, link.token)
        setToken(link.token)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function fetchLink(reset: boolean) {
    setBusy(reset ? "reset" : "get")
    setError(null)
    setNote(null)
    try {
      const link = await getCalendarFeedLink(workspaceId, { reset })
      saveToken(workspaceId, link.token)
      setToken(link.token)
      if (reset) setNote("New link made. The old one has stopped working — add this one to your calendar again.")
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't get your link. Check your connection and try again.")
    } finally {
      setBusy(null)
      setConfirmingReset(false)
    }
  }

  async function copy() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(calendarFeedUrl(token))
      setNote("Link copied.")
    } catch {
      setNote(calendarFeedUrl(token))
    }
  }

  const addButton = "h-11 w-full justify-start rounded-full px-4"

  return (
    <section id="calendar-sync" className={cn(cardClass, "space-y-3")}>
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">Calendar sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          See your 521 appointments in Google Calendar, Apple Calendar or Outlook. Changes show up when that app next
          checks — Apple often, Outlook every few hours, Google can take up to a day.
        </p>
      </div>

      {!token ? (
        <Button type="button" className="h-11 w-full rounded-full" disabled={busy !== null} onClick={() => void fetchLink(false)}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          {busy === "get" ? "Getting your link..." : "Get my calendar link"}
        </Button>
      ) : (
        <div className="space-y-2">
          <Button asChild variant="outline" className={addButton}>
            <a href={calendarFeedWebcalUrl(token)}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              Add to Apple Calendar
            </a>
          </Button>
          <Button type="button" variant="outline" className={addButton} onClick={() => void openWeb(googleCalendarSubscribeUrl(token))}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Add to Google Calendar
          </Button>
          <Button type="button" variant="outline" className={addButton} onClick={() => void openWeb(outlookCalendarSubscribeUrl(token))}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Add to Outlook
          </Button>
          <Button type="button" variant="outline" className={addButton} onClick={() => void copy()}>
            <Copy className="size-4" aria-hidden="true" />
            Copy link
          </Button>
          <p className="text-xs text-muted-foreground">
            Keep this link private: anyone who has it can see your appointments. It&apos;s read-only — make changes in 521.
          </p>
          {confirmingReset ? (
            <div className="space-y-2 rounded-[14px] bg-muted p-3">
              <p className="text-sm text-foreground">
                Make a new link? The old one stops working, and you&apos;ll add the new one to your calendar again.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="h-10 flex-1 rounded-full"
                  disabled={busy !== null}
                  onClick={() => void fetchLink(true)}
                >
                  {busy === "reset" ? "Resetting..." : "Reset link"}
                </Button>
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-full" onClick={() => setConfirmingReset(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setConfirmingReset(true)}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reset link
            </button>
          )}
        </div>
      )}
      {note ? <p className="break-all text-center text-sm text-muted-foreground">{note}</p> : null}
      {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
    </section>
  )
}
