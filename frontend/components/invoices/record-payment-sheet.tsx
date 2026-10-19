"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { recordPaymentInBackground } from "@/lib/domain/invoiceService"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceBalanceDue, invoiceDueNow } from "@shared/invoicePayments"
import type { InvoicePaidMethod, InvoiceType } from "@shared/schemas/invoice"

// A payment received outside 521 — cash, a check, Zelle — for any amount up
// to what's still owed, plus an optional tip. Each one is its own income
// entry, dated the day it was paid.

// "Card" books under Card / POS, where the rest of the app keeps card money.
const METHODS: Array<{ value: InvoicePaidMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "check", label: "Check" },
  { value: "pos", label: "Card" },
  { value: "other", label: "Other" },
]

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

// Dollars and cents as typed ("700", "$1,250.5"); null when it isn't one.
function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (cleaned === "") return null
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100) / 100
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export default function RecordPaymentSheet({
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
  const today = localToday()
  const balance = invoiceBalanceDue(invoice)
  // Pre-filled with what's owed next: the deposit while one is due, else the rest.
  const suggested = invoiceDueNow(invoice)?.amount ?? balance
  const [amountText, setAmountText] = useState("")
  const [tipOpen, setTipOpen] = useState(false)
  const [tipText, setTipText] = useState("")
  const [paidDate, setPaidDate] = useState(today)
  const [method, setMethod] = useState<InvoicePaidMethod | null>(null)
  const mutationId = useRef(newMutationId())

  useEffect(() => {
    if (open) {
      mutationId.current = newMutationId()
      setAmountText(suggested.toFixed(2))
      setTipOpen(false)
      setTipText("")
      setPaidDate(localToday())
      setMethod(null)
    }
    // Reset only when the sheet opens, not as the invoice updates behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const amount = parseMoney(amountText)
  const tip = tipOpen ? parseMoney(tipText) ?? (tipText.trim() === "" ? 0 : null) : 0
  const amountError =
    amount === null || amount <= 0
      ? "Enter the amount paid."
      : toCents(amount) > toCents(balance)
        ? `Only ${formatInvoiceMoney(balance)} is left on this invoice — put anything extra in the tip.`
        : null
  const tipError = tip === null ? "Enter the tip as dollars and cents." : null
  const valid = !amountError && !tipError && method !== null
  const remaining = amount !== null && !amountError ? Math.max(0, toCents(balance) - toCents(amount)) / 100 : balance

  function submit() {
    if (!valid || amount === null || tip === null || !method) return
    recordPaymentInBackground(workspaceId, invoice, {
      amount,
      tipAmount: tip,
      paidDate,
      paymentMethod: method,
      clientMutationId: mutationId.current,
    })
    // The invoice behind the sheet shows the new payment and what's left.
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">Record a payment</SheetTitle>
          <SheetDescription>
            #{invoice.number} · {invoice.clientName} · <span className="tabular-nums">{formatInvoiceMoney(balance)}</span> due
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <label className={fieldLabelClass}>
            Amount paid
            <input
              type="text"
              inputMode="decimal"
              className={cn(softInputClass, "tabular-nums")}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              aria-invalid={!!amountError}
            />
            {amountError && amountText.trim() !== "" ? (
              <span className="mt-1 block text-xs font-normal text-red-700 dark:text-red-400">{amountError}</span>
            ) : null}
          </label>

          {tipOpen ? (
            <label className={fieldLabelClass}>
              Tip
              <input
                type="text"
                inputMode="decimal"
                className={cn(softInputClass, "tabular-nums")}
                value={tipText}
                placeholder="0.00"
                onChange={(event) => setTipText(event.target.value)}
                aria-invalid={!!tipError}
                autoFocus
              />
              {tipError ? <span className="mt-1 block text-xs font-normal text-red-700 dark:text-red-400">{tipError}</span> : null}
            </label>
          ) : (
            <button type="button" className="text-sm font-medium text-primary" onClick={() => setTipOpen(true)}>
              + Add a tip
            </button>
          )}

          <label className={fieldLabelClass}>
            Date paid
            <input
              type="date"
              className={softInputClass}
              value={paidDate}
              min={invoice.issueDate}
              max={today}
              onChange={(event) => event.target.value && setPaidDate(event.target.value)}
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted-foreground">How were you paid?</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((option) => {
                const active = method === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMethod(option.value)}
                    className={cn(
                      "h-11 rounded-xl text-sm transition-colors",
                      active
                        ? "border-2 border-primary bg-accent font-semibold text-foreground"
                        : "border border-card-border bg-card text-foreground hover:bg-muted"
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {amount !== null && !amountError && tip !== null ? (
            <p className="rounded-[14px] bg-muted px-3.5 py-3 text-sm leading-relaxed text-foreground">
              Adds <strong className="tabular-nums">{formatInvoiceMoney(amount)}</strong>
              {tip > 0 ? (
                <>
                  {" "}
                  + <strong className="tabular-nums">{formatInvoiceMoney(tip)}</strong> tip
                </>
              ) : null}{" "}
              to your income on {formatInvoiceDate(paidDate).replace(/, \d{4}$/, "")}.{" "}
              {remaining > 0 ? (
                <>
                  <strong className="tabular-nums">{formatInvoiceMoney(remaining)}</strong> will still be due.{" "}
                </>
              ) : null}
              If the same money shows up in your bank later, we&apos;ll ask before counting it twice.
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <Button
              type="button"
              variant="outline"
              className="h-[52px] flex-1 rounded-full font-semibold"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-[52px] flex-[2] rounded-full text-base font-semibold"
              disabled={!valid}
              onClick={submit}
            >
              {remaining > 0 ? "Record payment" : "Mark paid"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
