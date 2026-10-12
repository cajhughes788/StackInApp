"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ChevronRight, EyeOff, ReceiptText } from "lucide-react"

import { getPlaidItems } from "@/lib/api/plaidApi"

import PlaidIncomeReviewPanel from "@/components/plaid-income-review-panel"
import PlaidPendingTransactionsPanel from "@/components/plaid-pending-transactions-panel"
import { useReviewCountsStore } from "@/lib/stores/useReviewCountsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useExpensesData } from "@/lib/stores/useExpensesStore"
import { useSettingsData, useSettingsStore } from "@/lib/stores/useSettingsStore"
import * as settingsService from "@/lib/domain/settingsService"
import { useToast } from "@/hooks/use-toast"
import { computeReceiptCoverage } from "@shared/receiptRequirements"

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
  const total = (incomeCount ?? 0) + (expensesCount ?? 0) + missingReceipts

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
    <section aria-labelledby="needs-you-heading" className="space-y-3" hidden={hidden}>
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

      <PlaidIncomeReviewPanel />
      <PlaidPendingTransactionsPanel />

      {missingReceipts > 0 ? (
        <div className="flex items-center rounded-[18px] bg-card border border-card-border hover:bg-muted/40">
        <Link href="/app/receipts" className="flex min-w-0 flex-1 items-center gap-3 p-4 pr-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
            <ReceiptText className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              {coverage.missing === 1 ? "1 expense needs a receipt" : `${coverage.missing} expenses need a receipt`}
            </span>
            <span className="block text-sm text-muted-foreground">Audit-ready {coverage.percent}% this month</span>
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
