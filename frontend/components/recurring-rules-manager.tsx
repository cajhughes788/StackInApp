"use client"

import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"

import type { RecurringRuleType } from "@shared/schemas/recurringRule"
import { cadenceLabel } from "@shared/recurringSchedule"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { formatCurrency } from "@/lib/helpers"
import { paymentCategoryConfig } from "@/lib/incomeBreakdown"
import * as recurringRulesService from "@/lib/domain/recurringRulesService"
import {
  useRecurringRulesData,
  useRecurringRulesRenderState,
  useRecurringRulesStore,
} from "@/lib/stores/useRecurringRulesStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

function ruleSummary(rule: RecurringRuleType): { title: string; amount: number } {
  if (rule.type === "expense" && rule.expenseTemplate) {
    return {
      title: `${rule.expenseTemplate.vendor || rule.expenseTemplate.account} · ${rule.expenseTemplate.description}`,
      amount: rule.expenseTemplate.amount,
    }
  }
  if (rule.type === "income" && rule.incomeTemplate) {
    const { source, label, amount } = rule.incomeTemplate
    const title = source === "custom" ? (label || "Custom Income") : paymentCategoryConfig[source].label
    return { title, amount }
  }
  return { title: "Recurring rule", amount: 0 }
}

export default function RecurringRulesManager() {
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const rules = useRecurringRulesData(activeWorkspaceId)
  const { status } = useRecurringRulesRenderState(activeWorkspaceId)
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId) return
    void useRecurringRulesStore.getState().hydrateFromCacheOnce(activeWorkspaceId)
  }, [activeWorkspaceId])

  if (!activeWorkspaceId) return null

  const sortedRules = [...rules].sort((a, b) => a.nextOccurrence.localeCompare(b.nextOccurrence))

  async function handleToggleActive(rule: RecurringRuleType) {
    if (!activeWorkspaceId) return
    setPendingRuleId(rule.id)
    try {
      await recurringRulesService.setRecurringRuleActive(activeWorkspaceId, rule.id, !rule.active)
    } catch {
      // recurringRulesService already surfaces a toast/alert on failure.
    } finally {
      setPendingRuleId(null)
    }
  }

  async function handleDelete(rule: RecurringRuleType) {
    if (!activeWorkspaceId) return
    if (!window.confirm("Delete this recurring rule? Records it already created will not be removed.")) {
      return
    }
    setPendingRuleId(rule.id)
    try {
      await recurringRulesService.deleteRecurringRule(activeWorkspaceId, rule.id)
    } catch {
    } finally {
      setPendingRuleId(null)
    }
  }

  return (
    <div className="space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">Recurring</h1>
        <p className="text-sm text-muted-foreground">
          Expenses and income that repeat automatically. Editing or deleting a rule only affects
          future occurrences — records already created stay as-is.
        </p>
      </div>

      {status === "loading" && sortedRules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading recurring rules...</p>
      ) : sortedRules.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No recurring expenses or income yet. Toggle &ldquo;Repeats&rdquo; while adding an
            expense or a Custom Income entry to create one.
          </CardContent>
        </Card>
      ) : (
        sortedRules.map((rule) => {
          const summary = ruleSummary(rule)
          const isPending = pendingRuleId === rule.id
          return (
            <Card key={rule.id} className={rule.active ? undefined : "opacity-60"}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                  <Badge variant={rule.type === "expense" ? "secondary" : "default"}>
                    {rule.type === "expense" ? "Expense" : "Income"}
                  </Badge>
                  <CardTitle className="text-base">{summary.title}</CardTitle>
                </div>
                <Switch
                  checked={rule.active}
                  disabled={isPending}
                  onCheckedChange={() => void handleToggleActive(rule)}
                  aria-label={rule.active ? "Pause rule" : "Resume rule"}
                />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">{formatCurrency(summary.amount)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{cadenceLabel(rule.cadence)}</span>
                  <span className="text-muted-foreground">
                    {rule.active ? `Next: ${rule.nextOccurrence}` : "Paused"}
                  </span>
                </div>
                {rule.endDate ? (
                  <p className="text-xs text-muted-foreground">Ends {rule.endDate}</p>
                ) : null}
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void handleDelete(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
