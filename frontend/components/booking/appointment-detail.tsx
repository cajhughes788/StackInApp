"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Banknote, Check, Mail, MapPin, Phone, Share2, TriangleAlert, UserX, X } from "lucide-react"

import {
  AppointmentStatusPill,
  appointmentDepositAmount,
  appointmentWhen,
} from "@/components/booking/appointment-ui"
import { Button } from "@/components/ui/button"
import { PickerInput } from "@/components/booking/picker-input"
import { cardClass, fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { shareLink } from "@/lib/documentExport"
import { cn } from "@/lib/utils"
import { appointmentCanFinish, appointmentLeftToPay } from "@shared/appointmentCheckout"
import { appointmentDepositOnline, appointmentMoney } from "@shared/appointmentDeposits"
import { appointmentLocationLine, appointmentMapLinks, formatBookingTime, publicAppointmentUrl } from "@shared/appointments"
import { formatInvoiceDate, formatInvoiceMoney, formatInvoicePhone } from "@shared/invoiceDisplay"
import { invoiceBalanceDue, invoiceTipsReceived } from "@shared/invoicePayments"
import type { AppointmentAction, AppointmentType } from "@shared/schemas/appointment"
import type { InvoicePaidMethod, InvoiceType } from "@shared/schemas/invoice"

// How a deposit paid outside 521 came in (as on an invoice's Record payment).
const DEPOSIT_METHODS: Array<{ value: InvoicePaidMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "cash_app", label: "Cash App" },
  { value: "check", label: "Check" },
  { value: "pos", label: "Card" },
  { value: "other", label: "Other" },
]

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

// "Dec 3 at 2pm" on this device's clock.
function formatHold(iso: string): string {
  const at = new Date(iso)
  const time = formatBookingTime(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`)
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`
}

// How the client got their link when this was just booked: emailed, the
// email failed, or (no email on file) the owner shares it. "remind": the
// owner tapped the push for a client with no email for their reminder.
export type AppointmentArrival = "sent" | "failed" | "share" | "remind"

export function AppointmentDetail({
  appointment,
  invoice,
  onlinePayments,
  emailClients,
  arrival,
  saving,
  onAction,
}: {
  appointment: AppointmentType
  // The invoice holding its deposit, once one is paid.
  invoice: InvoiceType | null
  // Card payments are on: the client pays the deposit from their link.
  onlinePayments: boolean
  // Booking setup's "Email clients automatically".
  emailClients: boolean
  arrival: AppointmentArrival | null
  // Changes still on their way to the server.
  saving: boolean
  onAction: (action: AppointmentAction) => Promise<{ appointment: AppointmentType; shareUrl: string | null }>
}) {
  const [busy, setBusy] = useState<AppointmentAction["action"] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [confirmingNoShow, setConfirmingNoShow] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paidDate, setPaidDate] = useState(localToday())
  const [method, setMethod] = useState<InvoicePaidMethod | null>(null)
  const depositMutationId = useRef(newMutationId())
  const [emailing, setEmailing] = useState(false)
  const [emailTo, setEmailTo] = useState(appointment.clientEmail ?? "")

  const status = appointment.status
  const deposit = appointmentDepositAmount(appointment)
  const money = appointmentMoney(appointment, invoice)
  const depositOnline = appointmentDepositOnline(appointment, onlinePayments)
  const open = status === "requested" || status === "confirmed"
  const started = new Date(appointment.startAt).getTime() <= Date.now()
  const paidByCard = (invoice?.payments ?? []).some((payment) => payment.via === "online")
  // Finish & get paid (step 5): from the appointment's day on, or to switch
  // how an unpaid finish is paid.
  const canFinish = appointmentCanFinish(appointment, invoice, new Date().toISOString())
  const leftToPay = status === "completed" && invoice ? invoiceBalanceDue(invoice) : appointmentLeftToPay(appointment, invoice)
  const finishHref = `/app/booking/finish?id=${encodeURIComponent(appointment.id)}`

  async function run(action: AppointmentAction, options: { reminder?: boolean } = {}) {
    setBusy(action.action)
    setError(null)
    setNote(null)
    try {
      // A link the appointment already has is built here: no wait on the
      // server. Only the first share of an appointment asks it for one.
      const shareUrl =
        action.action === "share" && appointment.shareToken
          ? publicAppointmentUrl(appointment.shareToken)
          : (await onAction(action)).shareUrl
      if (action.action === "share" && shareUrl) {
        const shared = await shareLink(
          shareUrl,
          `${appointment.serviceName} appointment`,
          (options.reminder
            ? `Reminder of your ${appointment.serviceName} appointment: ${appointmentWhen(appointment)}`
            : status === "requested"
            ? depositOnline && money.kind === "due"
              ? `Please confirm your ${appointment.serviceName} appointment with a ${formatInvoiceMoney(deposit)} deposit: ${appointmentWhen(appointment)}`
              : `Please confirm your ${appointment.serviceName} appointment: ${appointmentWhen(appointment)}`
            : depositOnline && money.kind === "due"
              ? `Your ${appointment.serviceName} appointment (${formatInvoiceMoney(deposit)} deposit to pay): ${appointmentWhen(appointment)}`
              : `Your ${appointment.serviceName} appointment: ${appointmentWhen(appointment)}`) +
            (appointment.location.trim() ? ` · ${appointmentLocationLine(appointment.location)}` : "")
        )
        setNote(shared === "copied" ? "Link copied." : shared === "unavailable" ? shareUrl : null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that. Check your connection and try again.")
    } finally {
      setBusy(null)
      setConfirmingCancel(false)
      setConfirmingNoShow(false)
    }
  }

  // Just booked with no email sent, or the owner tapped the reminder push
  // for a client with no email: the share sheet opens by itself.
  const arrivalHandled = useRef(false)
  useEffect(() => {
    if (arrivalHandled.current || !arrival) return
    arrivalHandled.current = true
    if (arrival === "share" || arrival === "failed") void run({ action: "share" })
    if (arrival === "remind" && open) void run({ action: "share" }, { reminder: true })
    // Only once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival])

  async function sendEmail() {
    const to = emailTo.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setError("That email doesn't look right.")
      return
    }
    await run({ action: "email", to })
    setEmailing(false)
  }

  async function recordDeposit() {
    if (!method) {
      setError("Pick how they paid.")
      return
    }
    await run({ action: "record_deposit", paidDate, paymentMethod: method, clientMutationId: depositMutationId.current })
    setRecording(false)
    depositMutationId.current = newMutationId()
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
          <div className="flex shrink-0 flex-col items-end gap-1">
            <AppointmentStatusPill status={status} />
            {saving ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
          </div>
        </div>
        {status === "requested" && appointment.holdExpiresAt ? (
          <p className="text-sm text-muted-foreground">
            Time held until {formatHold(appointment.holdExpiresAt)} while {appointment.clientName} confirms.
          </p>
        ) : null}
        {status === "expired" ? (
          <p className="text-sm text-muted-foreground">
            {appointment.source === "online"
              ? "They didn't finish paying the deposit, so the time was released."
              : "No answer in 48 hours, so the time was released."}
          </p>
        ) : null}
        {appointment.source === "online" ? (
          <p className="text-sm text-muted-foreground">
            {status === "requested" ? "Booked online · paying the deposit now." : "Booked online by the client."}
          </p>
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
          {money.kind !== "none" ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Deposit</dt>
              <dd className="text-right tabular-nums text-foreground">
                {money.kind === "due" ? (
                  <>
                    {formatInvoiceMoney(deposit)}
                    {appointment.deposit.type === "percent" ? ` (${appointment.deposit.value}%)` : ""}
                    <span className="text-muted-foreground"> · {open ? "not paid yet" : "never paid"}</span>
                  </>
                ) : money.kind === "paid" ? (
                  <span className="text-emerald-800 dark:text-emerald-300">
                    {formatInvoiceMoney(money.amount)}{" "}
                    {status === "canceled" || status === "no_show" ? "kept" : `paid ${formatInvoiceDate(money.paidOn)}`}
                  </span>
                ) : (
                  <>{formatInvoiceMoney(money.amount)} refunded</>
                )}
              </dd>
            </div>
          ) : null}
          {money.kind === "due" && open ? (
            <p className="text-xs text-muted-foreground">
              {depositOnline
                ? status === "requested"
                  ? "They pay it by card when they confirm from the link."
                  : "They can pay it by card from the link."
                : onlinePayments
                  ? "Too small to pay by card — record it when they pay you."
                  : "Record it when they pay you, or set up online payments so they can pay by card."}
            </p>
          ) : null}
          {status === "completed" && invoice?.status === "paid" ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right tabular-nums text-emerald-800 dark:text-emerald-300">
                In full · {formatInvoiceMoney(invoice.total)}
                {invoiceTipsReceived(invoice) > 0 ? ` + ${formatInvoiceMoney(invoiceTipsReceived(invoice))} tip` : ""}
              </dd>
            </div>
          ) : status === "completed" && invoice?.status === "sent" && leftToPay > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Still due</dt>
              <dd className="font-medium tabular-nums text-amber-800 dark:text-amber-300">{formatInvoiceMoney(leftToPay)}</dd>
            </div>
          ) : null}
          {invoice ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Invoice</dt>
              <dd>
                <Link href={`/app/invoices/view?id=${encodeURIComponent(invoice.id)}`} className="font-medium text-foreground underline">
                  #{invoice.number}
                </Link>
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
        {canFinish && leftToPay > 0 ? (
          <Button asChild className="h-[52px] w-full rounded-full text-base font-semibold">
            <Link href={finishHref}>
              <Banknote className="size-5" aria-hidden="true" />
              {status === "completed" ? `Get paid · ${formatInvoiceMoney(leftToPay)}` : "Finish & get paid"}
            </Link>
          </Button>
        ) : canFinish ? (
          <Button
            type="button"
            className="h-[52px] w-full rounded-full text-base font-semibold"
            disabled={busy !== null}
            onClick={() => void run({ action: "complete" })}
          >
            <Check className="size-5" aria-hidden="true" />
            {busy === "complete" ? "Saving..." : "Finish"}
          </Button>
        ) : null}
        {open ? (
          <Button
            type="button"
            className="h-[52px] w-full rounded-full text-base font-semibold"
            variant={status === "requested" ? "default" : "outline"}
            disabled={busy !== null}
            onClick={() => void run({ action: "share" })}
          >
            <Share2 className="size-4" aria-hidden="true" />
            {busy === "share" ? "Getting link..." : status === "requested"
                ? "Text or share the confirm link"
                : depositOnline && money.kind === "due"
                  ? "Send the deposit link"
                  : "Share appointment details"}
          </Button>
        ) : null}
        {arrival === "failed" && !appointment.lastEmailedAt ? (
          <p className="text-center text-sm text-destructive">
            Couldn&apos;t email {appointment.clientName}. Share the link instead.
          </p>
        ) : null}
        {emailing ? (
          <div className="space-y-2 rounded-[14px] bg-muted p-3">
            <label className={fieldLabelClass}>
              Email the link to
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={softInputClass}
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
                placeholder="client@email.com"
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" className="h-10 flex-1 rounded-full" disabled={busy !== null} onClick={() => void sendEmail()}>
                {busy === "email" ? "Sending..." : "Send"}
              </Button>
              <Button type="button" variant="outline" className="h-10 flex-1 rounded-full" onClick={() => setEmailing(false)}>
                Not now
              </Button>
            </div>
          </div>
        ) : appointment.lastEmailedAt || open ? (
          <p className="text-center text-sm text-muted-foreground">
            <Mail className="mr-1.5 inline size-4 align-[-3px]" aria-hidden="true" />
            {appointment.lastEmailedAt ? (
              <span className="break-all">
                Emailed to {appointment.lastEmailedTo} · {formatHold(appointment.lastEmailedAt)}{" "}
              </span>
            ) : null}
            {open ? (
              <button
                type="button"
                className="font-medium text-foreground underline-offset-2 hover:underline"
                disabled={busy !== null}
                onClick={() => {
                  setEmailTo(appointment.lastEmailedTo ?? appointment.clientEmail ?? "")
                  setError(null)
                  setEmailing(true)
                }}
              >
                {appointment.lastEmailedAt ? "Resend" : "Email the link"}
              </button>
            ) : null}
          </p>
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
        {money.kind === "due" && open ? (
          recording ? (
            <div className={cn(cardClass, "space-y-3")}>
              <p className="text-sm font-semibold text-foreground">Record {formatInvoiceMoney(deposit)} deposit</p>
              <label className={fieldLabelClass}>
                Paid on
                <PickerInput
                  type="date"
                  value={paidDate}
                  max={localToday()}
                  placeholder="Pick a date"
                  onChange={(event) => setPaidDate(event.target.value)}
                />
              </label>
              <label className={fieldLabelClass}>
                How they paid
                <select
                  className={softInputClass}
                  value={method ?? ""}
                  onChange={(event) => setMethod((event.target.value || null) as InvoicePaidMethod | null)}
                >
                  <option value="">Choose…</option>
                  {DEPOSIT_METHODS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Booked as income on that date{status === "requested" ? ", and the appointment is confirmed" : ""}.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="h-11 flex-1 rounded-full"
                  disabled={busy !== null || !paidDate}
                  onClick={() => void recordDeposit()}
                >
                  {busy === "record_deposit" ? "Saving..." : "Record deposit"}
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-full" onClick={() => setRecording(false)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-full"
              disabled={busy !== null}
              onClick={() => {
                setPaidDate(localToday())
                setMethod(null)
                setError(null)
                setRecording(true)
              }}
            >
              <Banknote className="size-4" aria-hidden="true" />
              They paid the deposit another way
            </Button>
          )
        ) : null}
        {status === "confirmed" && started ? (
          confirmingNoShow ? (
            <div className="space-y-2">
              <p className="text-center text-sm text-muted-foreground">
                {money.kind === "paid" ? `The ${formatInvoiceMoney(money.amount)} deposit is kept.` : "Mark it as missed?"}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 rounded-full"
                  disabled={busy !== null}
                  onClick={() => void run({ action: "no_show" })}
                >
                  {busy === "no_show" ? "Saving..." : "Yes, no-show"}
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-full" onClick={() => setConfirmingNoShow(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-full"
              disabled={busy !== null}
              onClick={() => setConfirmingNoShow(true)}
            >
              <UserX className="size-4" aria-hidden="true" />
              No-show
            </Button>
          )
        ) : null}
        {open || status === "expired" ? (
          confirmingCancel ? (
            <div className="space-y-2">
            {emailClients && appointment.clientEmail ? (
              <p className="text-center text-sm text-muted-foreground">We&apos;ll email {appointment.clientName} that it&apos;s canceled.</p>
            ) : null}
            {money.kind === "paid" ? (
              <p className="text-center text-sm text-muted-foreground">
                {paidByCard
                  ? `Their ${formatInvoiceMoney(money.amount)} deposit goes back to their card.`
                  : `The ${formatInvoiceMoney(money.amount)} deposit is recorded as refunded — give it back to them.`}
              </p>
            ) : null}
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
      </div>
    </div>
  )
}
