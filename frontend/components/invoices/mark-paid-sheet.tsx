"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { InvoicePaidMethod, InvoiceType } from "@shared/schemas/invoice"

// "Card" books under Card / POS, where the rest of the app keeps card money.
const METHODS: Array<{ value: InvoicePaidMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "check", label: "Check" },
  { value: "pos", label: "Card" },
  { value: "other", label: "Other" },
]

export default function MarkPaidSheet({
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
  const today = localToday()
  const [paidDate, setPaidDate] = useState(today)
  const [method, setMethod] = useState<InvoicePaidMethod | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setPaidDate(localToday())
      setMethod(null)
      setSaving(false)
    }
  }, [open])

  async function submit() {
    if (!method) return
    setSaving(true)
    try {
      const { invoice: paid } = await updateInvoiceStatus(workspaceId, invoice.id, {
        action: "mark_paid",
        paidDate,
        paymentMethod: method,
      })
      upsertInvoice(workspaceId, paid)
      // The income entry was booked server-side; refresh whatever period the
      // home page has loaded.
      const entries = useEntriesStore.getState()
      const periodId = entries.byWorkspaceId[workspaceId]?.periodId
      if (periodId) void entries.refreshFromBackend(workspaceId, periodId, { force: true }).catch(() => {})
      toast({ title: `Invoice #${invoice.number} paid`, description: `${formatInvoiceMoney(invoice.total)} added to your income.` })
      onOpenChange(false)
    } catch (error) {
      toast({
        title: "Couldn't mark it paid",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">Mark #{invoice.number} as paid</SheetTitle>
          <SheetDescription>
            {invoice.clientName} · <span className="tabular-nums">{formatInvoiceMoney(invoice.total)}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
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

          <p className="rounded-[14px] bg-muted px-3.5 py-3 text-sm leading-relaxed text-foreground">
            Adds <strong className="tabular-nums">{formatInvoiceMoney(invoice.total)}</strong> to your income on{" "}
            {formatInvoiceDate(paidDate).replace(/, \d{4}$/, "")}. If the same money shows up in your bank later,
            we&apos;ll ask before counting it twice.
          </p>

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
              disabled={!method || saving}
              onClick={() => void submit()}
            >
              {saving ? "Saving..." : "Mark paid"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
