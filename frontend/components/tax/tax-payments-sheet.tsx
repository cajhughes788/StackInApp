"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { deleteTaxPayment, saveTaxPayment } from "@/lib/api/taxEstimateApi"
import { formatCurrency, getLocalDateInputValue } from "@/lib/helpers"
import type { TaxPayment } from "@shared/schemas/taxEstimateProfile"

// Estimated tax payments the person has sent to the IRS this tax year:
// record one, fix a typo, or remove one. The Taxes card counts them
// against what's due. Paying happens at IRS.gov — never in the app.

export const IRS_PAYMENTS_URL = "https://www.irs.gov/payments"

function formatPaidOn(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function parseAmount(value: string): number | null {
  const n = Number(value.replace(/[$,\s]/g, ""))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export default function TaxPaymentsSheet({
  open,
  onOpenChange,
  taxYear,
  payments,
  yearTarget,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  taxYear: number
  payments: TaxPayment[]
  // Estimated payments needed for the whole year to avoid a penalty
  // (after withholding). Null when last year's tax isn't known.
  yearTarget: number | null
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [paidOn, setPaidOn] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const resetForm = () => {
    setEditingId(null)
    setAmount("")
    setPaidOn(getLocalDateInputValue())
    setError(null)
  }

  useEffect(() => {
    if (open) {
      resetForm()
      setConfirmDeleteId(null)
    }
  }, [open])

  const total = payments.reduce((sum, p) => sum + p.amount, 0)
  // Q4 is paid by Jan 15 of the next year.
  const minDate = `${taxYear}-01-01`
  const maxDate = `${taxYear + 1}-01-31`

  async function save() {
    const value = parseAmount(amount)
    if (value == null) {
      setError("Enter the amount you paid, like 1,250.")
      return
    }
    if (!paidOn || paidOn < minDate || paidOn > maxDate) {
      setError(`Pick the date you paid (between Jan 1, ${taxYear} and Jan 31, ${taxYear + 1}).`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveTaxPayment({ ...(editingId ? { id: editingId } : {}), amount: value, paidOn })
      resetForm()
      onChanged()
    } catch {
      toast({ title: "Couldn't save the payment", description: "Please try again.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    try {
      await deleteTaxPayment(id)
      if (editingId === id) resetForm()
      onChanged()
    } catch {
      toast({ title: "Couldn't remove the payment", description: "Please try again.", variant: "destructive" })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92vh] max-w-lg flex-col gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-3 pt-1">
          <SheetTitle className="text-lg">Tax payments · {taxYear}</SheetTitle>
          <SheetDescription>Record estimated payments you&apos;ve sent to the IRS so we can count them.</SheetDescription>
        </SheetHeader>

        <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1 pb-3">
          <section className="space-y-3 rounded-2xl bg-muted/60 p-4">
            <h3 className="text-sm font-semibold text-foreground">{editingId ? "Edit payment" : "I paid"}</h3>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tax-payment-amount" className="font-normal">Amount</Label>
              <Input id="tax-payment-amount" inputMode="decimal" className="w-36 text-right" placeholder="$0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tax-payment-date" className="font-normal">Date paid</Label>
              <Input id="tax-payment-date" type="date" className="w-44" min={minDate} max={maxDate} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Record payment"}
              </Button>
              {editingId ? (
                <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="tax-payments-history">
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h3 id="tax-payments-history" className="text-sm font-semibold text-foreground">This year</h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatCurrency(total)} paid
                {yearTarget != null && yearTarget > 0 ? ` of about ${formatCurrency(yearTarget)}` : ""}
              </span>
            </div>
            {payments.length === 0 ? (
              <p className="rounded-2xl bg-muted/60 px-4 py-5 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-2xl bg-muted/60 px-4">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium tabular-nums text-foreground">{formatCurrency(payment.amount)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {payment.source === "carried_over" ? "Paid before you started tracking" : formatPaidOn(payment.paidOn)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Edit payment"
                      onClick={() => {
                        setEditingId(payment.id)
                        setAmount(payment.amount.toFixed(2))
                        setPaidOn(payment.paidOn)
                        setError(null)
                      }}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={confirmDeleteId === payment.id ? "Tap again to remove" : "Remove payment"}
                      onClick={() => remove(payment.id)}
                      className={`flex h-8 items-center justify-center rounded-full px-2 text-sm ${
                        confirmDeleteId === payment.id ? "bg-destructive/15 font-medium text-destructive" : "text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}
                    >
                      {confirmDeleteId === payment.id ? "Remove?" : <Trash2 className="size-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <a
          href={IRS_PAYMENTS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-full border border-card-border py-2.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Pay at IRS.gov
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </SheetContent>
    </Sheet>
  )
}
