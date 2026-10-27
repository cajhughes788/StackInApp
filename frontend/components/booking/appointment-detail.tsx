"use client"

import { useState } from "react"
import { Check, Mail, MapPin, Phone, Share2, TriangleAlert, X } from "lucide-react"

import {
  AppointmentStatusPill,
  appointmentDepositAmount,
  appointmentWhen,
} from "@/components/booking/appointment-ui"
import { Button } from "@/components/ui/button"
import { cardClass } from "@/components/invoices/invoice-ui"
import { shareLink } from "@/lib/documentExport"
import { cn } from "@/lib/utils"
import { appointmentLocationLine, appointmentMapLinks, formatBookingTime } from "@shared/appointments"
import { formatInvoiceMoney, formatInvoicePhone } from "@shared/invoiceDisplay"
import type { AppointmentAction, AppointmentType } from "@shared/schemas/appointment"

// "Dec 3 at 2pm" on this device's clock.
function formatHold(iso: string): string {
  const at = new Date(iso)
  const time = formatBookingTime(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`)
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`
}

export function AppointmentDetail({
  appointment,
  onAction,
}: {
  appointment: AppointmentType
  onAction: (action: AppointmentAction) => Promise<{ appointment: AppointmentType; shareUrl: string | null }>
}) {
  const [busy, setBusy] = useState<AppointmentAction["action"] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const status = appointment.status
  const deposit = appointmentDepositAmount(appointment)
  const open = status === "requested" || status === "confirmed"

  async function run(action: AppointmentAction) {
    setBusy(action.action)
    setError(null)
    setNote(null)
    try {
      const result = await onAction(action)
      if (action.action === "share" && result.shareUrl) {
        const shared = await shareLink(
          result.shareUrl,
          `${appointment.serviceName} appointment`,
          (status === "requested"
            ? `Please confirm your ${appointment.serviceName} appointment: ${appointmentWhen(appointment)}`
            : `Your ${appointment.serviceName} appointment: ${appointmentWhen(appointment)}`) +
            (appointment.location.trim() ? ` · ${appointmentLocationLine(appointment.location)}` : "")
        )
        setNote(shared === "copied" ? "Link copied." : shared === "unavailable" ? result.shareUrl : null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that. Check your connection and try again.")
    } finally {
      setBusy(null)
      setConfirmingCancel(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cn(cardClass, "space-y-3")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-foreground">{appointment.serviceName}</h2>
            <p className="text-sm text-foreground">{appointmentWhen(appointment)}</p>
            <p className="text-xs text-muted-foreground">
              {appointment.timeZone.replace(/_/g, " ")}
              {appointment.bufferMinutes ? ` · ${appointment.bufferMinutes} min buffer after` : ""}
            </p>
          </div>
          <AppointmentStatusPill status={status} />
        </div>
        {status === "requested" && appointment.holdExpiresAt ? (
          <p className="text-sm text-muted-foreground">
            Time held until {formatHold(appointment.holdExpiresAt)} while {appointment.clientName} confirms.
          </p>
        ) : null}
        {status === "expired" ? (
          <p className="text-sm text-muted-foreground">No answer in 48 hours, so the time was released.</p>
        ) : null}
        {appointment.outsideHours && open ? (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Booked outside your usual hours.
          </p>
        ) : null}
        {appointment.location.trim() ? (
          // Opens Maps (the app hands non-app links to the phone).
          <a
            href={appointmentMapLinks(appointment.location).apple}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-sm text-foreground hover:underline"
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="whitespace-pre-line">{appointment.location.trim()}</span>
          </a>
        ) : null}
        <dl className="space-y-1.5 border-t border-card-border pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Price</dt>
            <dd className="font-medium tabular-nums text-foreground">{formatInvoiceMoney(appointment.price)}</dd>
          </div>
          {deposit > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Deposit</dt>
              <dd className="tabular-nums text-foreground">
                {formatInvoiceMoney(deposit)}
                {appointment.deposit.type === "percent" ? ` (${appointment.deposit.value}%)` : ""}
              </dd>
            </div>
          ) : null}
          {appointment.serviceId === null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Service</dt>
              <dd className="text-foreground">Custom</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className={cn(cardClass, "space-y-1.5")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Client</h2>
        <p className="font-medium text-foreground">{appointment.clientName}</p>
        {appointment.clientEmail ? (
          <a href={`mailto:${appointment.clientEmail}`} className="flex items-center gap-2 text-sm text-foreground hover:underline">
            <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{appointment.clientEmail}</span>
          </a>
        ) : null}
        {appointment.clientPhone ? (
          <a
            href={`tel:${appointment.clientPhone.replace(/[^\d+]/g, "")}`}
            className="flex items-center gap-2 text-sm text-foreground hover:underline"
          >
            <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
            {formatInvoicePhone(appointment.clientPhone)}
          </a>
        ) : null}
      </section>

      <div className="space-y-2.5">
        {open ? (
          <Button
            type="button"
            className="h-[52px] w-full rounded-full text-base font-semibold"
            variant={status === "requested" ? "default" : "outline"}
            disabled={busy !== null}
            onClick={() => void run({ action: "share" })}
          >
            <Share2 className="size-4" aria-hidden="true" />
            {busy === "share" ? "Getting link..." : status === "requested" ? "Text or share the confirm link" : "Share appointment details"}
          </Button>
        ) : null}
        {status === "requested" || status === "expired" || status === "declined" ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-full"
            disabled={busy !== null}
            onClick={() => void run({ action: "confirm" })}
          >
            <Check className="size-4" aria-hidden="true" />
            {busy === "confirm" ? "Confirming..." : "They confirmed another way"}
          </Button>
        ) : null}
        {status === "confirmed" ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-full"
            disabled={busy !== null}
            onClick={() => void run({ action: "complete" })}
          >
            <Check className="size-4" aria-hidden="true" />
            {busy === "complete" ? "Saving..." : "Mark done"}
          </Button>
        ) : null}
        {open || status === "expired" ? (
          confirmingCancel ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                className="h-11 flex-1 rounded-full"
                disabled={busy !== null}
                onClick={() => void run({ action: "cancel" })}
              >
                {busy === "cancel" ? "Canceling..." : "Yes, cancel it"}
              </Button>
              <Button type="button" variant="outline" className="h-11 flex-1 rounded-full" onClick={() => setConfirmingCancel(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-medium text-destructive"
              disabled={busy !== null}
              onClick={() => setConfirmingCancel(true)}
            >
              <X className="size-4" aria-hidden="true" />
              Cancel appointment
            </button>
          )
        ) : null}
        {note ? <p className="break-all text-center text-sm text-muted-foreground">{note}</p> : null}
        {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
        <p className="text-center text-xs text-muted-foreground">Charging at the appointment comes in the next booking step.</p>
      </div>
    </div>
  )
}
