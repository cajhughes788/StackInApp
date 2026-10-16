"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { FileText, Plus, Settings2 } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  InvoicesPage,
  InvoiceStatusPill,
  PAID_METHOD_LABELS,
  cardClass,
  localToday,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { InvoiceType } from "@shared/schemas/invoice"

type Filter = "all" | "open" | "overdue" | "paid" | "draft"

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "paid", label: "Paid" },
  { id: "draft", label: "Drafts" },
]

function matchesFilter(invoice: InvoiceType, filter: Filter, today: string): boolean {
  switch (filter) {
    case "all":
      return true
    case "open":
      return invoice.status === "sent"
    case "overdue":
      return invoice.status === "sent" && invoice.dueDate < today
    case "paid":
      return invoice.status === "paid"
    case "draft":
      return invoice.status === "draft"
  }
}

function shortDate(date: string): string {
  return formatInvoiceDate(date).replace(/, \d{4}$/, "")
}

// "#0014 · Sent Sep 28", "#0015 · Paid Oct 9 · bank match"
function rowDetail(invoice: InvoiceType): string {
  const parts = [`#${invoice.number}`]
  if (invoice.status === "draft") parts.push("Not sent")
  else if (invoice.status === "void") parts.push("Voided")
  else if (invoice.status === "paid") {
    if (invoice.paidAt) parts.push(`Paid ${shortDate(invoice.paidAt.slice(0, 10))}`)
    if (invoice.paidVia === "bank_match") parts.push("bank match")
    else if (invoice.paidMethod) parts.push(PAID_METHOD_LABELS[invoice.paidMethod])
  } else parts.push(`Sent ${shortDate((invoice.sharedAt ?? invoice.createdAt).slice(0, 10))}`)
  return parts.join(" · ")
}

export default function InvoicesListPage() {
  const { ready, invoices, loadStatus } = useInvoicesWorkspace()
  const [filter, setFilter] = useState<Filter>("all")
  const today = localToday()

  const summary = useMemo(() => {
    const month = today.slice(0, 7)
    let waiting = 0
    let overdue = 0
    let paidThisMonth = 0
    let paidCount = 0
    for (const invoice of invoices) {
      if (invoice.status === "sent") {
        waiting += invoice.total
        if (invoice.dueDate < today) overdue += invoice.total
      } else if (invoice.status === "paid" && invoice.paidAt?.slice(0, 7) === month) {
        paidThisMonth += invoice.total
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
        <Link
          href="/app/invoices/settings"
          aria-label="Invoice settings"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <Settings2 className="size-5" aria-hidden="true" />
        </Link>
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
      ) : invoices.length === 0 ? (
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

          {visible.length === 0 ? (
            <div className={cn(cardClass, "text-sm text-muted-foreground")}>No invoices here.</div>
          ) : (
            <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
              {visible.map((invoice) => (
                <li key={invoice.id} className="border-b border-border last:border-0">
                  <Link
                    href={`/app/invoices/view?id=${encodeURIComponent(invoice.id)}`}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-foreground">{invoice.clientName}</div>
                      <div className="truncate text-sm text-muted-foreground">{rowDetail(invoice)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={cn(
                          "font-semibold tabular-nums",
                          invoice.status === "draft" || invoice.status === "void"
                            ? "text-muted-foreground"
                            : "text-foreground"
                        )}
                      >
                        {formatInvoiceMoney(invoice.total)}
                      </div>
                      <div className="mt-0.5">
                        <InvoiceStatusPill invoice={invoice} today={today} short />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="sticky bottom-[calc(1rem+var(--safe-area-inset-bottom))] pt-2">
        <Link
          href="/app/invoices/edit"
          className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm"
        >
          <Plus className="size-5" aria-hidden="true" />
          New invoice
        </Link>
      </div>
    </InvoicesPage>
  )
}
