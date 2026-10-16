"use client"

import { useState } from "react"
import { AlertTriangle, Check, ExternalLink, X } from "lucide-react"
import { Capacitor } from "@capacitor/core"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { updatePaymentAccount } from "@/lib/api/invoicesApi"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceRefundedTotal, type InvoiceType } from "@shared/schemas/invoice"

// What happened to a paid invoice's money: the payment, any refunds, a
// dispute, Stripe's fee, and what the user keeps (invoice detail page).

function shortDate(iso: string): string {
  return formatInvoiceDate(iso.slice(0, 10)).replace(/, \d{4}$/, "")
}

const REASON_LABELS: Record<string, string> = {
  requested_by_client: "requested by client",
  duplicate: "charged twice",
  other: "refund",
}

// Money the user still has from this invoice: the total, less refunds and
// any disputed money not won back.
export function invoiceKeptAmount(invoice: InvoiceType): number {
  const disputed =
    invoice.dispute && invoice.dispute.fundsWithdrawn && invoice.dispute.status !== "won" ? invoice.dispute.amount : 0
  return (Math.round(invoice.total * 100) - Math.round(invoiceRefundedTotal(invoice) * 100) - Math.round(disputed * 100)) / 100
}

export function hasMoneyHistory(invoice: InvoiceType): boolean {
  return invoice.status === "paid" && (invoice.refunds.length > 0 || !!invoice.dispute)
}

export function InvoiceMoneyBreakdown({ invoice }: { invoice: InvoiceType }) {
  const dispute = invoice.dispute
  const disputedOut = dispute && dispute.fundsWithdrawn && dispute.status !== "won"
  const fees = invoice.paidFeeAmount + (dispute?.feeAmount ?? 0)
  const keep = invoiceKeptAmount(invoice) - fees
  return (
    <section aria-label="Money" className="rounded-[18px] border border-card-border bg-card px-4 py-1 text-sm">
      <div className="flex justify-between gap-3 border-b border-border py-3">
        <span>Paid {invoice.paidAt ? shortDate(invoice.paidAt) : ""}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">{formatInvoiceMoney(invoice.total)}</span>
      </div>
      {invoice.refunds.map((refund) => (
        <div key={refund.id} className="flex justify-between gap-3 border-b border-border py-3">
          <span>
            Refunded {shortDate(refund.date)} · {REASON_LABELS[refund.reason] ?? "refund"}
          </span>
          <span className="shrink-0 whitespace-nowrap tabular-nums text-red-700 dark:text-red-400">−{formatInvoiceMoney(refund.amount)}</span>
        </div>
      ))}
      {dispute && dispute.fundsWithdrawn ? (
        <div className="flex justify-between gap-3 border-b border-border py-3">
          <span>
            Disputed · {dispute.status === "won" ? "won back" : dispute.status === "lost" ? "lost" : "held by Stripe"}
          </span>
          <span className={`shrink-0 whitespace-nowrap tabular-nums ${disputedOut ? "text-red-700 dark:text-red-400" : "text-muted-foreground line-through"}`}>
            −{formatInvoiceMoney(dispute.amount)}
          </span>
        </div>
      ) : null}
      {fees > 0 ? (
        <div className="flex justify-between gap-3 border-b border-border py-3 text-muted-foreground">
          <span>Stripe fees{invoice.refunds.length > 0 ? " (not returned)" : ""}</span>
          <span className="shrink-0 whitespace-nowrap tabular-nums">−{formatInvoiceMoney(fees)}</span>
        </div>
      ) : null}
      <div className="flex justify-between gap-3 py-3 font-bold">
        <span>You keep</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">{formatInvoiceMoney(Math.max(0, keep))}</span>
      </div>
    </section>
  )
}

// Open / decided dispute, with the way to respond (Stripe's Express
// dashboard, where the evidence form lives).
export function InvoiceDisputeCard({
  invoice,
  workspaceId,
  onSharePdf,
}: {
  invoice: InvoiceType
  workspaceId: string
  onSharePdf: () => void
}) {
  const { toast } = useToast()
  const [opening, setOpening] = useState(false)
  const dispute = invoice.dispute
  if (!dispute) return null

  async function respond() {
    setOpening(true)
    try {
      const { url } = await updatePaymentAccount(workspaceId, { action: "dashboard" })
      if (!url) throw new Error("Stripe didn't return a link.")
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser")
        await Browser.open({ url })
      } else {
        window.open(url, "_blank", "noopener,noreferrer")
      }
    } catch (error) {
      toast({
        title: "Couldn't open Stripe",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setOpening(false)
    }
  }

  if (dispute.status === "won" || dispute.status === "lost") {
    const won = dispute.status === "won"
    return (
      <div className="flex items-start gap-2.5 rounded-[18px] border border-card-border bg-card p-4 text-sm leading-relaxed">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${won ? "bg-accent" : "bg-muted"}`}>
          {won ? (
            <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <X className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </span>
        <span>
          {won ? (
            <>
              <strong>You won the dispute.</strong>{" "}
              {dispute.fundsWithdrawn ? `Stripe returned the ${formatInvoiceMoney(dispute.amount)} — added back to your income.` : "No money was taken."}
            </>
          ) : (
            <>
              <strong>The bank sided with {invoice.clientName}.</strong> The {formatInvoiceMoney(dispute.amount)} stays
              refunded{dispute.feeAmount > 0 ? ` and the ${formatInvoiceMoney(dispute.feeAmount)} fee stays an expense` : ""}.
            </>
          )}
        </span>
      </div>
    )
  }

  const due = dispute.evidenceDueBy ? shortDate(dispute.evidenceDueBy) : null
  return (
    <div className="space-y-3 rounded-[18px] border border-card-border bg-card p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
          <AlertTriangle className="size-[18px] text-red-700 dark:text-red-400" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">
            {dispute.status === "inquiry" ? `${invoice.clientName}'s bank is asking about this payment` : `${invoice.clientName} disputed this payment`}
          </div>
          <div className="text-sm text-muted-foreground">
            {formatInvoiceMoney(dispute.amount)}
            {dispute.reason ? ` · reason: “${dispute.reason.replace(/_/g, " ")}”` : ""}
          </div>
        </div>
      </div>
      <p className="rounded-xl bg-muted px-3 py-2.5 text-sm leading-relaxed">
        {dispute.fundsWithdrawn
          ? `Stripe took the ${formatInvoiceMoney(dispute.amount)} back while the bank reviews it${
              dispute.feeAmount > 0 ? `, plus a ${formatInvoiceMoney(dispute.feeAmount)} dispute fee` : ""
            }.`
          : "No money has moved yet."}{" "}
        {due ? `Send your proof (the invoice, messages, delivery) by ${due}.` : "Send your proof (the invoice, messages, delivery) in Stripe."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="rounded-full bg-foreground px-4 font-semibold text-background hover:bg-foreground/90"
          disabled={opening}
          onClick={() => void respond()}
        >
          {opening ? "Opening..." : "Respond in Stripe"}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" onClick={onSharePdf}>
          Share invoice PDF
        </Button>
      </div>
    </div>
  )
}
