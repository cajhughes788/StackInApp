"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, ChevronUp, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import ReceiptCaptureField from "@/components/receipt-capture-field"
import { useReceiptCapture } from "@/hooks/use-receipt-capture"
import { getVisibleExpenseCategoryOptions } from "@/lib/expenseCategories"
import { formatCurrency } from "@/lib/helpers"
import { getDefaultVehicleExpenseMode, isVehicleTransportationCategory } from "@shared/vehicleExpenses"
import { RECEIPT_REQUIRED_THRESHOLD } from "@shared/receiptRequirements"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import {
  confirmPlaidPendingTransaction,
  getPlaidPendingTransactions,
  linkPlaidMerchantToRecurringRule,
  type PlaidPendingTransaction,
  type PlaidRecurringSuggestion,
} from "@/lib/api/plaidApi"
import { createRecurringRule } from "@/lib/domain/recurringRulesService"
import { cadenceLabel } from "@shared/recurringSchedule"
import { useToast } from "@/hooks/use-toast"

// Above this count the review list defaults to collapsed (once, on first
// load) so a bulk import doesn't bury the manual add-expense form below it —
// unless the user arrived via a "new transactions to review" push
// notification tap (registerPush.ts's deep link), in which case staying
// collapsed would defeat the point of tapping the notification at all.
const AUTO_COLLAPSE_THRESHOLD = 5

function arrivedViaReviewDeepLink(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("openReview") === "1"
}

// Bulk confirm/dismiss reuses the single-transaction endpoint per item
// (inherits dedup/category-normalization/merchant-memory for free) rather
// than a batch endpoint, so failures are per-row instead of all-or-nothing.
const BULK_CONCURRENCY = 5

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  async function runNext(): Promise<void> {
    const current = index++
    if (current >= items.length) return
    await worker(items[current])
    return runNext()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
}

export default function PlaidPendingTransactionsPanel() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const settingsEntry = useSettingsStore((state) =>
    activeWorkspaceId ? state.byWorkspaceId[activeWorkspaceId] : undefined
  )
  const expenseCategoryOptions = useMemo(
    () =>
      getVisibleExpenseCategoryOptions(
        settingsEntry?.data?.independent?.customExpenseCategories ?? [],
        {
          workspaceType: activeWorkspace?.type ?? null,
          independentSettings: settingsEntry?.data?.independent ?? null,
        }
      ),
    [activeWorkspace?.type, settingsEntry?.data?.independent]
  )
  // Whether this workspace's default vehicle-expense method is standard
  // mileage — if so, a Plaid-detected fuel purchase is already baked into
  // that per-mile rate, so confirming it as its own expense would double it.
  const usesStandardMileage =
    getDefaultVehicleExpenseMode(settingsEntry?.data?.independent ?? null) === "mileage"

  const { toast } = useToast()
  const [transactions, setTransactions] = useState<PlaidPendingTransaction[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<Record<string, string>>({})
  const [dismissPrompt, setDismissPrompt] = useState<PlaidPendingTransaction | null>(null)
  const [fuelWarningPrompt, setFuelWarningPrompt] = useState<PlaidPendingTransaction | null>(null)
  const [receiptPrompt, setReceiptPrompt] = useState<PlaidPendingTransaction | null>(null)
  const [recurringPrompt, setRecurringPrompt] = useState<PlaidRecurringSuggestion | null>(null)
  const [isSettingUpRecurring, setIsSettingUpRecurring] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [receiptRowId, setReceiptRowId] = useState<string | null>(null)
  const didAutoCollapseRef = useRef(arrivedViaReviewDeepLink())
  const receiptCapture = useReceiptCapture(activeWorkspaceId)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState<string>("")
  const [isBulkWorking, setIsBulkWorking] = useState(false)

  const loadTransactions = useCallback(async () => {
    if (!activeWorkspaceId) return
    setIsLoading(true)
    try {
      const results = await getPlaidPendingTransactions(activeWorkspaceId)
      setTransactions(results)
      setSelectedIds(new Set())
      if (!didAutoCollapseRef.current && results.length > AUTO_COLLAPSE_THRESHOLD) {
        setCollapsed(true)
        didAutoCollapseRef.current = true
      }
    } catch {
      toast({ title: "Couldn't load bank transactions", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspaceId, toast])

  // Groups with 2+ transactions sharing a suggested category, for the
  // "select all in [category]" quick-select chips.
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const transaction of transactions) {
      if (!transaction.suggestedExpenseAccount) continue
      const ids = groups.get(transaction.suggestedExpenseAccount) ?? []
      ids.push(transaction.id)
      groups.set(transaction.suggestedExpenseAccount, ids)
    }
    for (const [category, ids] of groups) {
      if (ids.length < 2) groups.delete(category)
    }
    return groups
  }, [transactions])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroupSelected(ids: string[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === transactions.length ? new Set() : new Set(transactions.map((t) => t.id))
    )
  }

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  function closeReceiptRow() {
    setReceiptRowId(null)
    receiptCapture.clearAttachedReceipt()
  }

  async function handleSetUpRecurring(suggestion: PlaidRecurringSuggestion) {
    if (!activeWorkspaceId) return
    setIsSettingUpRecurring(true)
    try {
      await createRecurringRule(activeWorkspaceId, {
        type: "expense",
        cadence: suggestion.cadence,
        anchorDate: suggestion.anchorDate,
        notes: "",
        expenseTemplate: {
          amount: suggestion.amount,
          vendor: suggestion.vendor,
          description: suggestion.vendor,
          account: suggestion.account,
        },
      })
      // Best-effort — if this fails, the rule still exists; the merchant
      // just won't auto-suppress and the user may see this suggestion again
      // (a re-ask, not a duplicate charge, so failing quietly here is fine).
      await linkPlaidMerchantToRecurringRule(activeWorkspaceId, suggestion.merchantKey).catch(() => {})
      toast({ title: "Recurring rule created", description: `${suggestion.vendor} will be added automatically from now on.` })
    } catch {
      toast({ title: "Couldn't create the recurring rule", variant: "destructive" })
    } finally {
      setIsSettingUpRecurring(false)
      setRecurringPrompt(null)
    }
  }

  function handleConfirmClick(transaction: PlaidPendingTransaction) {
    const account = selectedAccount[transaction.id] ?? transaction.suggestedExpenseAccount ?? undefined
    if (
      transaction.isLikelyFuelPurchase &&
      usesStandardMileage &&
      account &&
      isVehicleTransportationCategory(account)
    ) {
      setFuelWarningPrompt(transaction)
      return
    }
    const hasReceipt = receiptRowId === transaction.id && receiptCapture.attachedReceiptAsset != null
    if (transaction.amount > RECEIPT_REQUIRED_THRESHOLD && !hasReceipt) {
      setReceiptPrompt(transaction)
      return
    }
    void handleDecision(transaction, true)
  }

  async function handleDecision(
    transaction: PlaidPendingTransaction,
    isBusiness: boolean,
    alwaysPersonal?: boolean
  ) {
    if (!activeWorkspaceId) return
    const account = selectedAccount[transaction.id] ?? transaction.suggestedExpenseAccount ?? undefined
    if (isBusiness && !account) {
      toast({ title: "Choose an expense category first", variant: "destructive" })
      return
    }
    const receiptAssetId =
      receiptRowId === transaction.id ? receiptCapture.attachedReceiptAsset?.id : undefined

    // Optimistic — drop the row immediately instead of waiting on the round
    // trip, and put it back if the confirm/dismiss call actually fails.
    const previousTransactions = transactions
    setTransactions((prev) => prev.filter((t) => t.id !== transaction.id))
    setSelectedIds((prev) => {
      if (!prev.has(transaction.id)) return prev
      const next = new Set(prev)
      next.delete(transaction.id)
      return next
    })
    if (receiptRowId === transaction.id) closeReceiptRow()

    try {
      const result = await confirmPlaidPendingTransaction(activeWorkspaceId, transaction.id, {
        isBusiness,
        account,
        alwaysPersonal,
        receiptAssetId,
      })
      if (result.recurringSuggestion) setRecurringPrompt(result.recurringSuggestion)
      toast({
        title: isBusiness
          ? "Added to expenses"
          : alwaysPersonal
            ? `Dismissed — won't notify you about ${transaction.merchantName ?? transaction.rawName} again`
            : "Dismissed",
      })
    } catch {
      setTransactions(previousTransactions)
      toast({ title: "Couldn't save your decision — restored to your review list", variant: "destructive" })
    }
  }

  async function handleBulkDecision(isBusiness: boolean) {
    if (!activeWorkspaceId || selectedIds.size === 0) return
    if (isBusiness && !bulkCategory) {
      toast({ title: "Choose an expense category first", variant: "destructive" })
      return
    }
    const targets = transactions.filter((t) => selectedIds.has(t.id))
    const targetIds = new Set(targets.map((t) => t.id))

    // Optimistic, same as the single-row path — clear the selection and drop
    // the rows immediately, then restore whichever ones actually failed.
    setTransactions((prev) => prev.filter((t) => !targetIds.has(t.id)))
    setSelectedIds(new Set())
    setBulkCategory("")
    setIsBulkWorking(true)

    const failed: PlaidPendingTransaction[] = []
    await runWithConcurrency(targets, BULK_CONCURRENCY, async (transaction) => {
      try {
        await confirmPlaidPendingTransaction(activeWorkspaceId, transaction.id, {
          isBusiness,
          account: isBusiness ? bulkCategory : undefined,
          alwaysPersonal: false,
        })
      } catch {
        failed.push(transaction)
      }
    })

    setIsBulkWorking(false)
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id))
      setTransactions((prev) => [...prev, ...failed.filter((t) => !prev.some((p) => p.id === t.id))])
      setSelectedIds(new Set(failedIds))
    }

    const succeededCount = targets.length - failed.length
    toast({
      title:
        failed.length === 0
          ? isBusiness
            ? `Added ${targets.length} to expenses`
            : `Dismissed ${targets.length}`
          : `${isBusiness ? "Added" : "Dismissed"} ${succeededCount} of ${targets.length} — ${failed.length} failed and are back in your review list`,
      variant: failed.length > 0 ? "destructive" : undefined,
    })
  }

  if (!activeWorkspaceId) return null
  if (!isLoading && transactions.length === 0) return null

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center justify-between rounded-lg border border-muted bg-card px-3 py-2 text-sm font-medium"
      >
        <span>
          Bank transactions to review{transactions.length ? ` (${transactions.length})` : ""}
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && transactions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <Checkbox
              checked={selectedIds.size === transactions.length}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all"
            />
            Select all
          </label>
          {Array.from(categoryGroups.entries()).map(([category, ids]) => (
            <Button
              key={category}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggleGroupSelected(ids)}
            >
              All {category} ({ids.length})
            </Button>
          ))}
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-muted bg-muted/40 p-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select value={bulkCategory} onValueChange={setBulkCategory}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Choose expense category" />
            </SelectTrigger>
            <SelectContent>
              {expenseCategoryOptions.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={isBulkWorking}
            onClick={() => void handleBulkDecision(true)}
          >
            <Check className="h-4 w-4 mr-1" /> Confirm as business
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBulkWorking}
            onClick={() => void handleBulkDecision(false)}
          >
            <X className="h-4 w-4 mr-1" /> Not business
          </Button>
        </div>
      ) : null}

      {!collapsed &&
        transactions.map((transaction) => (
          <div key={transaction.id} className="rounded-xl border border-muted p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  className="mt-1"
                  checked={selectedIds.has(transaction.id)}
                  onCheckedChange={() => toggleSelected(transaction.id)}
                  aria-label={`Select ${transaction.merchantName ?? transaction.rawName}`}
                />
                <div>
                  <div className="font-medium">{transaction.merchantName ?? transaction.rawName}</div>
                  <div className="text-sm text-muted-foreground">{transaction.date}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(transaction.amount)}</div>
                {transaction.suggestedExpenseAccount ? (
                  <Badge variant="secondary" className="mt-1">
                    {transaction.suggestedExpenseAccount}
                  </Badge>
                ) : null}
              </div>
            </div>

            <Select
              value={selectedAccount[transaction.id] ?? transaction.suggestedExpenseAccount ?? undefined}
              onValueChange={(value) =>
                setSelectedAccount((prev) => ({ ...prev, [transaction.id]: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose expense category" />
              </SelectTrigger>
              <SelectContent>
                {expenseCategoryOptions.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {receiptRowId === transaction.id ? (
              <ReceiptCaptureField capture={receiptCapture} />
            ) : null}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => handleConfirmClick(transaction)}>
                <Check className="h-4 w-4 mr-1" /> Confirm as business
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={receiptRowId === transaction.id ? "Remove receipt" : "Attach receipt"}
                onClick={() =>
                  receiptRowId === transaction.id ? closeReceiptRow() : setReceiptRowId(transaction.id)
                }
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDismissPrompt(transaction)}
              >
                <X className="h-4 w-4 mr-1" /> Not business
              </Button>
            </div>
          </div>
        ))}

      <AlertDialog open={dismissPrompt != null} onOpenChange={(open) => !open && setDismissPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Always treat {dismissPrompt?.merchantName ?? dismissPrompt?.rawName} as personal?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Future transactions from this merchant won&apos;t notify you or show up here
              anymore — they&apos;ll still be recorded quietly, in case a purchase from them is
              ever actually a business expense. You can undo this later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dismissPrompt) void handleDecision(dismissPrompt, false, false)
                setDismissPrompt(null)
              }}
            >
              Just this one
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (dismissPrompt) void handleDecision(dismissPrompt, false, true)
                setDismissPrompt(null)
              }}
            >
              Always
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={fuelWarningPrompt != null}
        onOpenChange={(open) => !open && setFuelWarningPrompt(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Already covered by your mileage deduction?</AlertDialogTitle>
            <AlertDialogDescription>
              This looks like a fuel purchase, and you track vehicle expenses using the standard
              mileage rate — fuel is already included in that per-mile deduction. Adding it here
              too would double it. Skip this one, or add it anyway if this fuel wasn&apos;t for
              business driving covered by mileage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (fuelWarningPrompt) void handleDecision(fuelWarningPrompt, false, false)
                setFuelWarningPrompt(null)
              }}
            >
              Skip (already covered)
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (fuelWarningPrompt) void handleDecision(fuelWarningPrompt, true)
                setFuelWarningPrompt(null)
              }}
            >
              Add anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={recurringPrompt != null} onOpenChange={(open) => !open && setRecurringPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This looks recurring</AlertDialogTitle>
            <AlertDialogDescription>
              {recurringPrompt?.vendor} has come up {cadenceLabel(recurringPrompt?.cadence ?? { freq: "monthly" }).toLowerCase()} at
              a similar amount. Set up a recurring rule and it&apos;ll be added to {recurringPrompt?.account} automatically from
              now on — future bank transactions from this merchant won&apos;t need to be reviewed here anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSettingUpRecurring}
              onClick={() => {
                if (recurringPrompt) void handleSetUpRecurring(recurringPrompt)
              }}
            >
              Set up recurring rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={receiptPrompt != null} onOpenChange={(open) => !open && setReceiptPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a receipt for this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This is over {formatCurrency(RECEIPT_REQUIRED_THRESHOLD)} — the IRS generally expects a receipt (not just
              a bank statement) to back up an expense this size in an audit. You can add one now, or add it later from
              your expenses list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                if (receiptPrompt) void handleDecision(receiptPrompt, true)
                setReceiptPrompt(null)
              }}
            >
              Add later
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (receiptPrompt) setReceiptRowId(receiptPrompt.id)
                setReceiptPrompt(null)
              }}
            >
              Add receipt now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
