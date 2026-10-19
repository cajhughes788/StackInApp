"use client"

import { useState } from "react"
import { Check, FileText, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/helpers"
import { cn } from "@/lib/utils"
import { PAID_METHOD_LABELS } from "@/components/invoices/invoice-ui"
import { resolvePlaidDisplayName } from "@shared/plaidClassification"
import { formatInvoiceDate } from "@shared/invoiceDisplay"
import type { PlaidInvoiceMatch, PlaidInvoiceRef } from "@shared/schemas/plaidPendingTransaction"
import type { InvoiceType } from "@shared/schemas/invoice"
import type { PlaidPendingTransaction } from "@/lib/api/plaidApi"

// The Needs-you card for a bank deposit that looks like an invoice payment
// (transaction.invoiceMatch, set by pickPaidInvoices on the server). Five
// shapes: one invoice, several in one deposit, a processor payout net of
// its fee, a choice between equally good matches, and money for an invoice
// already marked paid by hand. "Not this" hands the deposit back to the
// ordinary income card.

function shortDate(date: string): string {
  return formatInvoiceDate(date).replace(/, \d{4}$/, "")
}

function groupKey(group: PlaidInvoiceRef[]): string {
  return group.map((ref) => ref.invoiceId).join("|")
}

// What one payment in a match pays: "Deposit for Invoice #0012".
function purposeLabel(ref: PlaidInvoiceRef): string {
  if (ref.purpose === "deposit") return `Deposit for Invoice #${ref.number}`
  if (ref.purpose === "balance") return `Balance of Invoice #${ref.number}`
  if (ref.purpose === "partial") return `Part of Invoice #${ref.number}`
  return `Pays Invoice #${ref.number}`
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export default function InvoiceMatchCard({
  transaction,
  match,
  invoicesById,
  disabled,
  onPay,
  onAlreadyCounted,
  onNotThis,
}: {
  transaction: PlaidPendingTransaction
  match: PlaidInvoiceMatch
  // From the invoices store when it's loaded — adds due dates and how an
  // already-paid invoice was paid. The card works without it.
  invoicesById: Map<string, InvoiceType>
  disabled?: boolean
  onPay: (group: PlaidInvoiceRef[]) => void
  onAlreadyCounted: () => void
  onNotThis: () => void
}) {
  const displayName = resolvePlaidDisplayName(transaction.merchantName, transaction.rawName)
  const groups = [match.invoices, ...match.alternatives]
  const [picked, setPicked] = useState<string>(groupKey(match.invoices))
  const first = match.invoices[0]
  // What the first invoice will still be owed after this deposit.
  const firstInvoice = invoicesById.get(first.invoiceId)
  const stillDue = firstInvoice
    ? Math.max(0, toCents(firstInvoice.total) - toCents(firstInvoice.amountPaid) - toCents(first.amount)) / 100
    : 0

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="break-words font-medium">{displayName}</div>
        <div className="text-sm text-muted-foreground">
          {shortDate(transaction.date)} · {match.kind === "net_of_fees" ? "payout" : "bank deposit"}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          match.alreadyPaid ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
        )}
      >
        +{formatCurrency(transaction.amount)}
      </div>
    </div>
  )

  if (match.alreadyPaid) {
    const paidInvoice = invoicesById.get(first.invoiceId)
    // Mid-sentence: brand names keep their capitals ("by Zelle", "by check").
    // The hand-recorded payment this deposit would be: same amount (tip
    // included), else the latest one recorded by hand.
    const manualPayments = paidInvoice?.payments.filter((payment) => payment.via === "manual") ?? []
    const manual =
      manualPayments.find((payment) => toCents(payment.amount) + toCents(payment.tipAmount) === toCents(first.amount)) ??
      manualPayments.pop()
    const method = manual?.method
    const how =
      !method || method === "other"
        ? ""
        : ` by ${["cash", "check", "card", "pos"].includes(method) ? PAID_METHOD_LABELS[method].toLowerCase() : PAID_METHOD_LABELS[method]}`
    const when = manual ? ` on ${shortDate(manual.receivedOn)}` : ""
    const label =
      match.invoices.length === 1 ? `Invoice #${first.number}` : match.invoices.map((ref) => `#${ref.number}`).join(" and ")
    return (
      <div className="space-y-3 rounded-[18px] border border-card-border bg-card p-4">
        {header}
        <div className="flex items-start gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-sm leading-snug">
          <Info className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {match.invoices.length === 1 && first.purpose !== "full" ? (
              <>
                You recorded a {formatCurrency(first.amount)} {first.purpose === "deposit" ? "deposit" : "payment"} on{" "}
                <strong>{label}</strong>
              </>
            ) : (
              <>
                You marked <strong>{label}</strong> paid
              </>
            )}
            {how}
            {when}. Is this the same money?
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" className="rounded-full bg-foreground px-4 font-semibold text-background hover:bg-foreground/90" disabled={disabled} onClick={onAlreadyCounted}>
            Yes, already counted
          </Button>
          <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" disabled={disabled} onClick={onNotThis}>
            No, it&apos;s new income
          </Button>
        </div>
      </div>
    )
  }

  if (match.alternatives.length > 0) {
    const pickedGroup = groups.find((group) => groupKey(group) === picked) ?? null
    return (
      <div className="space-y-3 rounded-[18px] border border-card-border bg-card p-4">
        {header}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Which invoice is this for?</legend>
          {groups.map((group) => {
            const key = groupKey(group)
            const active = picked === key
            const due = group.length === 1 ? invoicesById.get(group[0].invoiceId)?.dueDate : undefined
            return (
              <label
                key={key}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm",
                  active ? "border-2 border-primary bg-accent" : "border border-card-border"
                )}
              >
                <input
                  type="radio"
                  name={`invoice-pick-${transaction.id}`}
                  checked={active}
                  onChange={() => setPicked(key)}
                  className="size-[18px] accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1 break-words">
                  {group
                    .map(
                      (ref) =>
                        `#${ref.number} · ${ref.clientName}${ref.purpose === "deposit" ? " (deposit)" : ""}${
                          ref.tipAmount > 0 ? ` + ${formatCurrency(ref.tipAmount)} tip` : ""
                        }`
                    )
                    .join(" + ")}
                </span>
                {due ? <span className="shrink-0 text-muted-foreground">due {shortDate(due)}</span> : null}
              </label>
            )
          })}
          <label
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm",
              picked === "none" ? "border-2 border-primary bg-accent" : "border border-card-border"
            )}
          >
            <input
              type="radio"
              name={`invoice-pick-${transaction.id}`}
              checked={picked === "none"}
              onChange={() => setPicked("none")}
              className="size-[18px] accent-[var(--primary)]"
            />
            <span>Neither, it&apos;s other income</span>
          </label>
        </fieldset>
        <Button
          type="button"
          size="sm"
          className="rounded-full px-4 font-semibold"
          disabled={disabled}
          onClick={() => (pickedGroup ? onPay(pickedGroup) : onNotThis())}
        >
          <Check className="size-4" aria-hidden="true" /> Confirm
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-[18px] border border-card-border bg-card p-4">
      {header}
      {match.kind === "combined" ? (
        <div className="space-y-1.5 rounded-xl bg-accent px-3 py-2.5 text-sm">
          <strong>Looks like {match.invoices.length} invoices</strong>
          {match.invoices.map((ref) => (
            <div key={ref.invoiceId} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">
                #{ref.number} · {ref.clientName}
                {ref.purpose === "deposit" ? " · deposit" : ref.purpose === "balance" ? " · balance" : ""}
              </span>
              <span className="shrink-0 tabular-nums">{formatCurrency(ref.amount)}</span>
            </div>
          ))}
        </div>
      ) : match.kind === "with_tip" ? (
        <div className="space-y-1.5 rounded-xl bg-accent px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-3">
            <strong className="min-w-0 break-words">{purposeLabel(first)}</strong>
            <span className="shrink-0 tabular-nums">{formatCurrency(first.amount)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Tip on top</span>
            <span className="shrink-0 tabular-nums">+{formatCurrency(first.tipAmount)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{first.clientName} · the tip is added to your income as tips</div>
        </div>
      ) : match.kind === "net_of_fees" ? (
        <div className="space-y-1.5 rounded-xl bg-accent px-3 py-2.5 text-sm">
          {match.invoices.map((ref) => (
            <div key={ref.invoiceId} className="flex justify-between gap-3">
              <strong className="min-w-0 break-words">
                {purposeLabel(ref)}
                {match.invoices.length > 1 ? ` · ${ref.clientName}` : ""}
              </strong>
              <span className="shrink-0 tabular-nums">{formatCurrency(ref.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 text-muted-foreground">
            <span>{displayName} kept a fee</span>
            <span className="shrink-0 tabular-nums">−{formatCurrency(match.feeAmount)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Income: {formatCurrency(match.invoiceTotal)} · Expense: {formatCurrency(match.feeAmount)} in Payment
            processing fees
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl bg-accent px-3 py-2.5">
          <FileText className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <div className="min-w-0 text-sm leading-snug">
            <strong>{purposeLabel(first)}</strong>
            <br />
            <span className="text-muted-foreground">
              {first.clientName}
              {stillDue > 0 && firstInvoice
                ? ` · then ${formatCurrency(stillDue)} due ${shortDate(firstInvoice.dueDate)}`
                : firstInvoice?.dueDate
                  ? ` · due ${shortDate(firstInvoice.dueDate)}`
                  : ""}
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="rounded-full px-4 font-semibold"
          disabled={disabled}
          onClick={() => onPay(match.invoices)}
        >
          <Check className="size-4" aria-hidden="true" />
          {match.invoices.length > 1
            ? `Mark ${match.invoices.length === 2 ? "both" : "all"} paid`
            : first.purpose === "deposit"
              ? "Record deposit"
              : match.kind === "with_tip"
                ? "Mark paid with tip"
                : "Mark invoice paid"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" disabled={disabled} onClick={onNotThis}>
          {match.invoices.length > 1 ? "Not these" : "Not this"}
        </Button>
      </div>
    </div>
  )
}
