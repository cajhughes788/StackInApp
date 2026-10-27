"use client"

import { Suspense, useEffect } from "react"

import { AppointmentDetail } from "@/components/booking/appointment-detail"
import { InvoicesPage, cardClass, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { updateAppointment } from "@/lib/api/appointmentsApi"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { cn } from "@/lib/utils"

export default function AppointmentPageRoute() {
  return (
    <Suspense fallback={null}>
      <AppointmentPage />
    </Suspense>
  )
}

function AppointmentPage() {
  const { ready, workspaceId } = useInvoicesWorkspace()
  const appointmentId = useQueryParam("id")
  const entry = useAppointmentsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useAppointmentsStore((state) => state.load)
  const upsert = useAppointmentsStore((state) => state.upsert)
  const appointment = entry?.appointments.find((item) => item.id === appointmentId) ?? null

  // Fresh each visit: the client may have answered since.
  useEffect(() => {
    if (workspaceId) void load(workspaceId, { force: true }).catch(() => {})
  }, [load, workspaceId])

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading appointment..."
      title="Appointment"
      backHref="/app/booking"
      backLabel="Back to booking"
    >
      {appointment && workspaceId ? (
        <AppointmentDetail
          appointment={appointment}
          onAction={async (action) => {
            const result = await updateAppointment(workspaceId, appointment.id, action)
            upsert(workspaceId, result.appointment)
            return result
          }}
        />
      ) : !entry || entry.status === "loading" ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-40 w-full rounded-[18px]" />
          <Skeleton className="h-24 w-full rounded-[18px]" />
        </div>
      ) : (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">
            {entry.status === "error" ? "Couldn't load this appointment." : "This appointment wasn't found."}
          </p>
          {entry.status === "error" && workspaceId ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void load(workspaceId, { force: true }).catch(() => {})}>
              Try again
            </Button>
          ) : null}
        </section>
      )}
    </InvoicesPage>
  )
}
