"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { NewAppointmentForm } from "@/components/booking/new-appointment-form"
import { InvoicesPage, cardClass, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { createAppointment } from "@/lib/api/appointmentsApi"
import { getBookingSettings } from "@/lib/api/bookingApi"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { cn } from "@/lib/utils"
import type { BookingSettings } from "@shared/schemas/booking"

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
  const upsert = useAppointmentsStore((state) => state.upsert)
  const clientsEntry = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const loadClients = useClientsStore((state) => state.load)
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading")
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    if (workspaceId) void loadClients(workspaceId).catch(() => {})
  }, [loadClients, workspaceId])

  // Services, hours and the time zone for this business.
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoadStatus("loading")
    getBookingSettings(workspaceId)
      .then((loaded) => {
        if (cancelled) return
        setSettings(loaded)
        setLoadStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setLoadStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, loadAttempt])

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
          settings={settings}
          savedClients={clientsEntry?.clients ?? []}
          onCreate={async (input) => {
            const result = await createAppointment(workspaceId, input)
            upsert(workspaceId, result.appointment)
            // A new client may have been saved with it.
            void loadClients(workspaceId, { force: true }).catch(() => {})
            router.replace(`/app/booking/view?id=${encodeURIComponent(result.appointment.id)}`)
            return result
          }}
        />
      ) : loadStatus === "error" ? (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your services.</p>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setLoadAttempt((n) => n + 1)}>
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
