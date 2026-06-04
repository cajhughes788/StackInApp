"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/helpers"
import {
  useEntriesData,
  useEntriesRenderState,
} from "@/lib/stores/useEntriesStore"
import {
  useSettingsData,
  useSettingsRenderState,
} from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { debugRender } from "@/lib/debugLoop"
import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge"
import SyncStatusIndicator from "@/components/sync-status-indicator"
import {
  getIncomeBreakdownTotalForPaymentMethod,
  getIncomeBreakdownTotalForPaymentMethodAndCategory,
  getIndependentCashSalesTotal,
} from "@shared/independentIncome"

export default function IndependentIncomeGauge() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const entries = useEntriesData(activeWorkspaceId)
  const settings = useSettingsData(activeWorkspaceId)
  const {
    status: entriesStatus,
    isHydrating: entriesHydrating,
    isRevalidating: entriesRevalidating,
    lastSuccessfulSyncAt: entriesLastSuccessfulSyncAt,
  } = useEntriesRenderState(activeWorkspaceId)
  const {
    status: settingsStatus,
    isHydrating: settingsHydrating,
    isRevalidating: settingsRevalidating,
  } = useSettingsRenderState(activeWorkspaceId)
  const hasRenderableEntries =
    entries.length > 0 || entriesLastSuccessfulSyncAt !== null
  const hasRenderableSettings = settings !== null
  const showSyncIndicator = entriesRevalidating || settingsRevalidating

  const totals = useMemo(() => {
    if (!settings) {
      return {
        incomeGauge: 0,
        hours: 0,
        daysWorked: 0,
        avgPerDay: 0,
        avgPerHour: 0,
      }
    }

    return computeIncomeGaugeForEntries(entries, {
      includeUnreportedInUI: settings.independent?.includeUnreportedInUI ?? false,
    })
  }, [entries, settings])

  const sourceTotals = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        const ind = entry.independent
        if (!ind) return acc

        acc.creditCardTips += getIncomeBreakdownTotalForPaymentMethodAndCategory(
          ind,
          "card",
          "tips"
        )
        acc.reportedCash += getIncomeBreakdownTotalForPaymentMethodAndCategory(
          ind,
          "cash",
          "tips"
        )
        acc.unreportedCash += ind.unreportedCashTips ?? ind.unreportedCash ?? 0
        acc.venmo += getIncomeBreakdownTotalForPaymentMethod(ind, "venmo")
        acc.appleCash += getIncomeBreakdownTotalForPaymentMethod(ind, "apple_cash")
        acc.zelle += getIncomeBreakdownTotalForPaymentMethod(ind, "zelle")
        acc.posSales += getIncomeBreakdownTotalForPaymentMethod(ind, "pos")
        acc.cashSales += getIndependentCashSalesTotal(ind)
        acc.customIncome +=
          ind.customIncome?.reduce((sum, item) => sum + (item.amount ?? 0), 0) ?? 0

        return acc
      },
      {
        creditCardTips: 0,
        reportedCash: 0,
        unreportedCash: 0,
        venmo: 0,
        appleCash: 0,
        zelle: 0,
        posSales: 0,
        cashSales: 0,
        customIncome: 0,
      }
    )
  }, [entries])

  const activeSources = useMemo(
    () => Object.values(sourceTotals).filter((value) => value > 0).length,
    [sourceTotals]
  )

  const maxAmount = 5000
  const targetIncome =
    settings?.independent?.incomeTargetPerMonth &&
    settings.independent.incomeTargetPerMonth > 0
      ? settings.independent.incomeTargetPerMonth
      : null
  const gaugeScale = targetIncome ?? maxAmount
  const fillPercentage = Math.min((totals.incomeGauge / gaugeScale) * 100, 100)
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date()),
    []
  )
  debugRender("independent-income-gauge", {
    workspaceId: activeWorkspaceId,
    workspaceType: activeWorkspace?.type ?? null,
    entriesStatus,
    settingsStatus,
    entriesCount: entries.length,
    hasSettings: settings !== null,
  })

  if (
    workspaceState.status !== "ready" ||
    !activeWorkspaceId ||
    activeWorkspace?.type !== "independent" ||
    (entriesHydrating && !hasRenderableEntries) ||
    (settingsHydrating && !hasRenderableSettings)
  ) {
    return <div className="p-4 text-gray-400 text-sm">Loading monthly income…</div>
  }

  return (
    <div className="relative bg-card rounded-lg border p-4 shadow-sm sm:p-6">
      <SyncStatusIndicator visible={showSyncIndicator} label="Syncing income" />

      <h2 className="mb-4 text-lg font-semibold">Current Month: {monthLabel}</h2>

      <div className="relative mb-5 h-28 sm:mb-6 sm:h-32">
        <div className="app-soft-surface absolute inset-0 rounded-lg overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500 ease-out"
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-black sm:text-3xl">
              {formatCurrency(totals.incomeGauge)}
            </div>
            <div className="text-xs text-slate-600 sm:text-sm">
              Gross Income
              {targetIncome ? ` of ${formatCurrency(targetIncome)}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{totals.daysWorked}</div>
          <div className="text-xs text-muted-foreground">Days Worked</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">{activeSources}</div>
          <div className="text-xs text-muted-foreground">Income Sources</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatCurrency(totals.avgPerDay)}
          </div>
          <div className="text-xs text-muted-foreground">Avg/Day</div>
        </div>
      </div>
    </div>
  )
}
