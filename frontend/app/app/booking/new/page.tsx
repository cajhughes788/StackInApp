"use client"

import { Suspense, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"

import { NewAppointmentForm } from "@/components/booking/new-appointment-form"
import { InvoicesPage, cardClass, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { createAppointmentInBackground, appointmentDraft } from "@/lib/domain/appointmentService"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useBusyCalendarsStore } from "@/lib/stores/useBusyCalendarsStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { cn } from "@/lib/utils"

export default function NewAppointmentPageRoute() {
  return (
    <Suspense fallback={null}>
      <NewAppointmentPage />
    </Suspense>
  )
}

function NewAppointmentPage() {
  const router = useRouter()
  const { ready, workspaceId } = useInvoicesWorkspace()
  // "Fix it" on a booking the server refused brings it back here.
  const retry = useQueryParam("retry")
  const draft = useMemo(() => (retry ? appointmentDraft(retry) : null), [retry])
  // A spot tapped on the calendar.
  const pickedDate = useQueryParam("date")
  const pickedTime = useQueryParam("time")
  const clientsEntry = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const loadClients = useClientsStore((state) => state.load)
  const settingsEntry = useBookingSettingsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const loadSettings = useBookingSettingsStore((state) => state.load)
  // Busy times from the owner's own calendars, for the "you're busy" warning.
  const busyTimes = useBusyCalendarsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.busy : undefined))
  const loadBusy = useBusyCalendarsStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void loadBusy(workspaceId).catch(() => {})
  }, [loadBusy, workspaceId])
  const settings = settingsEntry?.settings ?? null
  const loadStatus = settingsEntry?.status ?? "loading"

  useEffect(() => {
    if (workspaceId) void loadClients(workspaceId).catch(() => {})
  }, [loadClients, workspaceId])

  // Services, hours and the time zone: the phone's copy shows at once.
  useEffect(() => {
    if (workspaceId) void loadSettings(workspaceId).catch(() => {})
  }, [loadSettings, workspaceId])

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading..."
      title="New appointment"
      backHref="/app/booking"
      backLabel="Back to booking"
    >
      {loadStatus === "ready" && settings && workspaceId ? (
        <NewAppointmentForm
          key={retry ?? "new"}
          settings={settings}
          savedClients={clientsEntry?.clients ?? []}
          draft={draft}
          initialDate={pickedDate && /^\d{4}-\d{2}-\d{2}$/.test(pickedDate) ? pickedDate : null}
          initialTime={pickedTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(pickedTime) ? pickedTime : null}
          busy={busyTimes}
          onCreate={(input) => {
            const result = createAppointmentInBackground({
              workspaceId,
              input,
              settings,
              savedClients: clientsEntry?.clients ?? [],
              onFix: (mutationId) => router.push(`/app/booking/new?retry=${encodeURIComponent(mutationId)}`),
            })
            if ("error" in result) return result.error
            const { appointment } = result
            // Emailed (once the server books it); else Messages opens on
            // their number, or the share sheet when there's only an email
            // (emails turned off).
            const arrival =
              settings.emailClients && appointment.clientEmail ? "sent" : appointment.clientPhone ? "text" : "share"
            router.replace(`/app/booking/view?id=${encodeURIComponent(appointment.id)}${arrival ? `&then=${arrival}` : ""}`)
            return null
          }}
        />
      ) : loadStatus === "error" ? (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your services.</p>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => workspaceId && void loadSettings(workspaceId).catch(() => {})}>
            Try again
          </Button>
        </section>
      ) : (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-48 w-full rounded-[18px]" />
          <Skeleton className="h-64 w-full rounded-[18px]" />
        </div>
      )}
    </InvoicesPage>
  )
}
