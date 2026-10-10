"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/helpers"
import { resolvePlaidDisplayName } from "@shared/plaidClassification"
import {
  getPlaidHiddenTransfers,
  getPlaidItems,
  restorePlaidHiddenTransfer,
  type PlaidLinkedAccount,
  type PlaidPendingTransaction,
} from "@/lib/api/plaidApi"

// The safety net for transfer detection (classifyPlaidTransferSignal /
// pairWithTransferCounterpart in the backend): everything 521 hid as money
// moving between the user's own accounts, with a way to put a wrongly
// hidden one back into review.

function accountLabel(account: PlaidLinkedAccount | undefined): string {
  if (!account) return "another account"
  return account.mask ? `${account.name} ••${account.mask}` : account.name
}

function hiddenReason(
  transaction: PlaidPendingTransaction,
  account: PlaidLinkedAccount | undefined,
  pair: PlaidPendingTransaction | undefined,
  pairAccount: PlaidLinkedAccount | undefined
): string {
  if (transaction.isVenmoCashout) {
    return "Venmo cash-out — your Venmo payments are added from your Venmo statement import instead"
  }
  if (transaction.transferPairId) {
    if (!pair) return "Matched with the same amount moving the other way on another account"
    const motion = pair.direction === "income" ? "arriving in" : "leaving"
    return `Matched with ${formatCurrency(pair.amount)} ${motion} ${accountLabel(pairAccount)} on ${pair.date}`
  }
  if (transaction.direction === "income" && (account?.type === "credit" || account?.type === "loan")) {
    return "Money arriving on a credit card or loan — a payment or refund, not income"
  }
  return "Your bank marked this as a card payment or a move between your own accounts"
}

export default function PlaidHiddenTransfersPanel({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [transfers, setTransfers] = useState<PlaidPendingTransaction[]>([])
  const [accounts, setAccounts] = useState<Map<string, PlaidLinkedAccount>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [hidden, items] = await Promise.all([
        getPlaidHiddenTransfers(workspaceId),
        // Only used to name accounts — the list still works without it.
        getPlaidItems(workspaceId).catch(() => []),
      ])
      setTransfers(hidden)
      setAccounts(new Map(items.flatMap((item) => item.linkedAccounts).map((account) => [account.accountId, account])))
    } catch {
      toast({ title: "Couldn't load hidden transfers", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(() => new Map(transfers.map((t) => [t.id, t])), [transfers])

  async function handleRestore(transaction: PlaidPendingTransaction) {
    setRestoringId(transaction.id)
    try {
      const { restoredIds } = await restorePlaidHiddenTransfer(workspaceId, transaction.id)
      const restored = new Set(restoredIds)
      // The other half loses its pairing either way, so its reason text
      // would be stale — reload rather than patching it locally.
      setTransfers((prev) => prev.filter((t) => !restored.has(t.id)))
      if (transaction.transferPairId) void load()
      const tab = transaction.direction === "income" ? "Income" : "Expenses"
      toast({
        title:
          restoredIds.length > 1
            ? `Moved to review — along with the transaction it was matched with`
            : `Moved to your ${tab} review`,
      })
    } catch {
      toast({ title: "Couldn't restore this transaction", variant: "destructive" })
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-base">Hidden Transfers</h3>
        <p className="text-sm text-muted-foreground">
          Bank transactions 521 skipped because they looked like money moving between your own accounts, such as
          paying a credit card or moving money to savings. They aren&apos;t income or expenses. If one was
          actually a payment from a client or a real expense, tap &quot;Not a transfer&quot; to send it back to
          review.
        </p>
      </div>

      {!isLoading && transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-muted px-3 py-6 text-center">
          No hidden transfers. They&apos;ll show up here once a linked bank reports one.
        </p>
      ) : null}

      <div className="space-y-2">
        {transfers.map((transaction) => {
          const account = accounts.get(transaction.accountId)
          const pair = transaction.transferPairId ? byId.get(transaction.transferPairId) : undefined
          const pairAccount = pair ? accounts.get(pair.accountId) : undefined
          const isIncome = transaction.direction === "income"
          return (
            <div key={transaction.id} className="rounded-lg border border-muted px-3 py-2 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {resolvePlaidDisplayName(transaction.merchantName, transaction.rawName)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {transaction.date} • {accountLabel(account)}
                  </div>
                </div>
                <div className={`text-sm font-semibold shrink-0 ${isIncome ? "text-emerald-700" : ""}`}>
                  {isIncome ? "+" : "−"}
                  {formatCurrency(transaction.amount)}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{hiddenReason(transaction, account, pair, pairAccount)}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={restoringId === transaction.id}
                  onClick={() => void handleRestore(transaction)}
                >
                  Not a transfer
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
