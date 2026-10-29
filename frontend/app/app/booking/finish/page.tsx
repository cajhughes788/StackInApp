"use client"

import { Suspense, useEffect } from "react"

import { FinishAppointmentForm } from "@/components/booking/finish-appointment-form"
import { InvoicesPage, cardClass, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppointmentsStore } from "@/lib/stores/useAppointmentsStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"

// Finish & get paid for one appointment (?id=): the form is
// components/booking/finish-appointment-form.tsx.
export default function FinishAppointmentRoute() {
  return (
    <Suspense fallback={null}>
      <FinishAppointmentPage />
    </Suspense>
  )
}

function FinishAppointmentPage() {
  const { ready, workspaceId, invoices } = useInvoicesWorkspace()
  const appointmentId = useQueryParam("id")
  const entry = useAppointmentsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useAppointmentsStore((state) => state.load)
  const loadInvoices = useInvoicesStore((state) => state.load)
  const paymentAccount = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.paymentAccount ?? null : null))
  const appointment = entry?.appointments.find((item) => item.id === appointmentId) ?? null
  const invoice = appointment?.invoiceId ? invoices.find((item) => item.id === appointment.invoiceId) ?? null : null

  useEffect(() => {
    if (!workspaceId) return
    void load(workspaceId, { force: true }).catch(() => {})
    void loadInvoices(workspaceId, { force: true }).catch(() => {})
  }, [load, loadInvoices, workspaceId])

  const backHref = appointmentId ? `/app/booking/view?id=${encodeURIComponent(appointmentId)}` : "/app/booking"
  return (
    <InvoicesPage ready={ready} loadingLabel="Loading..." title="Finish & get paid" backHref={backHref} backLabel="Back to appointment">
      {appointment && workspaceId && (!appointment.invoiceId || invoice) ? (
        <FinishAppointmentForm
          key={appointment.id}
          workspaceId={workspaceId}
          appointment={appointment}
          invoice={invoice}
          onlinePayments={!!paymentAccount?.chargesEnabled && !!paymentAccount.acceptOnline}
          backHref={backHref}
        />
      ) : !entry || entry.status === "loading" || (appointment?.invoiceId && !invoice) ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-40 w-full rounded-[18px]" />
          <Skeleton className="h-24 w-full rounded-[18px]" />
        </div>
      ) : (
        <section className={cn(cardClass, "text-center text-sm text-muted-foreground")}>This appointment wasn&apos;t found.</section>
      )}
    </InvoicesPage>
  )
}

