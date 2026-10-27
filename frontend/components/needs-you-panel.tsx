"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, EyeOff, ReceiptText } from "lucide-react"

import { getPlaidItems } from "@/lib/api/plaidApi"

import PlaidIncomeReviewPanel from "@/components/plaid-income-review-panel"
import PlaidPendingTransactionsPanel from "@/components/plaid-pending-transactions-panel"
import { useReviewCountsStore } from "@/lib/stores/useReviewCountsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useExpensesData, useExpensesStore } from "@/lib/stores/useExpensesStore"
import { useExpenseFocusStore } from "@/lib/stores/useExpenseFocusStore"
import { getCalendarMonthBucketAt } from "@shared/payPeriods"
import { useSettingsData, useSettingsStore } from "@/lib/stores/useSettingsStore"
import * as settingsService from "@/lib/domain/settingsService"
import { useToast } from "@/hooks/use-toast"
import { computeReceiptCoverage } from "@shared/receiptRequirements"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { localToday } from "@/components/invoices/invoice-ui"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import { invoiceBalanceDue, invoiceDueNow } from "@shared/invoicePayments"

// One review list for everything the bank sent over: deposits (income) and
// charges and refunds (expenses). Shown on both the Income and Expenses tabs
// of the independent home page. Each panel still loads, decides and bulk-
// selects on its own; this only gives them one heading and one count. The
// counts come from useReviewCountsStore, which each panel reports to once its
// list has loaded.
export default function NeedsYouPanel() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const counts = useReviewCountsStore((s) => (activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined))

  const incomeCount = counts?.income
  const expensesCount = counts?.expenses
  // Expenses over the audit threshold with no receipt, from the month the
  // home page has loaded. Handled on the Receipts page.
  const expenses = useExpensesData(activeWorkspaceId)
  const coverage = useMemo(() => computeReceiptCoverage(expenses), [expenses])
  // The person can hide the missing-receipts item for good (eye-off button
  // below); Settings → Notifications turns it back on.
  const settings = useSettingsData(activeWorkspaceId)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const { toast } = useToast()
  const showMissingReceipts = settings?.independent?.missingReceiptsInNeedsYou !== false
  const missingReceipts = showMissingReceipts ? coverage.missing : 0
  // The month home has loaded — may be a past month picked in the dropdown.
  const expensesMonth = useExpensesStore((s) => (activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId]?.periodId : null)) ?? null
  const isCurrentMonth = !expensesMonth || !settings || expensesMonth === getCalendarMonthBucketAt(settings)
  const monthLabel = isCurrentMonth
    ? "this month"
    : `in ${new Date(`${expensesMonth}-15T12:00:00`).toLocaleDateString("en-US", { month: "long" })}`
  // Open chargebacks have a deadline, so they sit here too (refundsService.ts
  // sets invoice.dispute from Stripe's events).
  const invoices = useInvoicesStore((s) => (activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId]?.invoices : undefined))
  useEffect(() => {
    if (activeWorkspaceId) void useInvoicesStore.getState().load(activeWorkspaceId).catch(() => {})
  }, [activeWorkspaceId])
  const openDisputes = useMemo(
    () => (invoices ?? []).filter((invoice) => invoice.dispute && (invoice.dispute.status === "open" || invoice.dispute.status === "inquiry")),
    [invoices]
  )
  // A client's bank transfer through Stripe bounced: the invoice is open
  // again, and only a push notification said so.
  const failedPayments = useMemo(
    () => (invoices ?? []).filter((invoice) => invoice.status === "sent" && invoice.paymentFailedAt && !invoice.pendingPayment),
    [invoices]
  )
  const today = localToday()
  // A deposit past its due date: whether the booking stands is the user's
  // call (waive it or cancel), so each gets its own row.
  const overdueDeposits = useMemo(
    () =>
      (invoices ?? []).filter((invoice) => {
        const dueNow = invoiceDueNow(invoice)
        return (
          invoice.status === "sent" &&
          dueNow?.purpose === "deposit" &&
          dueNow.dueDate < today &&
          !invoice.pendingPayment &&
          !invoice.paymentFailedAt
        )
      }),
    [invoices, today]
  )
  // Past due and unpaid, as one row — chasing them happens on the Invoices
  // page. A failed payment or an overdue deposit already has its own row.
  const overdue = useMemo(
    () =>
      (invoices ?? []).filter(
        (invoice) =>
          // An unpaid quick charge isn't owed money to chase: it was paid
          // another way or abandoned ("pay later" makes it a real invoice).
          !invoice.quickCharge &&
          invoice.status === "sent" &&
          invoice.dueDate < today &&
          !invoice.pendingPayment &&
          !invoice.paymentFailedAt &&
          invoiceDueNow(invoice)?.purpose !== "deposit"
      ),
    [invoices, today]
  )
  const overdueTotal = overdue.reduce((sum, invoice) => sum + Math.round(invoiceBalanceDue(invoice) * 100), 0) / 100
  const total =
    (incomeCount ?? 0) +
    (expensesCount ?? 0) +
    missingReceipts +
    openDisputes.length +
    failedPayments.length +
    overdueDeposits.length +
    (overdue.length > 0 ? 1 : 0)

  async function hideMissingReceipts() {
    if (!activeWorkspaceId || !settings) return
    setSettings(
      activeWorkspaceId,
      { ...settings, independent: { ...(settings.independent ?? {}), missingReceiptsInNeedsYou: false } },
      { source: "optimistic", localUpdatedAt: Date.now() }
    )
    toast({ title: "Missing receipts hidden", description: "Turn them back on anytime in Settings → Notifications." })
    try {
      const saved = await settingsService.save(activeWorkspaceId, { independent: { missingReceiptsInNeedsYou: false } })
      if (saved.source === "backend" && saved.data) {
        setSettings(activeWorkspaceId, saved.data, {
          source: "backend",
          remoteMeta: saved.remoteMeta,
          lastSuccessfulSyncAt: saved.lastSuccessfulSyncAt,
          localUpdatedAt: saved.localUpdatedAt,
        })
      }
    } catch {
      setSettings(activeWorkspaceId, settings, { source: "optimistic", localUpdatedAt: Date.now() })
      toast({ title: "Couldn't hide missing receipts", description: "Please try again.", variant: "destructive" })
    }
  }
  // Only claim "caught up" once both lists have actually reported.
  const bothLoaded = incomeCount !== undefined && expensesCount !== undefined

  // Without a connected bank there's nothing to be caught up on, so an empty
  // list hides the whole section instead. null = not known yet.
  const [hasBank, setHasBank] = useState<boolean | null>(null)
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    setHasBank(null)
    getPlaidItems(activeWorkspaceId)
      .then((items) => {
        if (!cancelled) setHasBank(items.length > 0)
      })
      .catch(() => {
        // Unknown — fall back to showing the section as before.
        if (!cancelled) setHasBank(true)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  // The panels stay mounted while hidden so they still load and report.
  const hidden = hasBank !== true && total === 0

  return (
    <section aria-labelledby="needs-you-heading" className="space-y-3" hidden={hidden} data-tour="needs-you">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="needs-you-heading" className="text-lg font-semibold text-foreground">
          Needs you
          {total > 0 ? (
            <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-2 align-[3px] text-xs font-semibold tabular-nums text-primary-foreground">
              {total > 99 ? "99+" : total}
            </span>
          ) : null}
        </h2>
        <Link href="/app/banks" className="text-xs font-medium text-primary">
          Manage banks
        </Link>
      </div>

      {openDisputes.map((invoice) => (
        <Link
          key={invoice.id}
          href={`/app/invoices/view?id=${encodeURIComponent(invoice.id)}`}
          className="flex items-center gap-3 rounded-[18px] border border-card-border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{invoice.clientName} disputed a payment</span>
            <span className="block text-sm text-muted-foreground">
              Invoice #{invoice.number}
              {invoice.dispute?.evidenceDueBy
                ? ` · respond by ${new Date(invoice.dispute.evidenceDueBy).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ))}

      {failedPayments.map((invoice) => (
        <Link
          key={invoice.id}
          href={`/app/invoices/view?id=${encodeURIComponent(invoice.id)}`}
          className="flex items-center gap-3 rounded-[18px] border border-card-border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{invoice.clientName}&apos;s bank payment failed</span>
            <span className="block text-sm text-muted-foreground">
              Invoice #{invoice.number} · {formatInvoiceMoney(invoice.total)} is open again
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ))}

      {overdueDeposits.map((invoice) => (
        <Link
          key={invoice.id}
          href={`/app/invoices/view?id=${encodeURIComponent(invoice.id)}`}
          className="flex items-center gap-3 rounded-[18px] border border-card-border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            <Clock className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{invoice.clientName}&apos;s deposit is overdue</span>
            <span className="block text-sm text-muted-foreground">
              Invoice #{invoice.number} · {formatInvoiceMoney(invoiceDueNow(invoice)?.amount ?? 0)} · waive it or cancel
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ))}

      {overdue.length > 0 ? (
        <Link
          href={
            overdue.length === 1
              ? `/app/invoices/view?id=${encodeURIComponent(overdue[0].id)}`
              : "/app/invoices?filter=overdue"
          }
          className="flex items-center gap-3 rounded-[18px] border border-card-border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            <Clock className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              {overdue.length === 1 ? `${overdue[0].clientName}'s invoice is overdue` : `${overdue.length} invoices are overdue`}
            </span>
            <span className="block text-sm text-muted-foreground">
              {overdue.length === 1 ? `Invoice #${overdue[0].number} · ` : ""}
              {formatInvoiceMoney(overdueTotal)} unpaid
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}

      <PlaidIncomeReviewPanel />
      <PlaidPendingTransactionsPanel />

      {missingReceipts > 0 ? (
        <div className="flex items-center rounded-[18px] bg-card border border-card-border hover:bg-muted/40">
        <Link
          href="/app/receipts"
          onClick={() => useExpenseFocusStore.getState().setReceiptsMonth(expensesMonth)}
          className="flex min-w-0 flex-1 items-center gap-3 p-4 pr-2"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
            <ReceiptText className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              {coverage.missing === 1 ? "1 expense needs a receipt" : `${coverage.missing} expenses need a receipt`}
            </span>
            <span className="block text-sm text-muted-foreground">Audit-ready {coverage.percent}% {monthLabel}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => void hideMissingReceipts()}
          aria-label="Stop showing missing receipts here"
          title="Stop showing missing receipts here"
          className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <EyeOff className="size-4" aria-hidden="true" />
        </button>
        </div>
      ) : null}

      {bothLoaded && total === 0 && hasBank ? (
        <div className="flex items-center gap-3 rounded-[18px] bg-card border border-card-border p-4">
          <CheckCircle2 className="size-8 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <div className="font-medium text-foreground">You&apos;re all caught up</div>
            <div className="text-sm text-muted-foreground">New deposits and charges from your bank show up here.</div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
