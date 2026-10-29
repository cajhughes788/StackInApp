"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Banknote, Check, Clock, Plus, QrCode, Share2, X } from "lucide-react"
import QRCode from "qrcode"

import { cardClass, softInputClass } from "@/components/invoices/invoice-ui"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { finishAppointment, runAppointmentAction } from "@/lib/domain/appointmentService"
import { shareLink } from "@/lib/documentExport"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { appointmentFinishFromInvoice, appointmentFinishSummary } from "@shared/appointmentCheckout"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceTipsReceived } from "@shared/invoicePayments"
import type { AppointmentExtra, AppointmentType } from "@shared/schemas/appointment"
import type { InvoicePaidMethod, InvoiceType } from "@shared/schemas/invoice"

// Finish & get paid (booking step 5; /app/booking/finish): what's left of the bill, plus any
// extras and less a discount, then one of three ways to take it — a QR code
// the client pays from on their phone, paid another way, or an invoice to
// pay later. All of it lands on the appointment's invoice
// (appointmentCheckoutService.ts), so it books itself as income.

const POLL_MS = 3000

// As on the appointment's "paid another way" and an invoice's Record payment.
const METHODS: Array<{ value: InvoicePaidMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "cash_app", label: "Cash App" },
  { value: "check", label: "Check" },
  { value: "pos", label: "Card" },
  { value: "other", label: "Other" },
]

type Stage =
  | { kind: "form" }
  | { kind: "qr"; url: string; qr: string; due: number }
  | { kind: "paid"; invoice: InvoiceType }
  | { kind: "later"; invoice: InvoiceType; url: string; emailedTo: string | null }

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

function amountText(amount: number): string {
  return amount > 0 ? amount.toFixed(2).replace(/\.00$/, "") : ""
}

export function FinishAppointmentForm({
  workspaceId,
  appointment,
  invoice,
  onlinePayments,
  backHref,
}: {
  workspaceId: string
  appointment: AppointmentType
  invoice: InvoiceType | null
  onlinePayments: boolean
  backHref: string
}) {
  const router = useRouter()
  // Opens with what an earlier finish saved, when switching how it's paid.
  const [start] = useState(() => appointmentFinishFromInvoice(appointment, appointment.status === "completed" ? invoice : null))
  const [extras, setExtras] = useState<AppointmentExtra[]>(start.extras)
  const [adding, setAdding] = useState(false)
  const [extraName, setExtraName] = useState("")
  const [extraPrice, setExtraPrice] = useState("")
  const [discountText, setDiscountText] = useState(amountText(start.discount))
  const [askForTip, setAskForTip] = useState(invoice?.quickCharge?.askForTip ?? true)
  const [paidOther, setPaidOther] = useState(false)
  const [method, setMethod] = useState<InvoicePaidMethod | null>(null)
  const [tipText, setTipText] = useState("")
  const [stage, setStage] = useState<Stage>({ kind: "form" })
  const [busy, setBusy] = useState<"qr" | "paid" | "later" | "none" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mutationId = useRef(newMutationId())

  const discount = discountText.trim() ? parseAmount(discountText) : 0
  const tip = tipText.trim() ? parseAmount(tipText) : 0
  const summary = useMemo(
    () => appointmentFinishSummary(appointment, invoice, extras, discount ?? 0),
    [appointment, invoice, extras, discount]
  )
  const problem = discount === null ? "Enter the discount in dollars." : !summary.ok ? summary.error : null
  const due = summary.ok ? summary.due : 0

  // While the QR code is up, watch for the payment.
  const loadInvoices = useInvoicesStore((state) => state.load)
  useEffect(() => {
    if (stage.kind !== "qr") return
    const timer = setInterval(() => void loadInvoices(workspaceId, { force: true }).catch(() => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [stage.kind, workspaceId, loadInvoices])
  useEffect(() => {
    if (stage.kind === "qr" && invoice?.status === "paid") setStage({ kind: "paid", invoice })
  }, [stage.kind, invoice])

  function addExtra() {
    const price = parseAmount(extraPrice)
    if (!extraName.trim()) {
      setError("Name the extra.")
      return
    }
    if (price === null || price <= 0) {
      setError("Give the extra a price.")
      return
    }
    setExtras((current) => [...current, { description: extraName.trim(), amount: price }])
    setExtraName("")
    setExtraPrice("")
    setAdding(false)
    setError(null)
  }

  async function finish(way: "qr" | "paid" | "later") {
    if (problem) {
      setError(problem)
      return
    }
    if (way === "paid" && !method) {
      setError("Pick how they paid.")
      return
    }
    if (way === "paid" && tip === null) {
      setError("Enter the tip in dollars, or leave it empty.")
      return
    }
    setBusy(way)
    setError(null)
    setNote(null)
    try {
      const result = await finishAppointment(workspaceId, appointment.id, {
        action: "finish",
        extras,
        discount: discount ?? 0,
        way,
        askForTip,
        ...(way === "paid" ? { paymentMethod: method!, tipAmount: tip ?? 0 } : { tipAmount: 0 }),
        clientMutationId: mutationId.current,
      })
      // A fresh key for the next try (switching how it's paid).
      mutationId.current = newMutationId()
      const finished = result.invoice
      if (!finished || !result.shareUrl) throw new Error("Couldn't finish it. Try again.")
      if (way === "qr") {
        const qr = await QRCode.toDataURL(result.shareUrl, { errorCorrectionLevel: "M", margin: 1, width: 640 })
        setStage(finished.status === "paid" ? { kind: "paid", invoice: finished } : { kind: "qr", url: result.shareUrl, qr, due })
      } else if (way === "paid" || finished.status === "paid") {
        setStage({ kind: "paid", invoice: finished })
      } else {
        setStage({ kind: "later", invoice: finished, url: result.shareUrl, emailedTo: result.emailedTo })
        // No email went out: the share sheet opens by itself.
        if (!result.emailedTo) void share(result.shareUrl, finished)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't finish it. Try again.")
    } finally {
      setBusy(null)
    }
  }

  async function finishWithoutCharging() {
    setBusy("none")
    setError(null)
    try {
      await runAppointmentAction(workspaceId, appointment, { action: "complete" }, invoice)
      router.push(backHref)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't finish it. Try again.")
      setBusy(null)
    }
  }

  async function share(url: string, owed: InvoiceType | null) {
    const amount = owed ? owed.total - owed.amountPaid : due
    const result = await shareLink(url, `${appointment.serviceName} with ${appointment.clientName}`, `Pay ${formatInvoiceMoney(amount)} for your ${appointment.serviceName}:`)
    setNote(result === "copied" ? "Link copied." : result === "unavailable" ? url : null)
  }

  if (stage.kind === "qr") {
    return (
      <div className="space-y-4">
        <section className={cn(cardClass, "flex flex-col items-center gap-3 text-center")}>
          <div className="text-sm text-muted-foreground">{appointment.clientName} scans to pay</div>
          <div className="text-4xl font-semibold tabular-nums text-foreground">{formatInvoiceMoney(stage.due)}</div>
          {/* Always dark-on-white so any camera can read it. */}
          <img src={stage.qr} alt="QR code to pay" className="w-full max-w-[18rem] rounded-xl bg-white p-3" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Waiting for payment…
          </div>
        </section>
        {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
        {note ? <p className="break-all px-1 text-sm text-muted-foreground">{note}</p> : null}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-full"
          onClick={() => {
            setError(null)
            setPaidOther(true)
            setStage({ kind: "form" })
          }}
        >
          <Banknote className="size-4" aria-hidden="true" />
          They paid another way
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11 rounded-full" disabled={busy !== null} onClick={() => void finish("later")}>
            <Clock className="size-4" aria-hidden="true" />
            {busy === "later" ? "Saving…" : "Pay later"}
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-full" onClick={() => void share(stage.url, invoice)}>
            <Share2 className="size-4" aria-hidden="true" />
            Send link
          </Button>
        </div>
      </div>
    )
  }

  if (stage.kind === "paid") {
    const tipped = invoiceTipsReceived(stage.invoice)
    return (
      <div className="space-y-4">
        <section className={cn(cardClass, "flex flex-col items-center gap-2 py-8 text-center")}>
          <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-7" aria-hidden="true" />
          </span>
          <div className="text-lg font-semibold text-foreground">Paid in full</div>
          <div className="text-3xl font-semibold tabular-nums text-foreground">{formatInvoiceMoney(stage.invoice.total)}</div>
          {tipped > 0 ? <div className="text-sm text-muted-foreground">+ {formatInvoiceMoney(tipped)} tip</div> : null}
          <div className="text-sm text-muted-foreground">Booked as income for you.</div>
        </section>
        <Button type="button" className="h-[52px] w-full rounded-full text-base font-semibold" onClick={() => router.push(backHref)}>
          Done
        </Button>
      </div>
    )
  }

  if (stage.kind === "later") {
    const owed = stage.invoice.total - stage.invoice.amountPaid
    return (
      <div className="space-y-4">
        <section className={cn(cardClass, "flex flex-col items-center gap-2 py-6 text-center")}>
          <div className="text-lg font-semibold text-foreground">
            Invoice #{stage.invoice.number} {stage.emailedTo ? "sent" : "saved"}
          </div>
          <div className="text-sm text-muted-foreground">
            {appointment.clientName} owes {formatInvoiceMoney(owed)}
            {stage.emailedTo ? ` · emailed to ${stage.emailedTo}` : ""}. 521 reminds them by email if it&apos;s late.
          </div>
        </section>
        {note ? <p className="break-all px-1 text-sm text-muted-foreground">{note}</p> : null}
        <Button type="button" variant="outline" className="h-11 w-full rounded-full" onClick={() => void share(stage.url, stage.invoice)}>
          <Share2 className="size-4" aria-hidden="true" />
          Text or share the link
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => router.push(`/app/invoices/view?id=${encodeURIComponent(stage.invoice.id)}`)}
          >
            View invoice
          </Button>
          <Button type="button" className="h-11 rounded-full" onClick={() => router.push(backHref)}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className={cn(cardClass, "space-y-3")}>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{appointment.serviceName}</h2>
          <p className="text-sm text-muted-foreground">{appointment.clientName}</p>
        </div>
        <dl className="space-y-1.5 border-t border-card-border pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{appointment.serviceName}</dt>
            <dd className="tabular-nums text-foreground">{formatInvoiceMoney(appointment.price)}</dd>
          </div>
          {extras.map((extra, index) => (
            <div key={`${extra.description}-${index}`} className="flex items-center justify-between gap-3">
              <dt className="min-w-0 truncate text-muted-foreground">{extra.description}</dt>
              <dd className="flex shrink-0 items-center gap-1.5 tabular-nums text-foreground">
                {formatInvoiceMoney(extra.amount)}
                <button
                  type="button"
                  aria-label={`Remove ${extra.description}`}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setExtras((current) => current.filter((_, at) => at !== index))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </dd>
            </div>
          ))}
          {discount ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="tabular-nums text-foreground">−{formatInvoiceMoney(discount)}</dd>
            </div>
          ) : null}
          {summary.paid > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Already paid</dt>
              <dd className="tabular-nums text-emerald-800 dark:text-emerald-300">−{formatInvoiceMoney(summary.paid)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t border-card-border pt-2 text-base">
            <dt className="font-semibold text-foreground">Due today</dt>
            <dd className="font-semibold tabular-nums text-foreground">{formatInvoiceMoney(due)}</dd>
          </div>
        </dl>
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        {adding ? (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <input
                aria-label="Extra"
                placeholder="Beard trim"
                className={softInputClass}
                value={extraName}
                maxLength={80}
                autoFocus
                onChange={(event) => setExtraName(event.target.value)}
              />
              <input
                aria-label="Extra price"
                placeholder="$0.00"
                inputMode="decimal"
                className={cn(softInputClass, "tabular-nums")}
                value={extraPrice}
                onChange={(event) => setExtraPrice(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" className="h-10 flex-1 rounded-full" onClick={addExtra}>
                Add
              </Button>
              <Button type="button" variant="outline" className="h-10 flex-1 rounded-full" onClick={() => setAdding(false)}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
            disabled={extras.length >= 10}
            onClick={() => {
              setError(null)
              setAdding(true)
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add an extra
          </button>
        )}
        <label className="flex items-center justify-between gap-3 text-sm text-foreground">
          Discount
          <input
            aria-label="Discount"
            placeholder="$0.00"
            inputMode="decimal"
            className={cn(softInputClass, "h-10 w-28 text-right tabular-nums")}
            value={discountText}
            onChange={(event) => setDiscountText(event.target.value)}
          />
        </label>
        {onlinePayments ? (
          <label className="flex items-center justify-between gap-3 text-sm text-foreground">
            Ask for a tip
            <Switch checked={askForTip} onCheckedChange={setAskForTip} aria-label="Ask for a tip" />
          </label>
        ) : null}
      </section>

      {problem ? <p className="px-1 text-sm text-destructive">{problem}</p> : null}

      {onlinePayments ? (
        <Button
          type="button"
          className="h-[52px] w-full rounded-full text-base font-semibold"
          disabled={busy !== null || !!problem}
          onClick={() => void finish("qr")}
        >
          <QrCode className="size-5" aria-hidden="true" />
          {busy === "qr" ? "Starting…" : `Show QR · ${formatInvoiceMoney(due)}`}
        </Button>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">
          To take cards by QR code,{" "}
          <Link href="/app/invoices/settings" className="font-medium text-foreground underline">
            set up online payments
          </Link>
          .
        </p>
      )}

      {paidOther ? (
        <section className={cn(cardClass, "space-y-3")}>
          <p className="text-sm font-semibold text-foreground">Record {formatInvoiceMoney(due)}</p>
          <div role="radiogroup" aria-label="How they paid" className="flex flex-wrap gap-2">
            {METHODS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={method === option.value}
                onClick={() => setMethod(option.value)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-sm transition-colors",
                  method === option.value ? "bg-foreground font-semibold text-background" : "bg-muted text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-foreground">
            Tip (optional)
            <input
              aria-label="Tip"
              placeholder="$0.00"
              inputMode="decimal"
              className={cn(softInputClass, "h-10 w-28 text-right tabular-nums")}
              value={tipText}
              onChange={(event) => setTipText(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">Booked as income today.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-11 flex-1 rounded-full"
              disabled={busy !== null || !!problem || !method}
              onClick={() => void finish("paid")}
            >
              {busy === "paid" ? "Saving…" : "Record payment"}
            </Button>
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-full" onClick={() => setPaidOther(false)}>
              Back
            </Button>
          </div>
        </section>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-full"
          disabled={busy !== null || !!problem}
          onClick={() => {
            setError(null)
            setPaidOther(true)
          }}
        >
          <Banknote className="size-4" aria-hidden="true" />
          They paid another way
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full rounded-full"
        disabled={busy !== null || !!problem}
        onClick={() => void finish("later")}
      >
        <Clock className="size-4" aria-hidden="true" />
        {busy === "later" ? "Saving…" : "They'll pay later"}
      </Button>
      <p className="px-1 text-center text-xs text-muted-foreground">
        {appointment.clientEmail
          ? `Pay later emails ${appointment.clientEmail} an invoice due today.`
          : "Pay later opens a link you can text them."}
      </p>

      {error ? <p className="px-1 text-center text-sm text-destructive">{error}</p> : null}

      {appointment.status === "confirmed" ? (
        <button
          type="button"
          className="w-full py-2 text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          disabled={busy !== null}
          onClick={() => void finishWithoutCharging()}
        >
          {busy === "none" ? "Saving…" : "Finish without charging"}
        </button>
      ) : null}
    </div>
  )
}
