"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { Pause, Pencil, Play, Repeat } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { InvoiceRow, InvoicesPage, cardClass, localToday, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { updateInvoiceSchedule } from "@/lib/api/invoiceSchedulesApi"
import { useInvoiceSchedulesStore, useWorkspaceInvoiceSchedules } from "@/lib/stores/useInvoiceSchedulesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney, formatInvoiceQuantity } from "@shared/invoiceDisplay"
import { INVOICE_SCHEDULE_FREQUENCY_LABELS, scheduleEndLabel } from "@shared/invoiceSchedules"

// One repeating invoice: how it repeats, what each one bills, the invoices
// it has made, and Edit / Pause / Resume / Stop (future invoices only).

export default function RepeatingInvoicePageRoute() {
  return (
    <Suspense fallback={null}>
      <RepeatingInvoicePage />
    </Suspense>
  )
}

function RepeatingInvoicePage() {
  const { toast } = useToast()
  const { ready, workspaceId, invoices } = useInvoicesWorkspace()
  const { schedules, status } = useWorkspaceInvoiceSchedules(workspaceId)
  const upsertSchedule = useInvoiceSchedulesStore((state) => state.upsertSchedule)
  const scheduleId = useQueryParam("id")
  const schedule = schedules.find((s) => s.id === scheduleId) ?? null
  const today = localToday()
  const [busy, setBusy] = useState<null | "pause" | "resume" | "stop">(null)
  const [confirmStop, setConfirmStop] = useState(false)

  async function act(action: "pause" | "resume" | "stop") {
    if (!workspaceId || !schedule) return
    setBusy(action)
    try {
      upsertSchedule(workspaceId, await updateInvoiceSchedule(workspaceId, schedule.id, { action }))
      toast({
        title: action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Stopped",
        description:
          action === "pause"
            ? "No invoices are made while it's paused — the dates it misses are skipped."
            : action === "resume"
              ? "It picks up from its next date."
              : "No more invoices will be made. The ones already made stay as they are.",
      })
    } catch (error) {
      toast({ title: "Couldn't update it", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  // Newest first: the ones it made, and the invoice it started from.
  const made = schedule
    ? invoices.filter((invoice) => invoice.scheduleId === schedule.id || invoice.id === schedule.sourceInvoiceId)
    : []

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading repeating invoice..."
      title="Repeating invoice"
      backHref="/app/invoices?filter=repeating"
      backLabel="Repeating invoices"
      action={
        schedule && schedule.status !== "ended" ? (
          <Link
            href={`/app/invoices/edit?schedule=${encodeURIComponent(schedule.id)}`}
            aria-label="Edit"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <Pencil className="size-5" aria-hidden="true" />
          </Link>
        ) : null
      }
    >
      {!schedule ? (
        status === "loading" ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-28 w-full rounded-[18px]" />
            <Skeleton className="h-64 w-full rounded-[18px]" />
          </div>
        ) : (
          <div className={cn(cardClass, "text-sm text-muted-foreground")}>This repeating invoice wasn&apos;t found.</div>
        )
      ) : (
        <>
          <section className={cn(cardClass, "space-y-1")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-foreground">{schedule.clientName}</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">{formatInvoiceMoney(schedule.total)}</div>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  schedule.status === "active" ? "bg-accent text-emerald-800 dark:text-emerald-300" : "bg-secondary text-muted-foreground"
                )}
              >
                <Repeat className="size-3" aria-hidden="true" />
                {schedule.status === "active" ? INVOICE_SCHEDULE_FREQUENCY_LABELS[schedule.frequency] : schedule.status === "paused" ? "Paused" : "Ended"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Next invoice</dt>
                <dd className="font-medium text-foreground">
                  {schedule.status === "active" ? formatInvoiceDate(schedule.nextDate) : schedule.status === "paused" ? "Paused" : "None"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Made so far</dt>
                <dd className="font-medium tabular-nums text-foreground">{schedule.invoicesMade}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ends</dt>
                <dd className="font-medium text-foreground">{scheduleEndLabel(schedule.end, formatInvoiceDate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Each one is</dt>
                <dd className="font-medium text-foreground">
                  {schedule.sendMode === "email" ? (schedule.clientEmail ? "Emailed automatically" : "Saved as a draft (no email)") : "Saved as a draft"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-medium text-foreground">
                  {schedule.dueInDays === 0 ? "On receipt" : `${schedule.dueInDays} days after each invoice's date`}
                </dd>
              </div>
            </dl>
          </section>

          {schedule.status !== "ended" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-[52px] rounded-full border-card-border bg-card font-semibold"
                disabled={busy !== null}
                onClick={() => void act(schedule.status === "paused" ? "resume" : "pause")}
              >
                {schedule.status === "paused" ? <Play className="size-[18px]" aria-hidden="true" /> : <Pause className="size-[18px]" aria-hidden="true" />}
                {busy === "pause" ? "Pausing..." : busy === "resume" ? "Resuming..." : schedule.status === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-[52px] rounded-full border-card-border bg-card font-semibold text-destructive"
                disabled={busy !== null}
                onClick={() => setConfirmStop(true)}
              >
                {busy === "stop" ? "Stopping..." : "Stop"}
              </Button>
            </div>
          ) : null}

          <section className={cn(cardClass, "space-y-2 text-sm")}>
            <h2 className="font-semibold text-muted-foreground">Each invoice bills</h2>
            {schedule.lines.map((line, index) => (
              <div key={index} className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
                <span className="min-w-0 break-words text-foreground">
                  {line.description}
                  {line.quantity !== 1 ? (
                    <span className="block tabular-nums text-muted-foreground">
                      {formatInvoiceQuantity(line.quantity)} × {formatInvoiceMoney(line.rate)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">{formatInvoiceMoney(line.amount)}</span>
              </div>
            ))}
          </section>

          {made.length > 0 ? (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-semibold text-muted-foreground">Invoices made</h2>
              <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                {made.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} title={formatInvoiceDate(invoice.issueDate)} today={today} />
                ))}
              </ul>
            </section>
          ) : null}

          <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop repeating this invoice?</AlertDialogTitle>
                <AlertDialogDescription>
                  No more invoices will be made for {schedule.clientName}. The ones already made stay as they are. To bill them again on a
                  schedule later, repeat one of their invoices.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => void act("stop")}>Stop</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </InvoicesPage>
  )
}
