"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { RepeatOptions, newRepeatDraft, repeatEnd, type RepeatDraft } from "@/components/invoices/repeat-options"
import { createInvoiceSchedule } from "@/lib/api/invoiceSchedulesApi"
import { invoiceSaved } from "@/lib/domain/invoiceService"
import { useInvoiceSchedulesStore } from "@/lib/stores/useInvoiceSchedulesStore"
import { localToday } from "@/components/invoices/invoice-ui"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import { scheduleNextDateFrom } from "@shared/invoiceSchedules"
import type { InvoiceType } from "@shared/schemas/invoice"

// "Repeat this invoice" from an invoice already made: it counts as the
// first, and the next comes one period after it (never today or earlier).

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
}

export default function RepeatInvoiceSheet({
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
  const router = useRouter()
  const { toast } = useToast()
  const upsertSchedule = useInvoiceSchedulesStore((state) => state.upsertSchedule)
  const [draft, setDraft] = useState<RepeatDraft>(newRepeatDraft)
  const [busy, setBusy] = useState(false)
  const [showError, setShowError] = useState(false)
  const mutationId = useRef(newMutationId())

  useEffect(() => {
    if (!open) return
    setDraft(newRepeatDraft())
    setShowError(false)
    setBusy(false)
    mutationId.current = newMutationId()
  }, [open])

  // An older invoice's next one comes after today, as the server works it out.
  const nextDate = scheduleNextDateFrom(invoice.issueDate, draft.frequency, localToday(), { includeToday: false })
  const result = repeatEnd(draft, invoice.issueDate, nextDate)

  async function start() {
    if ("error" in result) {
      setShowError(true)
      return
    }
    setBusy(true)
    try {
      const invoiceId = await invoiceSaved(invoice.id)
      const schedule = await createInvoiceSchedule(workspaceId, {
        invoiceId,
        frequency: draft.frequency,
        end: result.end,
        sendMode: draft.sendMode,
        clientMutationId: mutationId.current,
      })
      upsertSchedule(workspaceId, schedule)
      onOpenChange(false)
      router.push(`/app/invoices/repeating?id=${encodeURIComponent(schedule.id)}`)
    } catch (error) {
      setBusy(false)
      toast({ title: "Couldn't set it to repeat", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="mx-auto max-h-[90vh] max-w-lg gap-0 overflow-y-auto rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">Repeat this invoice</SheetTitle>
          <SheetDescription>
            {invoice.clientName} · {formatInvoiceMoney(invoice.total)}. This is the first one; 521 makes the rest with the same lines and terms
            {invoice.deposit ? ", without a deposit" : ""}.
          </SheetDescription>
        </SheetHeader>
        <RepeatOptions
          draft={draft}
          onChange={setDraft}
          firstDate={invoice.issueDate}
          clientHasEmail={!!invoice.clientEmail}
          nextDate={nextDate}
          error={showError && "error" in result ? result.error : null}
        />
        <Button type="button" className="mt-5 h-[52px] w-full rounded-full text-base font-semibold" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting..." : "Start repeating"}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
