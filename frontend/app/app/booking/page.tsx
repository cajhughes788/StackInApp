"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, ChevronRight, Globe, List, Mic, Plus, Settings2, Square } from "lucide-react"

import { AppointmentStatusPill, appointmentTimeRange } from "@/components/booking/appointment-ui"
import { BookingCalendar } from "@/components/booking/booking-calendar"
import { InvoicesPage, cardClass, localToday, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { parseVoiceBooking, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { planMove, stashBookingFill, voiceBookingHints, type MoveChoice } from "@/lib/voiceBookingFill"
import { useVoiceHandoffStore } from "@/lib/stores/useVoiceHandoffStore"
import { useVoiceLaunchStore } from "@/lib/stores/useVoiceLaunchStore"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useBusyCalendarsStore } from "@/lib/stores/useBusyCalendarsStore"
import { cn } from "@/lib/utils"
import { appointmentStatus, formatAppointmentDate, formatBookingTime } from "@shared/appointments"
import { ONLINE_BOOKING_COUNT_DAYS, onlineBookingCounts } from "@shared/onlineBooking"
import type { AppointmentStatus, AppointmentType } from "@shared/schemas/appointment"

type BookingView = "calendar" | "list"
const VIEW_STORAGE_KEY = "521.bookingView"

const OFF_STATUSES = new Set<AppointmentStatus>(["canceled", "declined", "expired"])

export default function BookingPageRoute() {
  return (
    <Suspense fallback={null}>
      <BookingPage />
    </Suspense>
  )
}

function groupByDate(appointments: AppointmentType[]): Array<{ date: string; appointments: AppointmentType[] }> {
  const groups: Array<{ date: string; appointments: AppointmentType[] }> = []
  for (const appointment of appointments) {
    const last = groups[groups.length - 1]
    if (last && last.date === appointment.date) last.appointments.push(appointment)
    else groups.push({ date: appointment.date, appointments: [appointment] })
  }
  return groups
}

// Appointments ahead (soonest first) and the last 30 days, plus New
// appointment and the services-and-hours setup.
function BookingPage() {
  const { ready, workspaceId } = useInvoicesWorkspace()
  const entry = useAppointmentsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useAppointmentsStore((state) => state.load)
  const [showEarlier, setShowEarlier] = useState(false)
  const [showCanceled, setShowCanceled] = useState(false)

  const loadSettings = useBookingSettingsStore((state) => state.load)
  const bookingSettings = useBookingSettingsStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.settings ?? null : null
  )
  const [view, setView] = useState<BookingView>("calendar")
  // ?date=2026-11-20: open the calendar on that day.
  const dateParam = useQueryParam("date")
  const linkedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null
  // The last view used, on this phone (a linked day always shows the calendar).
  useEffect(() => {
    if (linkedDate) return
    try {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (saved === "list" || saved === "calendar") setView(saved)
    } catch {
      // Calendar, then.
    }
  }, [])
  function pickView(next: BookingView) {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Only remembered when it can be.
    }
  }

  useEffect(() => {
    if (workspaceId) void load(workspaceId, { force: true }).catch(() => {})
  }, [load, workspaceId])
  // Busy times from the owner's own calendars, drawn on the calendar.
  const busyTimes = useBusyCalendarsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.busy : undefined))
  const loadBusy = useBusyCalendarsStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void loadBusy(workspaceId).catch(() => {})
  }, [loadBusy, workspaceId])

  // Ready before New appointment opens.
  useEffect(() => {
    if (workspaceId) void loadSettings(workspaceId).catch(() => {})
  }, [loadSettings, workspaceId])

  const { upcoming, earlier, canceled } = useMemo(() => {
    const nowIso = new Date().toISOString()
    // A customer who started booking online but never paid the deposit
    // didn't book anything: leave those out.
    const all = (entry?.appointments ?? []).filter((item) => !(item.source === "online" && appointmentStatus(item, nowIso) === "expired"))
    // Ones that aren't happening (canceled, can't make it, never answered)
    // get their own list, so the main one is only real appointments.
    const off = (item: AppointmentType) => OFF_STATUSES.has(appointmentStatus(item, nowIso))
    const active = all.filter((item) => !off(item))
    return {
      // Still upcoming until it ends.
      upcoming: active.filter((item) => item.endAt > nowIso),
      earlier: active.filter((item) => item.endAt <= nowIso).reverse(),
      canceled: all.filter(off).sort((a, b) => b.startAt.localeCompare(a.startAt)),
    }
  }, [entry?.appointments])
  const thisYear = String(new Date().getFullYear())

  /** ------------------------------------------------
   * VOICE — "book Jenna Thursday at 2" opens New appointment filled in;
   * "move my 3 to 4" opens that appointment's Change time filled in. The
   * appointment is found here on the phone; only the words and saved
   * client and service names go to the server. Nothing is booked or moved
   * until the person taps Book or Move it.
   * ------------------------------------------------ */
  const router = useRouter()
  const clients = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.clients : undefined))
  const loadClients = useClientsStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void loadClients(workspaceId).catch(() => {})
  }, [loadClients, workspaceId])
  const clientNames = useMemo(() => (clients ?? []).filter((c) => !c.archived).map((c) => c.name), [clients])
  const serviceNames = useMemo(
    () => (bookingSettings?.services ?? []).filter((service) => service.active).map((service) => service.name),
    [bookingSettings?.services]
  )
  const [viewedDate, setViewedDate] = useState<string | null>(null)
  const [voicePhase, setVoicePhase] = useState<"idle" | "thinking">("idle")
  const [voiceHeard, setVoiceHeard] = useState("")
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const [moveOptions, setMoveOptions] = useState<MoveChoice[]>([])
  const voiceRunRef = useRef(0)

  function openMove(choice: MoveChoice) {
    router.push(
      `/app/booking/view?id=${encodeURIComponent(choice.appointment.id)}&moveDate=${choice.date}&moveTime=${encodeURIComponent(choice.startTime)}`
    )
  }

  async function handleVoiceTranscript(transcript: string) {
    const run = ++voiceRunRef.current
    setVoicePhase("thinking")
    setVoiceHeard(transcript)
    setVoiceNote(null)
    setMoveOptions([])
    const today = localToday()
    try {
      const result = await parseVoiceBooking({
        kind: "booking",
        mode: "any",
        transcript,
        today,
        clients: clientNames.slice(0, 300),
        services: serviceNames.slice(0, 100),
      })
      if (run !== voiceRunRef.current) return
      if (result.action === "book") {
        stashBookingFill({ transcript, result })
        router.push("/app/booking/new?voiceFill=1")
        return
      }
      if (result.action !== "move") {
        setVoiceNote("Didn't catch a booking in that. Try \u201cbook Jenna Thursday at 2\u201d or \u201cmove my 3 to 4.\u201d")
        return
      }
      const nowIso = new Date().toISOString()
      const plan = planMove(result, {
        // Booked or waiting to be confirmed, and not started yet.
        appointments: upcoming
          .filter((item) => item.startAt > nowIso && ["requested", "confirmed"].includes(appointmentStatus(item, nowIso)))
          .map((item) => ({ id: item.id, clientName: item.clientName, serviceName: item.serviceName, date: item.date, startTime: item.startTime })),
        viewedDate: view === "calendar" && viewedDate ? viewedDate : today,
        today,
        hours: bookingSettings,
      })
      if (plan.kind === "go") openMove(plan.choice)
      else if (plan.kind === "pick") setMoveOptions(plan.options)
      else setVoiceNote(plan.message)
    } catch (error) {
      if (run !== voiceRunRef.current) return
      console.warn("[VoiceBooking] failed", error)
      // 429 = today's voice limit (server message says so); anything else is a plain failure.
      const limited = (error as { status?: number })?.status === 429
      setVoiceNote(limited && error instanceof Error ? error.message : "Couldn't work that out just now. Try again.")
    } finally {
      if (run === voiceRunRef.current) setVoicePhase("idle")
    }
  }
  const speech = useSpeechCapture((transcript) => void handleVoiceTranscript(transcript))
  // Said to Ask 521 on Home ("book Jenna Thursday at 2", "move my 3 to 4"):
  // worked out here once the appointments are in.
  const voiceHandoff = useVoiceHandoffStore((state) => state.request)
  const takeVoiceHandoff = useVoiceHandoffStore((state) => state.take)
  const appointmentsReady = !!entry && entry.status !== "loading"
  useEffect(() => {
    if (voiceHandoff?.target !== "booking" || !appointmentsReady || (voiceHandoff.listen && !speech.checked)) return
    const taken = takeVoiceHandoff(["booking"], workspaceId)
    if (!taken) return
    // "Book an appointment" with nothing else: listen here, like "Book in 521".
    if (taken.listen) {
      if (speech.supported) startVoice()
      return
    }
    void handleVoiceTranscript(taken.transcript)
    // handleVoiceTranscript reads the latest lists each render; readiness is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceHandoff, appointmentsReady, workspaceId, takeVoiceHandoff, speech.checked])
  function startVoice() {
    wakeVoiceEntry()
    setVoiceNote(null)
    setVoiceHeard("")
    setMoveOptions([])
    speech.resetStatus()
    void speech.start(voiceBookingHints(clientNames, serviceNames))
  }
  const voiceListening = speech.status === "listening"
  // "Hey Siri, book in 521": start listening here.
  const voiceLaunch = useVoiceLaunchStore((state) => state.request)
  useEffect(() => {
    if (voiceLaunch?.target !== "booking" || !speech.checked || !appointmentsReady) return
    if (!useVoiceLaunchStore.getState().take("booking")) return
    if (speech.supported) startVoice()
    // startVoice reads the latest lists each render; only the request matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLaunch, speech.checked, speech.supported, appointmentsReady])

  // Online bookings lately, and how many came from the owner's website button.
  const counts = useMemo(() => onlineBookingCounts(entry?.appointments ?? [], new Date().toISOString()), [entry?.appointments])
  const showCounts = !!entry && entry.status !== "error" && (bookingSettings?.onlineBookingEnabled || counts.online > 0)

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading booking..."
      title="Booking"
      action={
        <Link
          href="/app/booking/setup"
          className="flex h-9 items-center gap-1.5 rounded-full border border-card-border bg-card px-3.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <Settings2 className="size-4" aria-hidden="true" />
          Setup
        </Link>
      }
    >
      <div className="flex gap-2.5">
        <Button asChild className="h-[52px] flex-1 rounded-full text-base font-semibold">
          <Link href="/app/booking/new">
            <Plus className="size-5" aria-hidden="true" />
            New appointment
          </Link>
        </Button>
        {speech.supported ? (
          voiceListening ? (
            <Button
              type="button"
              size="icon"
              className="size-[52px] shrink-0 animate-pulse rounded-full bg-[#2FA866] text-white hover:bg-[#2FA866]/90"
              onClick={speech.done}
              aria-label="Stop and work it out"
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-[52px] shrink-0 rounded-full border-card-border bg-card"
              onClick={startVoice}
              disabled={voicePhase === "thinking"}
              aria-label="Book or move an appointment by voice"
            >
              <Mic className="size-5" />
            </Button>
          )
        ) : null}
      </div>

      {voiceListening ? (
        <div className="space-y-3 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Listening…
          </div>
          <p className="text-base text-foreground">
            {speech.transcript || (
              <span className="text-muted-foreground">
                Say it like &ldquo;Book Jenna Thursday at 2 for a cut&rdquo; or &ldquo;Move my 3 to 4.&rdquo;
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">Tap the green button or pause when you&apos;re done.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="rounded-full" onClick={speech.done} disabled={!speech.transcript}>
              Done
            </Button>
            <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={speech.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {voicePhase === "thinking" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
          Working it out…
        </p>
      ) : null}
      {speech.status === "denied" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521.
        </p>
      ) : null}
      {speech.status === "error" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t hear that. Tap the mic to try again.</p>
      ) : null}
      {voiceHeard && !voiceListening && voicePhase !== "thinking" && (voiceNote || moveOptions.length > 0) ? (
        <div className="space-y-2 rounded-2xl bg-muted px-4 py-3">
          <p className="text-sm text-muted-foreground">Heard: &ldquo;{voiceHeard}&rdquo;</p>
          {voiceNote ? <p className="text-sm text-foreground">{voiceNote}</p> : null}
          {moveOptions.length > 0 ? (
            <>
              <p className="text-sm font-medium text-foreground">Which appointment?</p>
              <div className="flex flex-wrap gap-2">
                {moveOptions.map((choice) => (
                  <button
                    key={choice.appointment.id}
                    type="button"
                    onClick={() => openMove(choice)}
                    className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                  >
                    {choice.appointment.clientName}, {formatAppointmentDate(choice.appointment.date, thisYear)}{" "}
                    {formatBookingTime(choice.appointment.startTime)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setMoveOptions([])
                    setVoiceHeard("")
                  }}
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                >
                  Never mind
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {showCounts ? (
        <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Globe className="size-4 shrink-0" aria-hidden="true" />
          {counts.online === 0
            ? `No online bookings in the last ${ONLINE_BOOKING_COUNT_DAYS} days`
            : `Last ${ONLINE_BOOKING_COUNT_DAYS} days: ${counts.online} booked online${
                counts.website > 0 ? ` · ${counts.website} from your website` : ""
              }`}
        </p>
      ) : null}

      {!entry || (entry.status === "loading" && entry.appointments.length === 0) ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-24 w-full rounded-[18px]" />
          <Skeleton className="h-24 w-full rounded-[18px]" />
        </div>
      ) : entry.status === "error" ? (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your appointments.</p>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => workspaceId && void load(workspaceId, { force: true }).catch(() => {})}
          >
            Try again
          </Button>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-muted p-1" role="group" aria-label="View">
            {(["calendar", "list"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => pickView(option)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-sm transition-colors",
                  view === option ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {option === "calendar" ? <CalendarDays className="size-4" aria-hidden="true" /> : <List className="size-4" aria-hidden="true" />}
                {option === "calendar" ? "Calendar" : "List"}
              </button>
            ))}
          </div>
          {view === "calendar" ? (
            <BookingCalendar
              appointments={[...upcoming, ...earlier]}
              busy={busyTimes ?? []}
              settings={bookingSettings}
              timeZone={bookingSettings?.timeZone || upcoming[0]?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              onSelectedChange={setViewedDate}
              initialDate={linkedDate}
            />
          ) : upcoming.length === 0 ? (
            <section className={cn(cardClass, "space-y-1 text-center")}>
              <p className="font-medium text-foreground">No upcoming appointments</p>
              <p className="text-sm text-muted-foreground">
                Book one for a client, or set up your services and hours first.
              </p>
            </section>
          ) : (
            groupByDate(upcoming).map((group) => (
              <AppointmentGroup key={group.date} title={formatAppointmentDate(group.date, thisYear)} appointments={group.appointments} />
            ))
          )}
          {view === "list" && earlier.length > 0 ? (
            showEarlier ? (
              <>
                <h2 className="px-1 pt-2 text-sm font-semibold text-muted-foreground">Earlier (last 30 days)</h2>
                {groupByDate(earlier).map((group) => (
                  <AppointmentGroup
                    key={group.date}
                    title={formatAppointmentDate(group.date, thisYear)}
                    appointments={group.appointments}
                  />
                ))}
              </>
            ) : (
              <button
                type="button"
                className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setShowEarlier(true)}
              >
                Show earlier ({earlier.length})
              </button>
            )
          ) : null}
          {canceled.length > 0 ? (
            showCanceled ? (
              <>
                <h2 className="px-1 pt-2 text-sm font-semibold text-muted-foreground">Canceled</h2>
                {groupByDate(canceled).map((group) => (
                  <AppointmentGroup
                    key={group.date}
                    title={formatAppointmentDate(group.date, thisYear)}
                    appointments={group.appointments}
                  />
                ))}
              </>
            ) : (
              <button
                type="button"
                className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setShowCanceled(true)}
              >
                Canceled ({canceled.length})
              </button>
            )
          ) : null}
        </>
      )}
    </InvoicesPage>
  )
}

function AppointmentGroup({ title, appointments }: { title: string; appointments: AppointmentType[] }) {
  return (
    <section className={cn(cardClass, "space-y-1 p-2")}>
      <h2 className="px-2 pb-1 pt-1.5 text-sm font-semibold text-muted-foreground">{title}</h2>
      <ul>
        {appointments.map((appointment) => (
          <li key={appointment.id} data-ask-line={appointment.id}>
            <Link
              href={`/app/booking/view?id=${encodeURIComponent(appointment.id)}`}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted"
            >
              <span className="w-16 shrink-0 text-sm font-medium tabular-nums text-foreground">
                {formatBookingTime(appointment.startTime)}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate font-medium text-foreground",
                    (appointment.status === "canceled" || appointment.status === "declined" || appointment.status === "expired") &&
                      "text-muted-foreground"
                  )}
                >
                  {appointment.clientName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {appointment.serviceName} · {appointmentTimeRange(appointment)}
                  {appointment.source === "online" ? " · Booked online" : ""}
                </span>
              </span>
              <AppointmentStatusPill status={appointment.status} short />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
