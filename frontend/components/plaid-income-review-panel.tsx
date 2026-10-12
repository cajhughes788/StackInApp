"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronDown, ChevronUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/helpers"
import { breakdownCategories, categoryLabels } from "@/lib/incomeBreakdown"
import { resolvePlaidDisplayName, suggestPayerName, suggestPlaidIncomePaymentMethod } from "@shared/plaidClassification"
import type { IncomeCategory, PaymentMethod } from "@shared/schemas/entry"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import IncomeNameInput from "@/components/income-name-input"
import { canonicalIncomeName, getSavedIncomeNames, saveNewIncomeNames } from "@/lib/incomeNames"
import {
  confirmPlaidPendingTransaction,
  getPlaidPendingTransactions,
  updatePlaidIncomeMemory,
  type PlaidPendingTransaction,
  type PlaidPersonalSuggestion,
} from "@/lib/api/plaidApi"
import { useToast } from "@/hooks/use-toast"
import { useReviewRequestNonce } from "@/lib/push/deepLinkStore"
import { useReviewCountsStore } from "@/lib/stores/useReviewCountsStore"

// The Income-tab counterpart of plaid-pending-transactions-panel.tsx: bank
// deposits (Plaid direction "income") land here instead of the expense
// review. Confirming books an income entry server-side (see
// confirmIncomeTransaction in plaidService.ts); dismissing covers transfers
// between the user's own accounts, refunds, and personal money.

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  venmo: "Venmo",
  zelle: "Zelle",
  apple_cash: "Apple Pay",
  pos: "Card / POS sales",
  card: "Card",
  cash: "Cash",
  other: "Other",
}
// No separate "Card": card money belongs under Card / POS everywhere (the
// entries grid and Payment streams fold "card" into it), so offering both
// would only split the same money across two choices.
const PAYMENT_METHODS: PaymentMethod[] = ["venmo", "zelle", "apple_cash", "pos", "cash", "other"]
const DEFAULT_INCOME_CATEGORY: IncomeCategory = "services"

// Same skeleton-flash guard as the expense panel, under its own key so the
// two panels don't read each other's state.
const HAD_PENDING_KEY_PREFIX = "trackd:plaid-income-review:had-pending:"

function readHadPending(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(HAD_PENDING_KEY_PREFIX + workspaceId) === "1"
  } catch {
    return false
  }
}

function writeHadPending(workspaceId: string, hadPending: boolean) {
  try {
    if (hadPending) window.localStorage.setItem(HAD_PENDING_KEY_PREFIX + workspaceId, "1")
    else window.localStorage.removeItem(HAD_PENDING_KEY_PREFIX + workspaceId)
  } catch {
    // storage unavailable — non-fatal
  }
}

const AUTO_COLLAPSE_THRESHOLD = 5
const BULK_CONCURRENCY = 5


async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function runNext(): Promise<void> {
    const current = index++
    if (current >= items.length) return
    await worker(items[current])
    return runNext()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
}

// incomeLabel: "Who paid you?" — only used when paymentMethod is "other".
type RowChoice = { incomeCategory: IncomeCategory; paymentMethod: PaymentMethod; incomeLabel: string }

// Pre-filled from the payer's income memory when the backend found one
// (see PlaidIncomeMemorySchema); older records fall back to a guess.
function defaultChoice(transaction: PlaidPendingTransaction): RowChoice {
  const suggested =
    transaction.suggestedPaymentMethod ?? suggestPlaidIncomePaymentMethod(transaction.merchantName, transaction.rawName)
  return {
    incomeCategory: transaction.suggestedIncomeCategory ?? DEFAULT_INCOME_CATEGORY,
    // A payer remembered as "Card" before that option was folded into
    // Card / POS would otherwise pre-fill a choice the menu no longer has.
    paymentMethod: suggested === "card" ? "pos" : suggested,
    incomeLabel:
      transaction.suggestedIncomeLabel ?? suggestPayerName(transaction.merchantName, transaction.rawName) ?? "",
  }
}

function IncomeReviewCard({
  transaction,
  choice,
  savedNames,
  isSelected,
  onToggleSelected,
  onChoiceChange,
  onConfirm,
  onDismiss,
}: {
  transaction: PlaidPendingTransaction
  choice: RowChoice
  savedNames: string[]
  isSelected: boolean
  onToggleSelected: () => void
  onChoiceChange: (patch: Partial<RowChoice>) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const displayName = resolvePlaidDisplayName(transaction.merchantName, transaction.rawName)

  return (
    <div className="space-y-3 rounded-[18px] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0 + break-words: a long unbroken bank descriptor must wrap
            instead of pushing the amount off-screen and making the page
            scroll sideways. */}
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            className="mt-1"
            checked={isSelected}
            onCheckedChange={onToggleSelected}
            aria-label={`Select ${displayName}`}
          />
          <div className="min-w-0">
            <div className="font-medium break-words">{displayName}</div>
            <div className="text-sm text-muted-foreground">{transaction.date}</div>
            {transaction.suggestedIncomeCategory ? (
              <div className="text-xs text-muted-foreground">Remembered from last time</div>
            ) : null}
            {transaction.isVenmoCashout ? (
              // Shown only when the workspace doesn't import Venmo statements
              // yet — once it does, cash-outs are hidden as transfers instead.
              <div className="text-xs text-muted-foreground">
                Venmo cash-out. If you&apos;ll import your Venmo statement, choose Not income so it isn&apos;t counted
                twice.
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{formatCurrency(transaction.amount)}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select
          value={choice.incomeCategory}
          onValueChange={(value) => onChoiceChange({ incomeCategory: value as IncomeCategory })}
        >
          <SelectTrigger aria-label="Income category" className="w-full rounded-xl border-0 bg-muted shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {breakdownCategories.map((category) => (
              <SelectItem key={category} value={category}>
                {categoryLabels[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={choice.paymentMethod}
          onValueChange={(value) => onChoiceChange({ paymentMethod: value as PaymentMethod })}
        >
          <SelectTrigger aria-label="Paid via" className="w-full rounded-xl border-0 bg-muted shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((method) => (
              <SelectItem key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* For taxes, who paid you matters more than how — it's what 1099s
          are checked against — so "Other" money gets a name. */}
      {choice.paymentMethod === "other" ? (
        <IncomeNameInput
          value={choice.incomeLabel}
          onChange={(incomeLabel) => onChoiceChange({ incomeLabel })}
          savedNames={savedNames}
          aria-label="Who paid you?"
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="rounded-full px-4 font-semibold" onClick={onConfirm}>
          <Check className="h-4 w-4" /> It&apos;s income
        </Button>
        <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" onClick={onDismiss}>
          Not income
        </Button>
      </div>
    </div>
  )
}

export default function PlaidIncomeReviewPanel() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const settings = useSettingsStore((state) => (activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId]?.data : null))
  const savedNames = getSavedIncomeNames(settings)

  const { toast } = useToast()
  const [transactions, setTransactions] = useState<PlaidPendingTransaction[]>([])
  const [choices, setChoices] = useState<Record<string, RowChoice>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [expectsPending, setExpectsPending] = useState(false)
  const [isBulkWorking, setIsBulkWorking] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [notIncomePrompt, setNotIncomePrompt] = useState<PlaidPersonalSuggestion | null>(null)
  // Set by a notification tap (see the review-request effect below) so the
  // list it brought the user to never auto-collapses.
  const didAutoCollapseRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollAfterLoadRef = useRef(false)
  const handledReviewNonceRef = useRef<number | null>(null)
  const reviewRequestNonce = useReviewRequestNonce("income", activeWorkspaceId)
  const loadedWorkspaceIdRef = useRef<string | null>(null)
  // Guards against a superseded request (e.g. after a workspace switch)
  // resolving late and clobbering the current list — see the expense panel.
  const activeRequestIdRef = useRef(0)

  const loadTransactions = useCallback(async () => {
    if (!activeWorkspaceId) return
    const requestId = ++activeRequestIdRef.current
    loadedWorkspaceIdRef.current = null
    setTransactions([])
    setSelectedIds(new Set())
    setExpectsPending(readHadPending(activeWorkspaceId))
    setIsLoading(true)
    try {
      const results = (await getPlaidPendingTransactions(activeWorkspaceId)).filter(
        // Refunds are money in too, but they're reviewed with expenses.
        (transaction) => transaction.direction === "income" && !transaction.isRefund
      )
      if (activeRequestIdRef.current !== requestId) return
      loadedWorkspaceIdRef.current = activeWorkspaceId
      setTransactions(results)
      if (!didAutoCollapseRef.current && results.length > AUTO_COLLAPSE_THRESHOLD) {
        setCollapsed(true)
        didAutoCollapseRef.current = true
      }
    } catch {
      if (activeRequestIdRef.current === requestId) {
        toast({ title: "Couldn't load bank deposits", variant: "destructive" })
      }
    } finally {
      if (activeRequestIdRef.current === requestId) setIsLoading(false)
    }
  }, [activeWorkspaceId, toast])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  // A notification tap for this list (deepLinkStore.ts): re-fetch — the app
  // may have been open since before the new transactions arrived — expand,
  // and scroll to it once loaded. Declared after the mount load so, on a
  // cold start, this request supersedes that one (activeRequestIdRef).
  useEffect(() => {
    if (reviewRequestNonce == null || handledReviewNonceRef.current === reviewRequestNonce) return
    handledReviewNonceRef.current = reviewRequestNonce
    didAutoCollapseRef.current = true
    scrollAfterLoadRef.current = true
    setCollapsed(false)
    void loadTransactions()
  }, [reviewRequestNonce, loadTransactions])

  useEffect(() => {
    if (!scrollAfterLoadRef.current || isLoading) return
    scrollAfterLoadRef.current = false
    if (transactions.length > 0) {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [isLoading, transactions.length])

  useEffect(() => {
    if (activeWorkspaceId && loadedWorkspaceIdRef.current === activeWorkspaceId) {
      writeHadPending(activeWorkspaceId, transactions.length > 0)
      // Badges the home page's Income tab (useReviewCountsStore).
      useReviewCountsStore.getState().setCount(activeWorkspaceId, "income", transactions.length)
    }
  }, [activeWorkspaceId, transactions])

  function choiceFor(transaction: PlaidPendingTransaction): RowChoice {
    return choices[transaction.id] ?? defaultChoice(transaction)
  }

  // The entry is created server-side, so the local entries store doesn't
  // know about it — re-fetch whichever period the Income tab is showing.
  function refreshVisibleEntries(workspaceId: string) {
    const store = useEntriesStore.getState()
    const periodId = store.byWorkspaceId[workspaceId]?.periodId
    if (periodId) void store.refreshFromBackend(workspaceId, periodId, { force: true }).catch(() => {})
  }

  // Returns the name used, if any, so callers can add new names to the shared
  // list once the deposit is actually booked.
  async function submitDecision(workspaceId: string, transaction: PlaidPendingTransaction, isIncome: boolean) {
    const choice = choiceFor(transaction)
    const incomeLabel =
      isIncome && choice.paymentMethod === "other" ? canonicalIncomeName(choice.incomeLabel, savedNames) : ""
    const result = await confirmPlaidPendingTransaction(workspaceId, transaction.id, {
      isBusiness: isIncome,
      ...(isIncome
        ? { incomeCategory: choice.incomeCategory, paymentMethod: choice.paymentMethod, ...(incomeLabel ? { incomeLabel } : {}) }
        : {}),
    })
    return { result, incomeLabel }
  }

  async function handleDecision(transaction: PlaidPendingTransaction, isIncome: boolean) {
    if (!activeWorkspaceId) return
    const workspaceId = activeWorkspaceId
    const previousTransactions = transactions
    // Optimistic — drop the row now, restore it in place if the call fails.
    setTransactions((prev) => prev.filter((t) => t.id !== transaction.id))
    setSelectedIds((prev) => {
      if (!prev.has(transaction.id)) return prev
      const next = new Set(prev)
      next.delete(transaction.id)
      return next
    })
    try {
      const { result, incomeLabel } = await submitDecision(workspaceId, transaction, isIncome)
      if (isIncome) refreshVisibleEntries(workspaceId)
      if (incomeLabel) void saveNewIncomeNames(workspaceId, [incomeLabel])
      // Only offered from single-row dismissals, like the expense panel's
      // personalSuggestion — a bulk run would stack one dialog per payer.
      if (result.notIncomeSuggestion) setNotIncomePrompt(result.notIncomeSuggestion)
    } catch {
      setTransactions((prev) => {
        if (prev.some((p) => p.id === transaction.id)) return prev
        const originalIndex = previousTransactions.findIndex((t) => t.id === transaction.id)
        const laterIds = new Set(previousTransactions.slice(originalIndex + 1).map((t) => t.id))
        const insertAt = prev.findIndex((p) => laterIds.has(p.id))
        const next = [...prev]
        next.splice(insertAt === -1 ? next.length : insertAt, 0, transaction)
        return next
      })
      toast({ title: "Couldn't save your decision — restored to your review list", variant: "destructive" })
    }
  }

  async function handleBulkDecision(isIncome: boolean) {
    if (!activeWorkspaceId || selectedIds.size === 0) return
    const workspaceId = activeWorkspaceId
    const targets = transactions.filter((t) => selectedIds.has(t.id))
    const targetIds = new Set(targets.map((t) => t.id))
    setTransactions((prev) => prev.filter((t) => !targetIds.has(t.id)))
    setSelectedIds(new Set())
    setIsBulkWorking(true)

    const failed: PlaidPendingTransaction[] = []
    const usedNames: string[] = []
    await runWithConcurrency(targets, BULK_CONCURRENCY, async (transaction) => {
      try {
        const { incomeLabel } = await submitDecision(workspaceId, transaction, isIncome)
        if (incomeLabel) usedNames.push(incomeLabel)
      } catch {
        failed.push(transaction)
      }
    })
    // Once for the whole batch — saving per row would race on the same list.
    if (usedNames.length > 0) void saveNewIncomeNames(workspaceId, usedNames)

    setIsBulkWorking(false)
    if (failed.length > 0) {
      setTransactions((prev) => [...prev, ...failed.filter((t) => !prev.some((p) => p.id === t.id))])
      setSelectedIds(new Set(failed.map((t) => t.id)))
    }
    if (isIncome && failed.length < targets.length) refreshVisibleEntries(workspaceId)

    const succeededCount = targets.length - failed.length
    toast({
      title:
        failed.length === 0
          ? isIncome
            ? `Added ${targets.length} to income`
            : `Dismissed ${targets.length}`
          : `${isIncome ? "Added" : "Dismissed"} ${succeededCount} of ${targets.length} — ${failed.length} failed and are back in your review list`,
      variant: failed.length > 0 ? "destructive" : undefined,
    })
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!activeWorkspaceId) return null
  if (transactions.length === 0 && !(isLoading && expectsPending)) return null

  return (
    <div ref={containerRef} className="space-y-3 scroll-mt-4">
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center justify-between px-1 text-sm font-medium text-muted-foreground"
        aria-expanded={!collapsed}
      >
        <span>Deposits{transactions.length ? ` · ${transactions.length}` : ""}</span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && isLoading && transactions.length === 0 ? (
        // Only reached for a workspace that had deposits to review last time
        // (expectsPending) — see the early return above.
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-[18px] bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {!collapsed && transactions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <Checkbox
              checked={selectedIds.size === transactions.length}
              onCheckedChange={() =>
                setSelectedIds((prev) =>
                  prev.size === transactions.length ? new Set() : new Set(transactions.map((t) => t.id))
                )
              }
              aria-label="Select all"
            />
            Select all
          </label>
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-card p-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button type="button" size="sm" disabled={isBulkWorking} onClick={() => void handleBulkDecision(true)}>
            <Check className="h-4 w-4 mr-1" /> Add as income
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBulkWorking}
            onClick={() => void handleBulkDecision(false)}
          >
            <X className="h-4 w-4 mr-1" /> Not income
          </Button>
        </div>
      ) : null}

      {!collapsed &&
        transactions.map((transaction) => (
          <IncomeReviewCard
            key={transaction.id}
            transaction={transaction}
            choice={choiceFor(transaction)}
            savedNames={savedNames}
            isSelected={selectedIds.has(transaction.id)}
            onToggleSelected={() => toggleSelected(transaction.id)}
            onChoiceChange={(patch) =>
              setChoices((prev) => ({ ...prev, [transaction.id]: { ...choiceFor(transaction), ...patch } }))
            }
            onConfirm={() => void handleDecision(transaction, true)}
            onDismiss={() => void handleDecision(transaction, false)}
          />
        ))}

      <AlertDialog open={notIncomePrompt != null} onOpenChange={(open) => !open && setNotIncomePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              You&apos;ve marked deposits from {notIncomePrompt?.displayName} as not income{" "}
              {notIncomePrompt?.dismissCount} times. Stop asking about this payer?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Future deposits from them won&apos;t notify you or show up here. They&apos;re still recorded, and you
              can undo this from Bank connections &rarr; Learned merchants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep asking</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const suggestion = notIncomePrompt
                setNotIncomePrompt(null)
                if (!activeWorkspaceId || !suggestion) return
                updatePlaidIncomeMemory(activeWorkspaceId, suggestion.merchantKey, {
                  mode: "always_not_income",
                }).catch(() => {
                  toast({ title: "Couldn't update this payer", variant: "destructive" })
                })
              }}
            >
              Yes, stop asking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
