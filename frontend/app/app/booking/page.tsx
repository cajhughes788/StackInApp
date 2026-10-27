"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, Plus, Settings2 } from "lucide-react"

import { AppointmentStatusPill, appointmentTimeRange } from "@/components/booking/appointment-ui"
import { InvoicesPage, cardClass, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { cn } from "@/lib/utils"
import { formatAppointmentDate, formatBookingTime } from "@shared/appointments"
import type { AppointmentType } from "@shared/schemas/appointment"

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

  useEffect(() => {
    if (workspaceId) void load(workspaceId, { force: true }).catch(() => {})
  }, [load, workspaceId])

  const { upcoming, earlier } = useMemo(() => {
    const nowIso = new Date().toISOString()
    const all = entry?.appointments ?? []
    // Still upcoming until it ends.
    return {
      upcoming: all.filter((item) => item.endAt > nowIso),
      earlier: all.filter((item) => item.endAt <= nowIso).reverse(),
    }
  }, [entry?.appointments])
  const thisYear = String(new Date().getFullYear())

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
          {upcoming.length === 0 ? (
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
          {earlier.length > 0 ? (
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
