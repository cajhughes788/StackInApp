"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { AlertCircle, ChevronDown, Landmark } from "lucide-react"

import Expand from "@/components/expand"
import TaxAnswersSheet from "@/components/tax/tax-answers-sheet"
import TaxPaymentsSheet, { IRS_PAYMENTS_URL } from "@/components/tax/tax-payments-sheet"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/helpers"
import { useTaxEstimateStore } from "@/lib/stores/useTaxEstimateStore"
import { useEntriesData, useEntriesRenderState } from "@/lib/stores/useEntriesStore"
import { useExpensesData, useExpensesRenderState } from "@/lib/stores/useExpensesStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import type { FederalEstimate, TipsDeductionStatus } from "@shared/estimatedTax/calculate"
import { findTippedOccupation } from "@shared/estimatedTax/tippedOccupations"
import { stateName, type StateTaxResult } from "@shared/estimatedTax/states"

// Home's "Taxes" card for self-employed workspaces (shared/estimatedTax).
// Order of trust: the penalty-free amount from last year's return is a
// rule, so it leads; the estimate from this year's records follows, as a
// range; and when the records or answers aren't good enough the card says
// what to fix instead of showing a number.

function dueLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
// Up to two decimals, no trailing zeros: 12%, 4.25%, 4.99%, 3.5%.
const pct = (rate: number) => `${parseFloat((rate * 100).toFixed(2))}%`

function MathRow({ label, value, sub, strong = false }: { label: string; value: number; sub?: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border/70 pt-1.5 font-medium text-foreground" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>
        {label}
        {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
      </dt>
      <dd className="shrink-0 tabular-nums text-foreground">{formatCurrency(value)}</dd>
    </div>
  )
}

function ShowTheMath({
  estimate,
  annualizedProfit,
  annualizedWages,
  state,
}: {
  estimate: FederalEstimate
  annualizedProfit: number
  annualizedWages: number
  state: StateTaxResult
}) {
  const l = estimate.lines
  return (
    <dl className="space-y-1.5 text-sm">
      <MathRow label="Business profit for the year" sub="Your records so far, scaled to 12 months" value={annualizedProfit} />
      {annualizedWages > 0 ? <MathRow label="W-2 pay for the year" value={annualizedWages} /> : null}
      <MathRow
        label="Self-employment tax"
        sub={`15.3% of ${formatCurrency(l.netEarningsFromSelfEmployment)} (92.35% of profit)${
          l.socialSecurityTaxableEarnings < l.netEarningsFromSelfEmployment ? "; Social Security part capped" : ""
        }`}
        value={l.selfEmploymentTax}
      />
      {l.additionalMedicareTax > 0 ? <MathRow label="Additional Medicare tax" sub="0.9% over the threshold" value={l.additionalMedicareTax} /> : null}
      <MathRow label="Adjusted gross income" sub="Income minus half of self-employment tax" value={l.adjustedGrossIncome} />
      <MathRow label="Standard deduction" value={-l.standardDeduction} />
      {l.tipsDeduction > 0 ? <MathRow label="No tax on tips deduction" sub="Your recorded tips, up to $25,000" value={-l.tipsDeduction} /> : null}
      <MathRow label="Business income deduction (QBI)" sub="20% of business income, limited" value={-l.qbiDeduction} />
      <MathRow label="Taxable income" value={l.taxableIncome} />
      <MathRow label="Income tax" sub={`From the ${estimate.year} brackets (top rate ${pct(estimate.marginalRate)})`} value={l.incomeTaxBeforeCredits} />
      {l.childTaxCredit > 0 ? <MathRow label="Child tax credit" value={-l.childTaxCredit} /> : null}
      <MathRow label="Federal tax for the year" value={estimate.totalTax} strong />
      {state.status === "included" ? (
        <MathRow
          label={`${stateName(state.stateCode)} tax for the year`}
          sub={`${pct(state.rate)} of ${formatCurrency(state.taxableIncome)} · paid to the state, separately`}
          value={state.tax}
          strong
        />
      ) : null}
    </dl>
  )
}

// Why the tips deduction isn't in the number, when there are tips.
function tipsNote(status: TipsDeductionStatus, occupationCode: string | null): string | null {
  switch (status) {
    case "occupation_not_chosen":
      return "You have tips recorded. Pick your line of work in Your answers to see if they qualify for the tips deduction."
    case "specified_service":
      return `Self-employed ${findTippedOccupation(occupationCode)?.title.toLowerCase() ?? "people in your field"} may not qualify for the tips deduction, so it's left out. A tax pro can confirm.`
    case "married_separately":
      return "Married couples filing separately can't take the tips deduction."
    case "phased_out":
      return "At your income the tips deduction phases out completely."
    default:
      return null
  }
}

export default function TaxEstimateCard({ className = "" }: { className?: string }) {
  const ownerUid = useWorkspaceStore((s) => s.ownerUid)
  const workspaceState = useWorkspaceStore((s) => s.state)
  const { data, status, load } = useTaxEstimateStore()
  const [answersOpen, setAnswersOpen] = useState(false)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [mathOpen, setMathOpen] = useState(false)
  const mathId = useId()

  useEffect(() => {
    if (ownerUid) void load(ownerUid)
  }, [ownerUid, load])

  // Refetch when this workspace's records change (like the All income card),
  // so a new entry or expense shows in the estimate at once instead of after
  // the store's 5-minute refresh. Waits until new records have saved and for
  // a short quiet spell, so the server's P&L is up to date and a burst of
  // changes is one request.
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const entries = useEntriesData(activeWorkspaceId)
  const expenses = useExpensesData(activeWorkspaceId)
  const entriesState = useEntriesRenderState(activeWorkspaceId)
  const expensesState = useExpensesRenderState(activeWorkspaceId)
  // Still arriving (device cache, then the server): not a change by the user.
  const recordsLoading =
    entriesState.isHydrating || entriesState.isRevalidating || expensesState.isHydrating || expensesState.isRevalidating
  const records = useMemo(() => {
    const unsaved =
      entries.some((e) => !!e.syncState || String(e.id ?? "").startsWith("tmp-")) ||
      // An expense not yet saved has only a temporary tempId, no id.
      expenses.some((e) => !e.id || String(e.id).startsWith("tmp-"))
    const entryTotal = entries.reduce((sum, e) => sum + Number(e.totals?.dayTotal ?? 0), 0)
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0)
    return {
      unsaved,
      key: `${entries.length}:${entryTotal.toFixed(2)}:${expenses.length}:${expenseTotal.toFixed(2)}`,
    }
  }, [entries, expenses])
  const baseline = useRef<{ workspaceId: string | null; key: string } | null>(null)
  useEffect(() => {
    if (!ownerUid || records.unsaved || recordsLoading) return
    const previous = baseline.current
    // First look at a workspace sets the baseline; the initial load covers it.
    if (!previous || previous.workspaceId !== activeWorkspaceId) {
      baseline.current = { workspaceId: activeWorkspaceId, key: records.key }
      return
    }
    if (previous.key === records.key) return
    const timer = setTimeout(() => {
      baseline.current = { workspaceId: activeWorkspaceId, key: records.key }
      void load(ownerUid, { force: true })
    }, 1500)
    return () => clearTimeout(timer)
  }, [ownerUid, activeWorkspaceId, records, recordsLoading, load])

  const hasW2Income =
    workspaceState.status === "ready" && workspaceState.workspaces.some((w) => w.type === "w2" && w.status !== "archived")
  const refresh = () => {
    if (ownerUid) void load(ownerUid, { force: true })
  }

  if (status === "error" || (data && !data.eligible)) return null
  if (!data) {
    return (
      <div className={`space-y-3 rounded-[22px] border border-card-border bg-card p-5 ${className}`} role="status" aria-live="polite">
        <span className="sr-only">Loading your tax estimate…</span>
        <Skeleton className="h-4 w-20 bg-muted" />
        <Skeleton className="h-7 w-56 bg-muted" />
        <Skeleton className="h-4 w-44 bg-muted" />
      </div>
    )
  }
  if (!data.eligible) return null

  const { health, quarterly, profile, taxYear } = data
  const blockers = health.issues.filter((issue) => issue.severity === "blocker")
  const warnings = health.issues.filter((issue) => issue.severity === "warning")
  const answersSheet = (
    <TaxAnswersSheet
      open={answersOpen}
      onOpenChange={setAnswersOpen}
      profile={profile}
      hasW2Income={hasW2Income}
      hasTips={data.ytdTips > 0}
      suggestedStateCode={data.suggestedStateCode}
      onSaved={refresh}
    />
  )
  const header = (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Landmark className="size-4" aria-hidden="true" />
        Taxes · {taxYear}
      </h2>
      {profile.updatedAt ? (
        <button type="button" onClick={() => setAnswersOpen(true)} className="text-sm font-medium text-primary">
          Your answers
        </button>
      ) : null}
    </div>
  )
  const stateCovered =
    quarterly?.state.annualized.status === "included" || quarterly?.state.annualized.status === "none"
  const footer = (
    <p className="mt-4 text-xs text-muted-foreground">
      Estimate ·{" "}
      {stateCovered
        ? quarterly?.penaltyFree != null && health.canShowSafeHarbor
          ? "the penalty-free amount covers federal tax"
          : "federal and state"
        : "federal only, state tax not included"}{" "}
      · not tax advice. Pay at{" "}
      <a href={IRS_PAYMENTS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        IRS.gov/payments
      </a>
      .
    </p>
  )
  const paymentsTotal = data.payments.reduce((sum, p) => sum + p.amount, 0)
  // The same basis the headline uses: last year's tax when it leads,
  // otherwise the smaller penalty-free target.
  const targetBasis =
    health.canShowSafeHarbor && quarterly?.safeHarbor.priorYearTarget != null
      ? quarterly.safeHarbor.priorYearTarget
      : quarterly?.safeHarbor.annualTarget ?? null
  const yearTarget = quarterly && targetBasis != null ? Math.max(0, targetBasis - quarterly.annualWithholding) : null
  const paymentsSheet = (
    <TaxPaymentsSheet
      open={paymentsOpen}
      onOpenChange={setPaymentsOpen}
      taxYear={taxYear}
      payments={data.payments}
      yearTarget={yearTarget}
      onChanged={refresh}
    />
  )

  // ---- First visit: ask the questions ----
  if (health.status === "needs_profile" && !profile.updatedAt) {
    return (
      <section className={`rounded-[22px] border border-card-border bg-card p-5 ${className}`}>
        {header}
        <p className="text-lg font-semibold text-foreground">Know what to set aside for taxes</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Self-employed income has no tax taken out. Answer a few questions and we&apos;ll work out your quarterly payments from your records.
        </p>
        <Button className="mt-4" onClick={() => setAnswersOpen(true)}>Set up (1 min)</Button>
        {answersSheet}
      </section>
    )
  }

  const showSafeHarbor = health.canShowSafeHarbor && quarterly?.penaltyFree != null
  const showEstimate = health.canShowEstimate && quarterly != null
  const due = quarterly ? dueLabel(quarterly.dueDate) : null
  const showEarningsLine =
    showEstimate && quarterly && !quarterly.belowEstimatesThreshold &&
    (quarterly.penaltyFree == null || quarterly.basedOnEarnings < quarterly.penaltyFree - 0.5)
  const rangeIsOne = quarterly ? quarterly.range.high - quarterly.range.low < 50 : false

  return (
    <section className={`rounded-[22px] border border-card-border bg-card p-5 ${className}`} aria-label={`Taxes for ${taxYear}`}>
      {header}

      {showSafeHarbor && quarterly ? (
        <div>
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {quarterly.penaltyFree === 0 ? (
              <>Nothing due by {due}</>
            ) : (
              <>
                Pay <span className="tabular-nums">{wholeDollars.format(Math.ceil(quarterly.penaltyFree ?? 0))}</span> by {due}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {quarterly.penaltyFree === 0
              ? "You won't owe an underpayment penalty this year."
              : `That avoids an IRS underpayment penalty, based on last year's tax of ${wholeDollars.format(profile.priorYearTax ?? 0)}.`}
          </p>
        </div>
      ) : null}

      {showEstimate && quarterly ? (
        <div className={showSafeHarbor ? "mt-4 space-y-1" : "space-y-1"}>
          {quarterly.belowEstimatesThreshold ? (
            <p className={showSafeHarbor ? "text-sm text-foreground" : "text-2xl font-semibold tracking-tight text-foreground"}>
              No quarterly payment needed
            </p>
          ) : showSafeHarbor ? (
            showEarningsLine ? (
              <p className="text-sm text-foreground">
                Based on what you&apos;ve earned so far,{" "}
                <span className="font-medium tabular-nums">{wholeDollars.format(Math.ceil(quarterly.basedOnEarnings))}</span> by {due} also covers you.
              </p>
            ) : null
          ) : (
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              Set aside about <span className="tabular-nums">{wholeDollars.format(Math.ceil(quarterly.basedOnEarnings))}</span> by {due}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            You&apos;ll likely owe{" "}
            <span className="font-medium tabular-nums text-foreground">
              {rangeIsOne
                ? wholeDollars.format(quarterly.range.high)
                : `${wholeDollars.format(quarterly.range.low)}–${wholeDollars.format(quarterly.range.high)}`}
            </span>{" "}
            in federal tax for {taxYear}
            {rangeIsOne ? "." : ", depending on whether the rest of the year looks like the year so far or the last three months."}
          </p>
          {quarterly.belowEstimatesThreshold ? (
            <p className="text-sm text-muted-foreground">Under $1,000 owed after withholding, the IRS doesn&apos;t require quarterly payments.</p>
          ) : null}
          {(() => {
            const state = quarterly.state.annualized
            const name = state.status === "not_chosen" ? null : stateName(state.stateCode)
            if (state.status === "included") {
              const one = quarterly.state.high - quarterly.state.low < 25
              return (
                <p className="text-sm text-muted-foreground">
                  Plus about{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {one ? wholeDollars.format(quarterly.state.high) : `${wholeDollars.format(quarterly.state.low)}–${wholeDollars.format(quarterly.state.high)}`}
                  </span>{" "}
                  in {name} tax, paid to the state.
                  {state.localTaxNote ? ` ${state.localTaxNote}` : ""}
                </p>
              )
            }
            if (state.status === "none") return <p className="text-sm text-muted-foreground">No state income tax in {name}.</p>
            if (state.status === "not_included") return <p className="text-sm text-muted-foreground">{name} tax isn&apos;t included yet.</p>
            return <p className="text-sm text-muted-foreground">Add your state in Your answers to include state tax.</p>
          })()}
          {(() => {
            const note = tipsNote(quarterly.annualized.estimate.tipsDeductionStatus, profile.occupationCode)
            return note ? <p className="text-sm text-muted-foreground">{note}</p> : null
          })()}
          {quarterly.unsupported.includes("qbi_above_threshold") ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              At your income the business income deduction has extra rules we don&apos;t cover, so this may be high. A tax pro can firm it up.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* What stands between the person and a (better) number */}
      {blockers.length > 0 || warnings.length > 0 ? (
        <ul className={`${showSafeHarbor || showEstimate ? "mt-4" : ""} space-y-2`}>
          {[...blockers, ...warnings].map((issue) => (
            <li key={issue.code} className="flex gap-2 text-sm">
              <AlertCircle className={`mt-0.5 size-4 shrink-0 ${issue.severity === "blocker" ? "text-amber-500" : "text-muted-foreground"}`} aria-hidden="true" />
              <span className="text-foreground">{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!showEstimate && blockers.some((issue) => ["missing_filing_status", "missing_children", "situation_unanswered", "missing_earlier_months"].includes(issue.code)) ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAnswersOpen(true)}>
          Update answers
        </Button>
      ) : null}

      {showEstimate && quarterly ? (
        <>
          <button
            type="button"
            onClick={() => setMathOpen((v) => !v)}
            aria-expanded={mathOpen}
            aria-controls={mathId}
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary"
          >
            Show the math
            <ChevronDown className={`size-4 transition-transform ${mathOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          <Expand open={mathOpen} id={mathId} className="mt-3 space-y-3">
            <ShowTheMath
              estimate={quarterly.annualized.estimate}
              annualizedProfit={quarterly.annualized.profit}
              annualizedWages={quarterly.annualized.w2Wages}
              state={quarterly.state.annualized}
            />
            {quarterly.withholdingCredit > 0 || quarterly.paymentsCredit > 0 ? (
              <dl className="space-y-1.5 border-t border-border/70 pt-3 text-sm">
                {quarterly.withholdingCredit > 0 ? (
                  <MathRow label="Withholding counted by this date" sub="From your pay stub, spread evenly over the year" value={-quarterly.withholdingCredit} />
                ) : null}
                {quarterly.paymentsCredit > 0 ? <MathRow label="Estimated payments you've made" value={-quarterly.paymentsCredit} /> : null}
              </dl>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {quarterly.basis === "period_complete"
                ? `Uses your income through ${dueLabel(quarterly.periodEnd)}, scaled to a year (the IRS annualized income method).`
                : "Uses your income so far this year, scaled to 12 months."}{" "}
              Assumes the standard deduction and no other credits.
            </p>
          </Expand>
        </>
      ) : null}

      {/* Record what was paid, so the card counts it */}
      {quarterly ? (
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => setPaymentsOpen(true)}>I paid</Button>
          <button type="button" onClick={() => setPaymentsOpen(true)} className="text-sm text-muted-foreground hover:text-foreground">
            {data.payments.length === 0
              ? "No payments recorded"
              : `${formatCurrency(paymentsTotal)} paid in ${data.payments.length} ${data.payments.length === 1 ? "payment" : "payments"}`}
          </button>
        </div>
      ) : null}

      {footer}
      {answersSheet}
      {paymentsSheet}
    </section>
  )
}
