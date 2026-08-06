"use client"

import { useMemo } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSettingsData } from "@/lib/stores/useSettingsStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { usePeriodSelectionStore, useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore"
import { listPeriodsBack } from "@shared/payPeriods"

// Shared by the Independent income/expense gauges (calendar months) and the
// W2 income gauge (pay periods) so the "which period am I looking at"
// dropdown and closed-period banner only exist in one place.
export default function PeriodSelector() {
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const settings = useSettingsData(activeWorkspaceId)
  const selectedPeriod = useSelectedPeriod(activeWorkspaceId)
  const setSelectedPeriod = usePeriodSelectionStore((s) => s.setSelectedPeriod)

  const periods = useMemo(() => {
    if (!settings || !activeWorkspace) return []
    return listPeriodsBack(settings, activeWorkspace.type, activeWorkspace.createdAt ?? null)
  }, [settings, activeWorkspace])

  if (!activeWorkspaceId || !activeWorkspace || !settings || periods.length === 0) {
    return null
  }

  const currentPeriod = periods[0]
  const activePeriodId = selectedPeriod?.periodId ?? currentPeriod.periodId
  const periodNoun = activeWorkspace.type === "independent" ? "month" : "pay period"
  const statementNoun =
    activeWorkspace.type === "independent" ? "profit & loss statement" : "estimated earnings"

  return (
    <div className="mb-4">
      <Select
        value={activePeriodId}
        onValueChange={(value) => {
          const period = periods.find((candidate) => candidate.periodId === value)
          if (!period) return
          const isCurrent = period.periodId === currentPeriod.periodId
          setSelectedPeriod(activeWorkspaceId, isCurrent ? null : period)
        }}
      >
        <SelectTrigger className="w-fit gap-1.5 border-none bg-transparent px-0 text-lg font-semibold shadow-none hover:bg-transparent focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periods.map((period) => (
            <SelectItem key={period.periodId} value={period.periodId}>
              {period.label}
              {period.periodId === currentPeriod.periodId ? " (current)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedPeriod ? (
        <p className="mt-1 text-xs text-amber-600">
          You&rsquo;re viewing a closed {periodNoun} — changes here will update its {statementNoun}.
        </p>
      ) : null}
    </div>
  )
}
