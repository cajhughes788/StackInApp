"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

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
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  getPlaidMerchantMemory,
  resetPlaidMerchantMemory,
  updatePlaidMerchantMemory,
  type PlaidMerchantMemory,
} from "@/lib/api/plaidApi"

function modeLabel(mode: PlaidMerchantMemory["mode"]): string {
  switch (mode) {
    case "always_personal":
      return "Always personal — no notifications"
    case "covered_by_recurring_rule":
      return "Handled by a recurring rule"
    default:
      return "Ask every time"
  }
}

export default function PlaidMerchantMemoryPanel({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [merchants, setMerchants] = useState<PlaidMerchantMemory[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [forgetTarget, setForgetTarget] = useState<PlaidMerchantMemory | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setMerchants(await getPlaidMerchantMemory(workspaceId))
    } catch {
      toast({ title: "Couldn't load learned merchants", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void load()
  }, [load])

  // Only merchants StackIn has actually gone quiet about — an "ask every
  // time" merchant has no decision to review or undo, so listing every
  // learned merchant here (as this screen used to) was mostly noise.
  const mutedMerchants = useMemo(
    () => merchants.filter((merchant) => merchant.mode !== "ask_every_time"),
    [merchants]
  )

  async function handleModeChange(merchant: PlaidMerchantMemory, mode: "ask_every_time" | "always_personal") {
    const previous = merchants
    setPendingKey(merchant.merchantKey)
    setMerchants((prev) =>
      prev.map((m) => (m.merchantKey === merchant.merchantKey ? { ...m, mode } : m))
    )
    try {
      await updatePlaidMerchantMemory(workspaceId, merchant.merchantKey, { mode })
    } catch {
      setMerchants(previous)
      toast({ title: "Couldn't update this merchant", variant: "destructive" })
    } finally {
      setPendingKey(null)
    }
  }

  async function handleForget() {
    if (!forgetTarget) return
    const target = forgetTarget
    setForgetTarget(null)
    const previous = merchants
    setPendingKey(target.merchantKey)
    setMerchants((prev) => prev.filter((m) => m.merchantKey !== target.merchantKey))
    try {
      await resetPlaidMerchantMemory(workspaceId, target.merchantKey)
    } catch {
      setMerchants(previous)
      toast({ title: "Couldn't forget this merchant", variant: "destructive" })
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-base">Learned Merchants</h3>
        <p className="text-sm text-muted-foreground">
          Merchants StackIn has stopped asking about — either you told it to always treat one as personal, or a
          recurring rule now covers it. Change your mind or forget a merchant here; it only affects future
          transactions from that merchant.
        </p>
      </div>

      {!isLoading && mutedMerchants.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-muted px-3 py-6 text-center">
          Nothing here yet — merchants show up once you tell StackIn to stop asking about them.
        </p>
      ) : null}

      <div className="space-y-2">
        {mutedMerchants.map((merchant) => (
          <div key={merchant.merchantKey} className="rounded-lg border border-muted px-3 py-2 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{merchant.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {merchant.isBusiness ? merchant.expenseCategory ?? "Business" : "Personal"}
                  {merchant.decisionCount > 1 ? ` • seen ${merchant.decisionCount} times` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {merchant.mode === "covered_by_recurring_rule" ? (
                  <span className="text-xs text-muted-foreground px-2">{modeLabel(merchant.mode)}</span>
                ) : (
                  <Select
                    value={merchant.mode}
                    disabled={pendingKey === merchant.merchantKey}
                    onValueChange={(value) =>
                      void handleModeChange(merchant, value as "ask_every_time" | "always_personal")
                    }
                  >
                    <SelectTrigger className="h-8 w-[190px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask_every_time">Ask every time</SelectItem>
                      <SelectItem value="always_personal">Always personal</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={pendingKey === merchant.merchantKey}
                  onClick={() => setForgetTarget(merchant)}
                >
                  Forget
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={forgetTarget != null} onOpenChange={(open) => !open && setForgetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget {forgetTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              StackIn will stop applying this remembered decision. The next transaction from this merchant gets
              classified fresh, the same as the very first time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleForget()}>Forget</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
