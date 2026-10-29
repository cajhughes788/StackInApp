"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CalendarDays, ChevronRight, Globe, List, Plus, Settings2 } from "lucide-react"

import { AppointmentStatusPill, appointmentTimeRange } from "@/components/booking/appointment-ui"
import { BookingCalendar } from "@/components/booking/booking-calendar"
import { InvoicesPage, cardClass, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
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
  // The last view used, on this phone.
  useEffect(() => {
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
      <Button asChild className="h-[52px] w-full rounded-full text-base font-semibold">
        <Link href="/app/booking/new">
          <Plus className="size-5" aria-hidden="true" />
          New appointment
        </Link>
      </Button>

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
          <li key={appointment.id}>
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
