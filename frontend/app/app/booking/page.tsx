"use client"

import { Suspense, useEffect, useState } from "react"

import { BookingSetupForm } from "@/components/booking/booking-setup-form"
import { InvoicesPage, cardClass, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getBookingSettings, saveBookingSettings } from "@/lib/api/bookingApi"
import { cn } from "@/lib/utils"
import type { BookingSettings } from "@shared/schemas/booking"

export default function BookingPageRoute() {
  return (
    <Suspense fallback={null}>
      <BookingPage />
    </Suspense>
  )
}

// Booking step 1: services and hours. Customers don't see any of it yet.
function BookingPage() {
  const { ready, workspaceId, settings: invoiceSettings } = useInvoicesWorkspace()
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading")
  const [loadAttempt, setLoadAttempt] = useState(0)

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
    <InvoicesPage ready={ready} loadingLabel="Loading booking..." title="Booking">
      {loadStatus === "ready" && settings && workspaceId ? (
        <BookingSetupForm
          key={workspaceId}
          initial={settings}
          invoiceSettings={invoiceSettings}
          onSave={(input) => saveBookingSettings(workspaceId, input)}
        />
      ) : loadStatus === "error" ? (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your booking setup.</p>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setLoadAttempt((n) => n + 1)}>
            Try again
          </Button>
        </section>
      ) : (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-40 w-full rounded-[18px]" />
          <Skeleton className="h-80 w-full rounded-[18px]" />
        </div>
      )}
    </InvoicesPage>
  )
}
