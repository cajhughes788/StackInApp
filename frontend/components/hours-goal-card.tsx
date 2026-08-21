"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { calculateHoursGoalProjection } from "@shared/hoursStats"
import type { W2HoursGoalType } from "@shared/schemas/settings"
import { getLocalDateInputValue } from "@/lib/helpers"

type HoursGoalCardProps = {
  goal: W2HoursGoalType | null
  hoursSinceGoalStart: number
  defaultStartDate: string
  onSetGoal: (goal: W2HoursGoalType) => Promise<void>
  onClearGoal: () => Promise<void>
}

function formatHours(value: number): string {
  return value.toFixed(1)
}

function StatTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          accent ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-white"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export default function HoursGoalCard({
  goal,
  hoursSinceGoalStart,
  defaultStartDate,
  onSetGoal,
  onClearGoal,
}: HoursGoalCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [startDateInput, setStartDateInput] = useState("")
  const [endDateInput, setEndDateInput] = useState("")
  const [targetInput, setTargetInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const today = getLocalDateInputValue()

  // Primes the start date for a not-yet-created goal once real activity data has
  // loaded, without clobbering anything the user has already typed into the field.
  useEffect(() => {
    if (!goal && startDateInput === "") {
      setStartDateInput(defaultStartDate)
    }
  }, [goal, defaultStartDate, startDateInput])

  const projection = goal
    ? calculateHoursGoalProjection(hoursSinceGoalStart, goal.targetAvgHoursPerWeek, goal.startDate, goal.endDate)
    : null

  function startEditing() {
    const editingExisting = goal && !projection?.isPastEndDate
    setStartDateInput(editingExisting ? goal.startDate : defaultStartDate)
    setEndDateInput(editingExisting ? goal.endDate : "")
    setTargetInput(editingExisting ? String(goal.targetAvgHoursPerWeek) : "")
    setError(null)
    setIsEditing(true)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!startDateInput) {
      setError("Choose a start date.")
      return
    }
    if (!endDateInput) {
      setError("Choose a target date.")
      return
    }
    if (endDateInput <= startDateInput) {
      setError("Target date must be after the start date.")
      return
    }
    const target = Number(targetInput)
    if (!Number.isFinite(target) || target <= 0) {
      setError("Enter a target of more than 0 hours per week.")
      return
    }

    setError(null)
    setSaving(true)
    try {
      await onSetGoal({
        startDate: startDateInput,
        endDate: endDateInput,
        targetAvgHoursPerWeek: target,
      })
      setIsEditing(false)
    } catch {
      setError("Couldn't save your goal. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      await onClearGoal()
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const subtitle = !goal
    ? "Set a weekly-hours target"
    : projection?.isPastEndDate
      ? projection.isComplete
        ? "Goal reached"
        : "Goal ended"
      : `${formatHours(projection?.requiredAvgPerWeek ?? 0)} hrs/wk needed to hit your goal`

  const showForm = isEditing || !goal

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-700/80 dark:bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-slate-50/70 dark:hover:bg-slate-800/70 min-[420px]:px-5 sm:px-6"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">Hours Goal</div>
            <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>
          </div>
        </div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            key="goal-expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-slate-200/70 dark:border-slate-700/70"
          >
            <div className="space-y-4 px-4 py-5 min-[420px]:px-5 sm:px-6">
              {showForm ? (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <Label htmlFor="hours-goal-start-date">Start date</Label>
                    <Input
                      id="hours-goal-start-date"
                      type="date"
                      data-stackin-date-input="true"
                      className="w-full"
                      value={startDateInput}
                      max={today}
                      onChange={(event) => setStartDateInput(event.target.value)}
                      required
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Defaults to your first logged hours this year.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="hours-goal-end-date">Target date</Label>
                    <Input
                      id="hours-goal-end-date"
                      type="date"
                      data-stackin-date-input="true"
                      className="w-full"
                      value={endDateInput}
                      min={startDateInput || today}
                      onChange={(event) => setEndDateInput(event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="hours-goal-target">Target hours / week</Label>
                    <Input
                      id="hours-goal-target"
                      type="number"
                      min="0.1"
                      step="0.1"
                      inputMode="decimal"
                      className="w-full"
                      value={targetInput}
                      onChange={(event) => setTargetInput(event.target.value)}
                      required
                    />
                  </div>
                  {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={saving} className="flex-1">
                      {saving ? "Saving..." : goal ? "Update goal" : "Set goal"}
                    </Button>
                    {goal ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => setIsEditing(false)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatTile label={`Hours Since ${goal!.startDate}`} value={formatHours(hoursSinceGoalStart)} />
                    <StatTile label="Current Avg / Week" value={formatHours(projection?.currentAvgPerWeek ?? 0)} />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {projection?.isPastEndDate
                        ? `Target was ${formatHours(goal!.targetAvgHoursPerWeek)} hrs/wk from ${goal!.startDate} to ${goal!.endDate}`
                        : `To average ${formatHours(goal!.targetAvgHoursPerWeek)} hrs/wk from ${goal!.startDate} to ${goal!.endDate}`}
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {projection?.isPastEndDate
                        ? projection.isComplete
                          ? "Goal reached"
                          : "Goal not reached"
                        : `${formatHours(projection?.requiredAvgPerWeek ?? 0)} hrs/wk needed`}
                    </div>
                    {!projection?.isPastEndDate ? (
                      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        {formatHours(projection?.weeksRemaining ?? 0)} weeks remaining ·{" "}
                        {formatHours(projection?.hoursRemaining ?? 0)} hrs still needed
                      </div>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={startEditing}>
                      {projection?.isPastEndDate ? "Set new goal" : "Edit goal"}
                    </Button>
                    <Button type="button" variant="outline" disabled={saving} onClick={handleClear}>
                      Remove
                    </Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
