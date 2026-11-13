"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BellOff, FileText, Plus, Settings2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  InvoiceRow,
  InvoicesPage,
  QuoteRow,
  ScheduleRow,
  cardClass,
  localToday,
  useInvoicesWorkspace,
  useQueryParam,
} from "@/components/invoices/invoice-ui"
import ClientList from "@/components/clients/client-list"
import { wakePaymentSetupServer } from "@/lib/api/invoicesApi"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { useWorkspaceQuotes } from "@/lib/stores/useQuotesStore"
import { useWorkspaceInvoiceSchedules } from "@/lib/stores/useInvoiceSchedulesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceBalanceDue, invoiceDueNow, invoicePaymentsReceivedIn } from "@shared/invoicePayments"
import type { InvoiceType } from "@shared/schemas/invoice"

type Filter = "all" | "open" | "overdue" | "paid" | "draft" | "quick" | "quotes" | "repeating"

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "paid", label: "Paid" },
  { id: "draft", label: "Drafts" },
  { id: "quotes", label: "Quotes" },
  { id: "repeating", label: "Repeating" },
  { id: "quick", label: "Quick charges" },
]

function matchesFilter(invoice: InvoiceType, filter: Filter, today: string): boolean {
  // Quick charges (paid at the counter by QR code) have their own filter, so
  // they don't crowd the invoices list.
  if (filter === "quick") return !!invoice.quickCharge
  // Quotes aren't invoices; the Quotes filter lists them instead.
  if (filter === "quotes" || filter === "repeating") return false
  if (invoice.quickCharge) return false
  switch (filter) {
    case "all":
      return true
    case "open":
      return invoice.status === "sent"
    case "overdue": {
      // The deposit's date while one is owed, the invoice's otherwise.
      const dueNow = invoiceDueNow(invoice)
      return invoice.status === "sent" && !!dueNow && dueNow.dueDate < today
    }
    case "paid":
      return invoice.status === "paid"
    case "draft":
      return invoice.status === "draft"
  }
}

type View = "invoices" | "clients"

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "invoices", label: "Invoices" },
  { id: "clients", label: "Clients" },
]

export default function InvoicesListPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoicesListPage />
    </Suspense>
  )
}

function InvoicesListPage() {
  const { ready, workspaceId, invoices, settings, loadStatus } = useInvoicesWorkspace()
  const { quotes } = useWorkspaceQuotes(workspaceId)
  const { schedules } = useWorkspaceInvoiceSchedules(workspaceId)
  // Active first, then paused, then ended; soonest next date first.
  const sortedSchedules = useMemo(
    () => {
      const order = { active: 0, paused: 1, ended: 2 }
      return [...schedules].sort((a, b) => order[a.status] - order[b.status] || a.nextDate.localeCompare(b.nextDate))
    },
    [schedules]
  )
  const router = useRouter()
  const takesPayments = useInvoicesStore((s) => {
    const account = workspaceId ? s.byWorkspaceId[workspaceId]?.paymentAccount : null
    return !!account?.chargesEnabled && !!account.acceptOnline
  })

  // Not taking card payments yet: wake the Stripe setup server, so it's up
  // if they head to Invoice settings to set it up.
  useEffect(() => {
    if (loadStatus === "ready" && !takesPayments) wakePaymentSetupServer()
  }, [loadStatus, takesPayments])
  // ?filter=overdue opens straight on that filter (the Needs you row).
  const filterParam = useQueryParam("filter")
  const [filter, setFilter] = useState<Filter>(() =>
    FILTERS.some((option) => option.id === filterParam) ? (filterParam as Filter) : "all"
  )
  // In the URL, so coming back from a client's page lands on Clients again.
  const view: View = useQueryParam("view") === "clients" ? "clients" : "invoices"
  const today = localToday()

  const summary = useMemo(() => {
    const month = today.slice(0, 7)
    let waiting = 0
    let overdue = 0
    let paidThisMonth = 0
    let paidCount = 0
    for (const invoice of invoices) {
      // Unpaid quick charges aren't money being waited on (see Needs you).
      if (invoice.status === "sent" && !invoice.quickCharge) {
        waiting += invoiceBalanceDue(invoice)
        // What's late: an overdue deposit, or the rest once it's past due.
        const dueNow = invoiceDueNow(invoice)
        if (dueNow && dueNow.dueDate < today) overdue += dueNow.amount
      }
      // Cash basis: money counts in the month it arrived, payment by payment.
      const received = invoicePaymentsReceivedIn(invoice, month)
      if (received.length > 0) {
        paidThisMonth += received.reduce((sum, payment) => sum + payment.amount, 0)
        paidCount += 1
      }
    }
    return { waiting, overdue, paidThisMonth, paidCount }
  }, [invoices, today])

  const visible = invoices.filter((invoice) => matchesFilter(invoice, filter, today))

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading invoices..."
      title="Invoices"
      action={
        <>
        <Link
          href="/app/clients"
          aria-label="Clients"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <Users className="size-5" aria-hidden="true" />
        </Link>
        <Link
          href="/app/invoices/settings"
          aria-label="Invoice settings"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <Settings2 className="size-5" aria-hidden="true" />
        </Link>
        </>
      }
    >
      {loadStatus === "loading" && invoices.length === 0 ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 w-full rounded-[18px]" />
          <Skeleton className="h-64 w-full rounded-[18px]" />
        </div>
      ) : loadStatus === "error" ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>
          Couldn&apos;t load your invoices. Check your connection and try again.
        </div>
      ) : invoices.length === 0 && quotes.length === 0 ? (
        <div className={cn(cardClass, "flex flex-col items-center gap-3 py-10 text-center")}>
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-foreground">
            <FileText className="size-6" aria-hidden="true" />
          </span>
          <div>
            <div className="font-semibold text-foreground">Send your first invoice</div>
            <div className="mx-auto max-w-xs text-sm text-muted-foreground">
              Share it as a link or PDF. When the client pays into your connected bank, 521 matches the deposit for
              you.
            </div>
          </div>
        </div>
      ) : (
        <>
          <section className={cn(cardClass, "grid grid-cols-2 gap-3")}>
            <div>
              <div className="text-sm text-muted-foreground">Waiting on</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(summary.waiting)}
              </div>
              {summary.overdue > 0 ? (
                <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {formatInvoiceMoney(summary.overdue)} overdue
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Nothing overdue</div>
              )}
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Paid this month</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(summary.paidThisMonth)}
              </div>
              <div className="text-sm text-muted-foreground">
                {summary.paidCount} invoice{summary.paidCount === 1 ? "" : "s"}
              </div>
            </div>
          </section>

          <div role="group" aria-label="Show" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {VIEWS.map((option) => {
              const active = view === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    router.replace(option.id === "clients" ? "/app/invoices?view=clients" : "/app/invoices", { scroll: false })
                  }
                  className={cn(
                    "h-9 rounded-full text-sm transition-colors",
                    active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {view === "invoices" ? (
            <>
              <nav aria-label="Filter invoices" className="-mx-4 flex gap-2 overflow-x-scroll px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {FILTERS.map((option) => {
                  const active = filter === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(option.id)}
                      className={cn(
                        "h-9 shrink-0 rounded-full px-3.5 text-sm transition-colors",
                        active
                          ? "bg-foreground font-semibold text-background"
                          : "border border-card-border bg-card text-foreground hover:bg-muted"
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </nav>

              {/* The "several overdue" push opens here; nothing follows up while reminders are off. */}
              {filter === "overdue" && visible.length > 0 && settings && !settings.autoReminders ? (
                <div className="flex items-center gap-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-sm text-foreground">
                  <BellOff className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">Automatic reminders are off. Turn them on and 521 follows up for you.</span>
                  <Button asChild size="sm" variant="outline" className="shrink-0 rounded-full bg-card">
                    <Link href="/app/invoices/settings#auto-reminders">Turn on</Link>
                  </Button>
                </div>
              ) : null}

              {filter === "repeating" ? (
                sortedSchedules.length === 0 ? (
                  <div className={cn(cardClass, "text-sm text-muted-foreground")}>
                    No repeating invoices yet. Turn on Repeat this invoice when you make one, or choose it from an invoice&apos;s ••• menu.
                  </div>
                ) : (
                  <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                    {sortedSchedules.map((schedule) => (
                      <ScheduleRow key={schedule.id} schedule={schedule} />
                    ))}
                  </ul>
                )
              ) : filter === "quotes" ? (
                quotes.length === 0 ? (
                  <div className={cn(cardClass, "text-sm text-muted-foreground")}>
                    No quotes yet. Send a client a price before the job — when they accept, turn it into an invoice in one tap.
                  </div>
                ) : (
                  <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                    {quotes.map((quote) => (
                      <QuoteRow key={quote.id} quote={quote} title={quote.clientName} today={today} />
                    ))}
                  </ul>
                )
              ) : visible.length === 0 ? (
                <div className={cn(cardClass, "text-sm text-muted-foreground")}>
                  {filter === "quick" ? "No quick charges yet. Tap Charge on Home to take a payment on the spot." : "No invoices here."}
                </div>
              ) : (
                <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                  {visible.map((invoice) => (
                    <InvoiceRow key={invoice.id} invoice={invoice} title={invoice.clientName} today={today} />
                  ))}
                </ul>
              )}
            </>
          ) : workspaceId ? (
            <ClientList workspaceId={workspaceId} invoices={invoices} today={today} />
          ) : null}
        </>
      )}

      <div className="sticky bottom-[calc(1rem+var(--safe-area-inset-bottom))] flex gap-2.5 pt-2">
        <Link
          href="/app/invoices/edit"
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm"
        >
          <Plus className="size-5" aria-hidden="true" />
          New invoice
        </Link>
        <Link
          href="/app/invoices/edit?kind=quote"
          className="flex h-[52px] items-center justify-center gap-2 rounded-full border border-card-border bg-card px-5 text-base font-semibold text-foreground shadow-sm"
        >
          <Plus className="size-5" aria-hidden="true" />
          Quote
        </Link>
      </div>
    </InvoicesPage>
  )
}
