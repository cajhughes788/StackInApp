"use client"

import { Suspense, useMemo } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  InvoiceRow,
  InvoicesPage,
  cardClass,
  localToday,
  useInvoicesWorkspace,
  useQueryParam,
} from "@/components/invoices/invoice-ui"
import { clientKey, groupInvoicesByClient } from "@/components/invoices/invoice-clients"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"

// One client's totals and every invoice sent to them, newest first.

export default function InvoiceClientPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoiceClientPage />
    </Suspense>
  )
}

function InvoiceClientPage() {
  const { ready, invoices, loadStatus } = useInvoicesWorkspace()
  const name = useQueryParam("name") ?? ""
  const today = localToday()
  const client = useMemo(
    () => groupInvoicesByClient(invoices, today).find((c) => c.key === clientKey(name)) ?? null,
    [invoices, name, today]
  )

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading client..."
      title={client?.name ?? name}
      backHref="/app/invoices?view=clients"
      backLabel="Back to clients"
    >
      {!client ? (
        loadStatus === "loading" ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-28 w-full rounded-[18px]" />
            <Skeleton className="h-64 w-full rounded-[18px]" />
          </div>
        ) : (
          <div className={cn(cardClass, "text-sm text-muted-foreground")}>
            No invoices for this client.{" "}
            <Link href="/app/invoices?view=clients" className="font-medium text-foreground underline">
              Back to clients
            </Link>
          </div>
        )
      ) : (
        <>
          <section className={cn(cardClass, "grid grid-cols-2 gap-3")}>
            <div>
              <div className="text-sm text-muted-foreground">Earned</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(client.earned)}
              </div>
              <div className="text-sm text-muted-foreground">All time</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Open</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(client.open)}
              </div>
              {client.overdue > 0 ? (
                <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {formatInvoiceMoney(client.overdue)} overdue
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Nothing overdue</div>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="px-1 text-sm font-semibold text-muted-foreground">
              {client.invoices.length} invoice{client.invoices.length === 1 ? "" : "s"}
            </h2>
            <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
              {client.invoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  title={formatInvoiceDate(invoice.issueDate)}
                  today={today}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {client ? (
        <div className="sticky bottom-[calc(1rem+var(--safe-area-inset-bottom))] pt-2">
          <Link
            href={`/app/invoices/edit?client=${encodeURIComponent(client.name)}`}
            className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm"
          >
            <Plus className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">New invoice for {client.name}</span>
          </Link>
        </div>
      ) : null}
    </InvoicesPage>
  )
}
