"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, ChevronUp, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
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
import { normalizePlaidMerchantKey, resolvePlaidDisplayName } from "@shared/plaidClassification"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import {
  confirmPlaidPendingTransaction,
  getPlaidPendingTransactions,
  linkPlaidMerchantToRecurringRule,
  updatePlaidMerchantMemory,
  type PlaidPendingTransaction,
  type PlaidPersonalSuggestion,
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

function TransactionReviewCard({
  transaction,
  isSelected,
  onToggleSelected,
  categoryValue,
  expenseCategoryOptions,
  onCategoryChange,
  onConfirm,
  onDismiss,
  isReceiptRowOpen,
  onToggleReceiptRow,
  receiptCapture,
}: {
  transaction: PlaidPendingTransaction
  isSelected: boolean
  onToggleSelected: () => void
  categoryValue: string | undefined
  expenseCategoryOptions: string[]
  onCategoryChange: (value: string) => void
  onConfirm: () => void
  onDismiss: () => void
  isReceiptRowOpen: boolean
  onToggleReceiptRow: () => void
  receiptCapture: ReturnType<typeof useReceiptCapture>
}) {
  const displayName = resolvePlaidDisplayName(transaction.merchantName, transaction.rawName)

  return (
    <div className="space-y-3 rounded-xl border border-muted bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Checkbox
            className="mt-1"
            checked={isSelected}
            onCheckedChange={onToggleSelected}
            aria-label={`Select ${displayName}`}
          />
          <div>
            <div className="font-medium">{displayName}</div>
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

      <div>
        <Select value={categoryValue} onValueChange={onCategoryChange}>
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
      </div>

      {isReceiptRowOpen ? (
        <div>
          <ReceiptCaptureField capture={receiptCapture} />
        </div>
      ) : null}

      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Confirm as business"
          onClick={onConfirm}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={isReceiptRowOpen ? "Remove receipt" : "Attach receipt"}
          onClick={onToggleReceiptRow}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Not business"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
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
  const [personalPrompt, setPersonalPrompt] = useState<PlaidPersonalSuggestion | null>(null)
  const [bulkDismissPromptOpen, setBulkDismissPromptOpen] = useState(false)
  const [fuelWarningPrompt, setFuelWarningPrompt] = useState<PlaidPendingTransaction | null>(null)
  const [receiptPrompt, setReceiptPrompt] = useState<PlaidPendingTransaction | null>(null)
  const [recurringPrompt, setRecurringPrompt] = useState<PlaidRecurringSuggestion | null>(null)
  const [isSettingUpRecurring, setIsSettingUpRecurring] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [receiptRowId, setReceiptRowId] = useState<string | null>(null)
  const didAutoCollapseRef = useRef(arrivedViaReviewDeepLink())
  // Bumped on every loadTransactions call so a slow, superseded request
  // (e.g. one fired for a workspace ID that turned out to be a stale cache
  // value from useWorkspaceStore's hydrate-then-reconcile flow) can't
  // resolve after a newer one and clobber it with stale/empty data — that
  // race is what made the review banner flash in and then disappear.
  const activeRequestIdRef = useRef(0)
  const receiptCapture = useReceiptCapture(activeWorkspaceId)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState<string>("")
  const [isBulkWorking, setIsBulkWorking] = useState(false)

  const loadTransactions = useCallback(async () => {
    if (!activeWorkspaceId) return
    const requestId = ++activeRequestIdRef.current
    setIsLoading(true)
    try {
      const results = await getPlaidPendingTransactions(activeWorkspaceId)
      if (activeRequestIdRef.current !== requestId) return
      setTransactions(results)
      setSelectedIds(new Set())
      if (!didAutoCollapseRef.current && results.length > AUTO_COLLAPSE_THRESHOLD) {
        setCollapsed(true)
        didAutoCollapseRef.current = true
      }
    } catch {
      if (activeRequestIdRef.current === requestId) {
        toast({ title: "Couldn't load bank transactions", variant: "destructive" })
      }
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setIsLoading(false)
      }
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

  // Same idea as categoryGroups, but for the cold-start case the classifier
  // has no opinion on at all — a brand-new account (or a merchant nothing's
  // ever taught the system about) produces transactions with no suggested
  // category, which categoryGroups above skips entirely. Without this, the
  // exact case bulk review exists to help with — many repeats of the same
  // unrecognized merchant right after a historical import — gets none of
  // that help. Grouped by merchant identity (not category, since there
  // isn't one yet) so "8 unrecognized Amazon charges" is still one chip.
  const merchantGroups = useMemo(() => {
    const groups = new Map<string, { label: string; ids: string[] }>()
    for (const transaction of transactions) {
      if (transaction.suggestedExpenseAccount) continue
      // Prefer the server's key so grouping matches merchant memory exactly
      // (a merchant may still live under its legacy key).
      const key = transaction.merchantKey || normalizePlaidMerchantKey(transaction.merchantName, transaction.rawName)
      if (!key) continue
      const existing = groups.get(key)
      if (existing) existing.ids.push(transaction.id)
      else groups.set(key, { label: resolvePlaidDisplayName(transaction.merchantName, transaction.rawName), ids: [transaction.id] })
    }
    for (const [key, group] of groups) {
      if (group.ids.length < 2) groups.delete(key)
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

  async function handleDecision(transaction: PlaidPendingTransaction, isBusiness: boolean) {
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
      // A plain dismiss is never "always personal" here — that choice only
      // ever comes from the bulk-dismiss dialog now (see handleBulkDecision).
      // A single dismiss just dismisses, silently; if a real pattern shows
      // up (the same merchant dismissed a few times), the backend hands back
      // personalSuggestion below instead of asking up front every time.
      const result = await confirmPlaidPendingTransaction(activeWorkspaceId, transaction.id, {
        isBusiness,
        account,
        alwaysPersonal: false,
        receiptAssetId,
      })
      if (result.recurringSuggestion) setRecurringPrompt(result.recurringSuggestion)
      if (result.personalSuggestion) setPersonalPrompt(result.personalSuggestion)
    } catch {
      // Put back only this row, in its original position, on top of the
      // current list — restoring the earlier snapshot would resurrect rows
      // dismissed since then and drop rows that arrived since then.
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

  async function handleBulkDecision(isBusiness: boolean, alwaysPersonal = false) {
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
          alwaysPersonal,
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

      {!collapsed && isLoading && transactions.length === 0 ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border border-muted bg-card p-4">
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
          {Array.from(merchantGroups.entries()).map(([merchantKey, group]) => (
            <Button
              key={merchantKey}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggleGroupSelected(group.ids)}
            >
              All {group.label} ({group.ids.length})
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
            onClick={() => setBulkDismissPromptOpen(true)}
          >
            <X className="h-4 w-4 mr-1" /> Not business
          </Button>
        </div>
      ) : null}

      {!collapsed &&
        transactions.map((transaction) => (
          <TransactionReviewCard
            key={transaction.id}
            transaction={transaction}
            isSelected={selectedIds.has(transaction.id)}
            onToggleSelected={() => toggleSelected(transaction.id)}
            categoryValue={selectedAccount[transaction.id] ?? transaction.suggestedExpenseAccount ?? undefined}
            expenseCategoryOptions={expenseCategoryOptions}
            onCategoryChange={(value) =>
              setSelectedAccount((prev) => ({ ...prev, [transaction.id]: value }))
            }
            onConfirm={() => handleConfirmClick(transaction)}
            onDismiss={() => void handleDecision(transaction, false)}
            isReceiptRowOpen={receiptRowId === transaction.id}
            onToggleReceiptRow={() =>
              receiptRowId === transaction.id ? closeReceiptRow() : setReceiptRowId(transaction.id)
            }
            receiptCapture={receiptCapture}
          />
        ))}

      <AlertDialog open={personalPrompt != null} onOpenChange={(open) => !open && setPersonalPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              You&apos;ve dismissed transactions from {personalPrompt?.displayName} {personalPrompt?.dismissCount} times
              — stop asking about this merchant?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Future transactions from this merchant won&apos;t notify you or show up here
              anymore — they&apos;ll still be recorded quietly, in case a purchase from them is
              ever actually a business expense. You can undo this later from Account Settings
              &rarr; Learned Merchants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep asking</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const suggestion = personalPrompt
                setPersonalPrompt(null)
                if (!activeWorkspaceId || !suggestion) return
                updatePlaidMerchantMemory(activeWorkspaceId, suggestion.merchantKey, {
                  mode: "always_personal",
                }).catch(() => {
                  toast({ title: "Couldn't update this merchant", variant: "destructive" })
                })
              }}
            >
              Yes, stop asking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDismissPromptOpen} onOpenChange={setBulkDismissPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Always treat these merchants as personal?</AlertDialogTitle>
            <AlertDialogDescription>
              Future transactions from the merchants in this batch won&apos;t notify you or show up
              here anymore if you choose &quot;Always&quot; — they&apos;ll still be recorded quietly,
              in case a purchase from one of them is ever actually a business expense. You can edit
              or undo this later from Account Settings &rarr; Learned Merchants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBulkDismissPromptOpen(false)
                void handleBulkDecision(false, false)
              }}
            >
              Just this batch
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setBulkDismissPromptOpen(false)
                void handleBulkDecision(false, true)
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
                if (fuelWarningPrompt) void handleDecision(fuelWarningPrompt, false)
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
