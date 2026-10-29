"use client"

import { Suspense, useEffect, useState } from "react"

import { BookingSetupForm } from "@/components/booking/booking-setup-form"
import { BusyCalendarsSection } from "@/components/booking/busy-calendars-section"
import { CalendarSyncSection } from "@/components/booking/calendar-sync-section"
import { InvoicesPage, cardClass, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { saveBookingSettings } from "@/lib/api/bookingApi"
import { saveInBackground } from "@/lib/domain/backgroundSave"
import { useBookingSettingsStore } from "@/lib/stores/useBookingSettingsStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { BookingSettingsSchema } from "@shared/schemas/booking"

export default function BookingSetupPageRoute() {
  return (
    <Suspense fallback={null}>
      <BookingSetupPage />
    </Suspense>
  )
}

// Booking step 1: services and hours. Customers don't see any of it yet.
function BookingSetupPage() {
  const { ready, workspaceId, settings: invoiceSettings } = useInvoicesWorkspace()
  const paymentAccount = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.paymentAccount ?? null : null))
  const settingsEntry = useBookingSettingsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const loadSettings = useBookingSettingsStore((state) => state.load)
  const putSettings = useBookingSettingsStore((state) => state.put)
  const settings = settingsEntry?.settings ?? null
  // Bumped when a background save fails, so the form shows the saved setup again.
  const [formRevision, setFormRevision] = useState(0)
  const loadStatus = settingsEntry?.status ?? "loading"

  useEffect(() => {
    if (workspaceId) void loadSettings(workspaceId).catch(() => {})
  }, [loadSettings, workspaceId])

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading booking setup..."
      title="Booking setup"
      backHref="/app/booking"
      backLabel="Back to booking"
    >
      {loadStatus === "ready" && settings && workspaceId ? (
        <BookingSetupForm
          key={`${workspaceId}:${formRevision}`}
          initial={settings}
          invoiceSettings={invoiceSettings}
          onlinePayments={!!paymentAccount?.chargesEnabled && paymentAccount.acceptOnline}
          onSave={async (input) => {
            // A new link (or turning the page on) waits: the server checks
            // nobody else has it. Everything else saves at once.
            const linkChanged =
              (input.bookingSlug ?? settings.bookingSlug) !== settings.bookingSlug ||
              (input.onlineBookingEnabled ?? settings.onlineBookingEnabled) !== settings.onlineBookingEnabled
            if (linkChanged) {
              const saved = await saveBookingSettings(workspaceId, input)
              putSettings(workspaceId, saved)
              return saved
            }
            const optimistic = BookingSettingsSchema.parse({
              ...settings,
              ...input,
              timeZone: input.timeZone || settings.timeZone,
              updatedAt: new Date().toISOString(),
            })
            putSettings(workspaceId, optimistic)
            saveInBackground({
              key: `booking-settings:${workspaceId}`,
              task: () => saveBookingSettings(workspaceId, input),
              onSaved: (saved) => putSettings(workspaceId, saved),
              onFailed: () => {
                // Back to what the server has, form included.
                void loadSettings(workspaceId)
                  .catch(() => {})
                  .finally(() => setFormRevision((n) => n + 1))
              },
              failTitle: "Couldn't save your booking setup",
            })
            return optimistic
          }}
        />
      ) : null}
      {loadStatus === "ready" && settings && workspaceId ? (
        <>
          <CalendarSyncSection workspaceId={workspaceId} />
          <BusyCalendarsSection workspaceId={workspaceId} />
        </>
      ) : loadStatus === "error" ? (
        <section className={cn(cardClass, "space-y-3 text-center")}>
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your booking setup.</p>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => workspaceId && void loadSettings(workspaceId).catch(() => {})}>
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
