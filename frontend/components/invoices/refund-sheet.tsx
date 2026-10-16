"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceRefundableAmount, type InvoiceRefund, type InvoiceType } from "@shared/schemas/invoice"

// Money back on a paid invoice. An online payment is refunded through Stripe
// (to the client's card or bank); anything else is recorded only — the user
// sends the money themselves. Either way the refund is its own entry dated
// today, so the month the invoice was paid stays as it was.

const REASONS: Array<{ value: InvoiceRefund["reason"]; label: string }> = [
  { value: "requested_by_client", label: "Requested by client" },
  { value: "duplicate", label: "Charged twice" },
  { value: "other", label: "Other" },
]

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

// "Acme's", but "Acme Coffee Roasters'".
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned) * 100) / 100
  return value > 0 ? value : null
}

export default function RefundSheet({
  open,
  onOpenChange,
  invoice,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceType
  workspaceId: string
}) {
  const { toast } = useToast()
  const upsertInvoice = useInvoicesStore((state) => state.upsertInvoice)
  const refundable = invoiceRefundableAmount(invoice)
  const throughStripe = invoice.paidVia === "online" && !!invoice.paidStripePaymentIntentId
  const [mode, setMode] = useState<"full" | "part">("full")
  const [amountText, setAmountText] = useState("")
  const [reason, setReason] = useState<InvoiceRefund["reason"]>("requested_by_client")
  const [saving, setSaving] = useState(false)
  // One id per opening: a retried request can't refund twice.
  const mutationId = useRef(newMutationId())

  useEffect(() => {
    if (!open) return
    mutationId.current = newMutationId()
    setMode("full")
    setAmountText(refundable.toFixed(2))
    setReason("requested_by_client")
    setSaving(false)
  }, [open, refundable])

  const amount = mode === "full" ? refundable : parseAmount(amountText)
  const tooMuch = amount !== null && Math.round(amount * 100) > Math.round(refundable * 100)
  const valid = amount !== null && !tooMuch

  async function submit() {
    if (!valid || amount === null) return
    setSaving(true)
    try {
      const { invoice: updated } = await updateInvoiceStatus(workspaceId, invoice.id, {
        action: "refund",
        amount,
        reason,
        clientMutationId: mutationId.current,
      })
      upsertInvoice(workspaceId, updated)
      const entries = useEntriesStore.getState()
      const periodId = entries.byWorkspaceId[workspaceId]?.periodId
      if (periodId) void entries.refreshFromBackend(workspaceId, periodId, { force: true }).catch(() => {})
      toast({
        title: `${formatInvoiceMoney(amount)} refunded`,
        description: throughStripe ? `On its way back to ${invoice.clientName}.` : "Recorded — your income is updated.",
      })
      onOpenChange(false)
    } catch (error) {
      toast({
        title: "Couldn't refund",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
      setSaving(false)
    }
  }

  const paidDate = invoice.paidAt ? formatInvoiceDate(invoice.paidAt.slice(0, 10)).replace(/, \d{4}$/, "") : "the paid date"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">{throughStripe ? `Refund ${invoice.clientName}` : "Record a refund"}</SheetTitle>
          <SheetDescription>
            Invoice #{invoice.number} · {formatInvoiceMoney(refundable)} left to refund
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-muted-foreground">How much?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["full", "part"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    "h-11 rounded-xl text-sm transition-colors",
                    mode === option
                      ? "border-2 border-primary bg-accent font-semibold text-foreground"
                      : "border border-card-border bg-card text-foreground hover:bg-muted"
                  )}
                >
                  {option === "full" ? "Full amount" : "Part of it"}
                </button>
              ))}
            </div>
            {mode === "part" ? (
              <label className={fieldLabelClass}>
                Amount to refund
                <input
                  className={cn(softInputClass, "tabular-nums")}
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                />
              </label>
            ) : null}
            {tooMuch ? <p className="text-sm text-destructive">That's more than the {formatInvoiceMoney(refundable)} left.</p> : null}
          </fieldset>

          <label className={fieldLabelClass}>
            Reason
            <select className={softInputClass} value={reason} onChange={(event) => setReason(event.target.value as InvoiceRefund["reason"])}>
              {REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <p className="rounded-[14px] bg-muted px-3.5 py-3 text-sm leading-relaxed text-foreground">
            {throughStripe ? (
              <>
                Goes back to {possessive(invoice.clientName)} {invoice.paidMethod === "other" ? "bank account" : "card"} in 5–10
                days and lowers your income by <strong className="tabular-nums">{amount ? formatInvoiceMoney(amount) : "—"}</strong> on
                today&apos;s date — your {paidDate} income stays as it was.
                {invoice.paidFeeAmount > 0 ? ` Stripe keeps its ${formatInvoiceMoney(invoice.paidFeeAmount)} fee from the original payment.` : ""}
              </>
            ) : (
              <>
                521 doesn&apos;t move money for payments made outside Stripe — send it back the way you were paid, and
                this records it: your income drops by{" "}
                <strong className="tabular-nums">{amount ? formatInvoiceMoney(amount) : "—"}</strong> on today&apos;s date.
                If that payment leaves a connected bank, mark it Personal when it shows up so it isn&apos;t counted again.
              </>
            )}
          </p>

          <div className="flex gap-2.5">
            <Button type="button" variant="outline" className="h-[52px] flex-1 rounded-full font-semibold" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="h-[52px] flex-[2] rounded-full bg-foreground text-base font-semibold text-background hover:bg-foreground/90"
              disabled={!valid || saving}
              onClick={() => void submit()}
            >
              {saving ? "Refunding..." : `${throughStripe ? "Refund" : "Record"} ${amount ? formatInvoiceMoney(amount) : ""}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
