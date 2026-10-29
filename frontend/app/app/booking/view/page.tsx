"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { AppointmentDetail, type AppointmentArrival } from "@/components/booking/appointment-detail"
import { InvoicesPage, cardClass, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { runAppointmentAction, useBookingEmailFailed } from "@/lib/domain/appointmentService"
import { useSaving } from "@/lib/domain/backgroundSave"
import { appointmentSaveKey, useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useBusyCalendarsStore } from "@/lib/stores/useBusyCalendarsStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"

export default function AppointmentPageRoute() {
  return (
    <Suspense fallback={null}>
      <AppointmentPage />
    </Suspense>
  )
}

function AppointmentPage() {
  const { ready, workspaceId, invoices } = useInvoicesWorkspace()
  const router = useRouter()
  const appointmentId = useQueryParam("id")
  // Just booked (New appointment): how the client gets their link. Read
  // once, then dropped from the address so going back doesn't repeat it.
  const then = useQueryParam("then")
  const [arrival] = useState<AppointmentArrival | null>(() =>
    then === "sent" || then === "failed" || then === "share" || then === "remind" ? then : null
  )
  useEffect(() => {
    if (then && appointmentId) router.replace(`/app/booking/view?id=${encodeURIComponent(appointmentId)}`)
  }, [then, appointmentId, router])
  const emailClients = useBookingSettingsStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.settings?.emailClients ?? true : true
  )
  const loadBookingSettings = useBookingSettingsStore((state) => state.load)
  const bookingSettings = useBookingSettingsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.settings ?? null : null))
  // When the owner is busy in their own calendars, for "Change time".
  const busyTimes = useBusyCalendarsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.busy : undefined))
  const loadBusy = useBusyCalendarsStore((state) => state.load)
  const entry = useAppointmentsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useAppointmentsStore((state) => state.load)
  const appointment = entry?.appointments.find((item) => item.id === appointmentId) ?? null
  const loadInvoices = useInvoicesStore((state) => state.load)
  const paymentAccount = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.paymentAccount ?? null : null))
  const saving = useSaving(appointmentId ? appointmentSaveKey(appointmentId) : null)
  const emailFailed = useBookingEmailFailed(appointmentId)
  const invoice = appointment?.invoiceId ? invoices.find((item) => item.id === appointment.invoiceId) ?? null : null

  // Fresh each visit: the client may have answered (or paid) since.
  useEffect(() => {
    if (!workspaceId) return
    void load(workspaceId, { force: true }).catch(() => {})
    void loadInvoices(workspaceId, { force: true }).catch(() => {})
    void loadBookingSettings(workspaceId).catch(() => {})
    void loadBusy(workspaceId).catch(() => {})
  }, [load, loadInvoices, loadBookingSettings, loadBusy, workspaceId])

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
          invoice={invoice}
          onlinePayments={!!paymentAccount?.chargesEnabled && paymentAccount.acceptOnline}
          emailClients={emailClients}
          arrival={emailFailed ? "failed" : arrival}
          saving={saving}
          bookingSettings={bookingSettings}
          busyTimes={busyTimes ?? []}
          onAction={(action) => runAppointmentAction(workspaceId, appointment, action, invoice)}
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
