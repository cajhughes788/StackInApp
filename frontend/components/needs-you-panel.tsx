"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"

import { getPlaidItems } from "@/lib/api/plaidApi"

import PlaidIncomeReviewPanel from "@/components/plaid-income-review-panel"
import PlaidPendingTransactionsPanel from "@/components/plaid-pending-transactions-panel"
import { useReviewCountsStore } from "@/lib/stores/useReviewCountsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

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
  const total = (incomeCount ?? 0) + (expensesCount ?? 0)
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
