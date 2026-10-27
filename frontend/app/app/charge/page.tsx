"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Clock, Share2 } from "lucide-react"
import QRCode from "qrcode"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { InvoicesPage, cardClass, localToday, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"
import { createQuickCharge, updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { shareLink } from "@/lib/documentExport"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { InvoiceType } from "@shared/schemas/invoice"

// Quick charge: type an amount, show a QR code, the customer scans it and
// pays on their own phone (card, Apple Pay, Google Pay). Underneath it's a
// one-line invoice (createQuickCharge), so the payment books itself as
// income — with the tip and Stripe's fee — like any paid invoice. This
// screen watches for the payment and says when it's in.

const POLL_MS = 3000

type Stage =
  | { kind: "form" }
  | { kind: "showing"; invoiceId: string; url: string; qr: string; amount: number }
  | { kind: "paid"; invoice: InvoiceType }
  | { kind: "payLater"; invoiceId: string; url: string; amount: number }
  | { kind: "converted"; invoice: InvoiceType; emailedTo: string | null; url: string }
  | { kind: "canceled" }

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00`)
  day.setDate(day.getDate() + days)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

export default function ChargePageRoute() {
  return (
    <Suspense fallback={null}>
      <ChargePage />
    </Suspense>
  )
}

function ChargePage() {
  const router = useRouter()
  const { ready, workspaceId, invoices, loadStatus } = useInvoicesWorkspace()
  const paymentAccount = useInvoicesStore((s) => (workspaceId ? s.byWorkspaceId[workspaceId]?.paymentAccount : null))
  const load = useInvoicesStore((s) => s.load)

  const [amountText, setAmountText] = useState("")
  const [description, setDescription] = useState("")
  const [clientName, setClientName] = useState("")
  const [askForTip, setAskForTip] = useState(true)
  const [stage, setStage] = useState<Stage>({ kind: "form" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const mutationId = useRef(newMutationId())
  // "They'll pay later": who owes it and when.
  const [laterEmail, setLaterEmail] = useState("")
  const [laterPhone, setLaterPhone] = useState("")
  const [laterDue, setLaterDue] = useState(() => addDays(localToday(), 7))
  const [laterSendEmail, setLaterSendEmail] = useState(true)

  const canTakePayments = !!paymentAccount?.chargesEnabled && !!paymentAccount.acceptOnline
  const amount = parseAmount(amountText)

  // While the QR code is up, check for the payment every few seconds.
  // (Also while filling in "pay later" — they might pay after all.)
  const showingId = stage.kind === "showing" || stage.kind === "payLater" ? stage.invoiceId : null
  useEffect(() => {
    if (!showingId || !workspaceId) return
    const timer = setInterval(() => void load(workspaceId, { force: true }).catch(() => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [showingId, workspaceId, load])
  useEffect(() => {
    if (!showingId) return
    const invoice = invoices.find((i) => i.id === showingId)
    if (invoice?.status === "paid") setStage({ kind: "paid", invoice })
    if (invoice?.status === "void") setStage({ kind: "canceled" })
  }, [invoices, showingId])

  async function showQr() {
    if (!workspaceId) return
    if (amount === null || amount < 0.5) {
      setError("Enter an amount of at least $0.50.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { invoice, shareUrl } = await createQuickCharge(workspaceId, {
        amount,
        description: description.trim() || undefined,
        clientName: clientName.trim() || undefined,
        askForTip,
        date: localToday(),
        clientMutationId: mutationId.current,
      })
      // Drawn on the phone; the link never leaves it to make the code.
      const qr = await QRCode.toDataURL(shareUrl, { errorCorrectionLevel: "M", margin: 1, width: 640 })
      setStage({ kind: "showing", invoiceId: invoice.id, url: shareUrl, qr, amount: invoice.total })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the charge. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function cancelCharge() {
    if (!workspaceId || stage.kind !== "showing") return
    setBusy(true)
    setError(null)
    try {
      await updateInvoiceStatus(workspaceId, stage.invoiceId, { action: "void" })
      void load(workspaceId, { force: true }).catch(() => {})
      setStage({ kind: "canceled" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel the charge.")
    } finally {
      setBusy(false)
    }
  }

  // Turns the unpaid charge into a regular invoice (same number and link),
  // then emails it if asked.
  async function convertToInvoice() {
    if (!workspaceId || stage.kind !== "payLater") return
    const name = clientName.trim()
    const email = laterEmail.trim()
    if (!name) {
      setError("Who's paying later? Add their name.")
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email doesn't look right.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      let { invoice } = await updateInvoiceStatus(workspaceId, stage.invoiceId, {
        action: "convert_to_invoice",
        clientName: name,
        clientEmail: email || null,
        clientPhone: laterPhone.trim() || null,
        dueDate: laterDue,
      })
      let emailedTo: string | null = null
      if (email && laterSendEmail) {
        try {
          invoice = (await updateInvoiceStatus(workspaceId, stage.invoiceId, { action: "email", to: email })).invoice
          emailedTo = email
        } catch {
          setError("Saved as an invoice, but the email didn't send. Send it from the invoice's page.")
        }
      }
      void load(workspaceId, { force: true }).catch(() => {})
      setStage({ kind: "converted", invoice, emailedTo, url: stage.url })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save it as an invoice.")
    } finally {
      setBusy(false)
    }
  }

  async function shareInstead() {
    if (stage.kind !== "showing") return
    const result = await shareLink(stage.url, "Pay here", `Pay ${formatInvoiceMoney(stage.amount)}`)
    setShareNote(result === "copied" ? "Link copied." : result === "unavailable" ? stage.url : null)
  }

  function startOver() {
    mutationId.current = newMutationId()
    setAmountText("")
    setDescription("")
    setClientName("")
    setAskForTip(true)
    setLaterEmail("")
    setLaterPhone("")
    setLaterDue(addDays(localToday(), 7))
    setLaterSendEmail(true)
    setError(null)
    setShareNote(null)
    setStage({ kind: "form" })
  }

  const inputClass =
    "w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground"

  return (
    <InvoicesPage ready={ready} loadingLabel="Loading..." title="Charge" backHref="/app/home" backLabel="Back to Home">
      {stage.kind === "form" ? (
        loadStatus === "ready" && !canTakePayments ? (
          <div className={cn(cardClass, "space-y-3 text-sm")}>
            <p className="font-semibold text-foreground">Turn on card payments first</p>
            <p className="text-muted-foreground">
              Customers pay through Stripe, into your own account. Connect it and turn on online payments in Invoice
              settings, then come back to charge.
            </p>
            <Link href="/app/invoices/settings" className="inline-flex font-semibold text-primary">
              Open Invoice settings
            </Link>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void showQr()
            }}
          >
            <section className={cn(cardClass, "flex flex-col items-center gap-1")}>
              <label htmlFor="charge-amount" className="text-sm text-muted-foreground">
                Amount
              </label>
              {/* "$" and the number centre together: the field is only as wide as what's typed. */}
              <div className="flex items-baseline justify-center text-4xl font-semibold tabular-nums text-foreground">
                <span aria-hidden="true">$</span>
                <input
                  id="charge-amount"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  autoFocus
                  style={{ width: `${Math.max(amountText.length, 4) + 0.5}ch` }}
                  className="min-w-0 bg-transparent text-left outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </section>
            <section className={cn(cardClass, "space-y-3")}>
              <input
                aria-label="What it's for (optional)"
                placeholder="What it's for (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                className={inputClass}
              />
              <input
                aria-label="Customer name (optional)"
                placeholder="Customer name (optional)"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                maxLength={80}
                className={inputClass}
              />
              <label className="flex items-center justify-between gap-3 text-sm text-foreground">
                Ask for a tip
                <Switch checked={askForTip} onCheckedChange={setAskForTip} />
              </label>
            </section>
            {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="h-[52px] w-full rounded-full text-base" disabled={busy || amount === null}>
              {busy ? "Starting…" : amount !== null ? `Show QR · ${formatInvoiceMoney(amount)}` : "Show QR"}
            </Button>
          </form>
        )
      ) : stage.kind === "showing" ? (
        <div className="space-y-4">
          <section className={cn(cardClass, "flex flex-col items-center gap-3 text-center")}>
            <div className="text-sm text-muted-foreground">Scan to pay</div>
            <div className="text-4xl font-semibold tabular-nums text-foreground">{formatInvoiceMoney(stage.amount)}</div>
            {/* Always dark-on-white so any camera can read it. */}
            <img src={stage.qr} alt="QR code to pay" className="w-full max-w-[18rem] rounded-xl bg-white p-3" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              Waiting for payment…
            </div>
          </section>
          {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
          {shareNote ? <p className="break-all px-1 text-sm text-muted-foreground">{shareNote}</p> : null}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setError(null)
              setLaterSendEmail(true)
              setStage({ kind: "payLater", invoiceId: stage.invoiceId, url: stage.url, amount: stage.amount })
            }}
          >
            <Clock className="size-4" aria-hidden="true" />
            They&apos;ll pay later
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => void shareInstead()}>
              <Share2 className="size-4" aria-hidden="true" />
              Send link instead
            </Button>
            <Button type="button" variant="outline" onClick={() => void cancelCharge()} disabled={busy}>
              {busy ? "Canceling…" : "Cancel charge"}
            </Button>
          </div>
        </div>
      ) : stage.kind === "payLater" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void convertToInvoice()
          }}
        >
          <section className={cn(cardClass, "space-y-1")}>
            <div className="font-semibold text-foreground">Pay {formatInvoiceMoney(stage.amount)} later</div>
            <p className="text-sm text-muted-foreground">
              This becomes a regular invoice with the same link. They can pay it any time, and 521 reminds them by email
              if it&apos;s late.
            </p>
          </section>
          <section className={cn(cardClass, "space-y-3")}>
            <input
              aria-label="Their name"
              placeholder="Their name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={80}
              className={inputClass}
              autoFocus
            />
            <input
              aria-label="Email (for the invoice and reminders)"
              placeholder="Email (for the invoice and reminders)"
              type="email"
              inputMode="email"
              value={laterEmail}
              onChange={(e) => setLaterEmail(e.target.value)}
              maxLength={254}
              className={inputClass}
            />
            <input
              aria-label="Phone (optional)"
              placeholder="Phone (optional)"
              type="tel"
              value={laterPhone}
              onChange={(e) => setLaterPhone(e.target.value)}
              maxLength={40}
              className={inputClass}
            />
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              Due
              <input
                type="date"
                aria-label="Due date"
                value={laterDue}
                min={localToday()}
                onChange={(e) => setLaterDue(e.target.value || addDays(localToday(), 7))}
                className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            {laterEmail.trim() ? (
              <label className="flex items-center justify-between gap-3 text-sm text-foreground">
                Email them the invoice now
                <Switch checked={laterSendEmail} onCheckedChange={setLaterSendEmail} />
              </label>
            ) : null}
          </section>
          {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="h-[52px] w-full rounded-full text-base" disabled={busy || !clientName.trim()}>
            {busy ? "Saving…" : "Save as invoice"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setError(null)
              void QRCode.toDataURL(stage.url, { errorCorrectionLevel: "M", margin: 1, width: 640 }).then((qr) =>
                setStage({ kind: "showing", invoiceId: stage.invoiceId, url: stage.url, qr, amount: stage.amount })
              )
            }}
          >
            Back to the QR code
          </Button>
        </form>
      ) : stage.kind === "converted" ? (
        <div className="space-y-4">
          <section className={cn(cardClass, "flex flex-col items-center gap-2 py-6 text-center")}>
            <div className="text-lg font-semibold text-foreground">
              Invoice #{stage.invoice.number} {stage.emailedTo ? "sent" : "saved"}
            </div>
            <div className="text-sm text-muted-foreground">
              {stage.invoice.clientName} owes {formatInvoiceMoney(stage.invoice.total)}, due {shortDate(stage.invoice.dueDate)}
              {stage.emailedTo ? ` · emailed to ${stage.emailedTo}` : ""}
            </div>
          </section>
          {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
          {!stage.emailedTo ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() =>
                void shareLink(stage.url, `Invoice #${stage.invoice.number}`, `Pay ${formatInvoiceMoney(stage.invoice.total)}`)
              }
            >
              <Share2 className="size-4" aria-hidden="true" />
              Text or share the link
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/app/invoices/view?id=${encodeURIComponent(stage.invoice.id)}`)}>
              View invoice
            </Button>
            <Button type="button" onClick={() => router.push("/app/home")}>
              Done
            </Button>
          </div>
        </div>
      ) : stage.kind === "paid" ? (
        <div className="space-y-4">
          <section className={cn(cardClass, "flex flex-col items-center gap-2 py-8 text-center")}>
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-7" aria-hidden="true" />
            </span>
            <div className="text-lg font-semibold text-foreground">Paid</div>
            <div className="text-3xl font-semibold tabular-nums text-foreground">
              {formatInvoiceMoney(stage.invoice.amountPaid)}
            </div>
            {(() => {
              const tip = stage.invoice.payments.reduce((sum, p) => sum + (p.tipAmount ?? 0), 0)
              return tip > 0 ? (
                <div className="text-sm text-muted-foreground">+ {formatInvoiceMoney(tip)} tip</div>
              ) : null
            })()}
            <div className="text-sm text-muted-foreground">Booked as income for you.</div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={startOver}>
              New charge
            </Button>
            <Button type="button" onClick={() => router.push("/app/home")}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={cn(cardClass, "text-center text-sm text-muted-foreground")}>
            Charge canceled — the link no longer works.
          </div>
          <Button type="button" className="w-full" onClick={startOver}>
            New charge
          </Button>
        </div>
      )}
    </InvoicesPage>
  )
}
