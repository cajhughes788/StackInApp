"use client"

import { useId, useState } from "react"
import { AlertCircle, ChevronDown, Landmark } from "lucide-react"

import Expand from "@/components/expand"
import TaxPaymentsSheet, { IRS_PAYMENTS_URL } from "@/components/tax/tax-payments-sheet"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { saveTaxEstimateProfile } from "@/lib/api/taxEstimateApi"
import { formatCurrency } from "@/lib/helpers"
import { useTaxEstimate } from "@/components/tax/use-tax-estimate"
import type { FederalEstimate, TipsDeductionStatus } from "@shared/estimatedTax/calculate"
import { taxHeadline } from "@shared/estimatedTax/headline"
import { PROFILE_CODES } from "@shared/estimatedTax/dataHealth"
import { findTippedOccupation } from "@shared/estimatedTax/tippedOccupations"
import { stateName, type StateTaxResult } from "@shared/estimatedTax/states"

// The Taxes page's estimate card for self-employed workspaces
// (shared/estimatedTax). The answers form sits below it on the page;
// onEditAnswers takes the person there.
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
  job,
}: {
  estimate: FederalEstimate
  annualizedProfit: number
  annualizedWages: number
  state: StateTaxResult
  // With W-2 pay: the job's own tax (its paychecks cover it) and the rest.
  job: { jobOnlyTax: number; businessAdds: number } | null
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
      {l.tipsDeduction > 0 ? <MathRow label="No tax on tips deduction" sub="Qualifying business and W-2 tips, up to $25,000" value={-l.tipsDeduction} /> : null}
      <MathRow label="Business income deduction (QBI)" sub="20% of business income, limited" value={-l.qbiDeduction} />
      <MathRow label="Taxable income" value={l.taxableIncome} />
      <MathRow label="Income tax" sub={`From the ${estimate.year} brackets (top rate ${pct(estimate.marginalRate)})`} value={l.incomeTaxBeforeCredits} />
      {l.childTaxCredit > 0 ? <MathRow label="Child tax credit" value={-l.childTaxCredit} /> : null}
      <MathRow label={job ? "Federal tax for the year, job and business" : "Federal tax for the year"} value={estimate.totalTax} strong />
      {job ? (
        <>
          <MathRow label="Tax on your job alone" sub="Your W-2 paychecks already cover this" value={-job.jobOnlyTax} />
          <MathRow label="Your business adds" value={job.businessAdds} strong />
        </>
      ) : null}
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

export default function TaxEstimateCard({
  className = "",
  onEditAnswers,
}: {
  className?: string
  onEditAnswers: () => void
}) {
  const { data, status, refresh } = useTaxEstimate()
  const { toast } = useToast()
  const [savingStart, setSavingStart] = useState(false)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [mathOpen, setMathOpen] = useState(false)
  const mathId = useId()

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
  // "Your records start Jun 2": one tap answers "my business started then".
  const firstRecordDate = data.firstRecordDate ?? null
  const markStartedAtFirstRecord = async () => {
    if (!firstRecordDate) return
    setSavingStart(true)
    try {
      await saveTaxEstimateProfile({ businessStartDate: firstRecordDate })
      refresh()
    } catch {
      toast({ title: "Couldn't save that", description: "Please try again.", variant: "destructive" })
    } finally {
      setSavingStart(false)
    }
  }
  const header = (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Landmark className="size-4" aria-hidden="true" />
        Taxes · {taxYear}
      </h2>
      {profile.updatedAt ? (
        <button type="button" onClick={onEditAnswers} className="text-sm font-medium text-primary">
          Your answers
        </button>
      ) : null}
    </div>
  )
  // What leads the card (shared with the reminder push).
  const lead = taxHeadline(health, quarterly)
  const stateCovered =
    quarterly?.state.annualized.status === "included" || quarterly?.state.annualized.status === "none"
  const footer = (
    <p className="mt-4 text-xs text-muted-foreground">
      Estimate based on your answers and records ·{" "}
      {stateCovered
        ? lead?.kind === "penalty_free"
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
  const yearTarget =
    quarterly && targetBasis != null ? Math.max(0, targetBasis - (quarterly.withholding?.annual ?? 0)) : null
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
        <p className="text-lg font-semibold text-foreground">We can&apos;t estimate your taxes yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Answer every question below first. Missing or wrong answers mean a wrong estimate.
        </p>
        <Button className="mt-4" onClick={onEditAnswers}>Answer the questions</Button>
      </section>
    )
  }

  const showSafeHarbor = lead?.kind === "penalty_free"
  const showEstimate = health.canShowEstimate && quarterly != null
  const due = quarterly ? dueLabel(quarterly.dueDate) : null
  const showEarningsLine =
    showEstimate && quarterly && !quarterly.belowEstimatesThreshold &&
    (quarterly.penaltyFree == null || quarterly.basedOnEarnings < quarterly.penaltyFree - 0.5)
  const rangeIsOne = quarterly ? quarterly.range.high - quarterly.range.low < 50 : false
  const job = quarterly?.job ?? null
  const withheld = quarterly?.withholding ?? null
  // W-2 tips counted toward the tips deduction (the job's line of work is on the list).
  const w2TipsCounted =
    ((data.w2?.workspaces.reduce((sum, w) => sum + (w.ytdTips ?? 0), 0) ?? 0) > 0 || (profile.unrecordedW2Tips ?? 0) > 0) &&
    !!profile.w2OccupationCode &&
    profile.w2OccupationCode !== "none"
  // Answers still missing: the estimate is paused until they're given.
  const missingAnswers = blockers.filter((issue) => PROFILE_CODES.includes(issue.code))

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
          ) : Math.ceil(quarterly.basedOnEarnings) === 0 ? (
            <>
              <p className="text-2xl font-semibold tracking-tight text-foreground">Nothing more to set aside by {due}</p>
              <p className="text-sm text-muted-foreground">Your payments cover it so far.</p>
            </>
          ) : (
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              Set aside about <span className="tabular-nums">{wholeDollars.format(Math.ceil(quarterly.basedOnEarnings))}</span> by {due}
            </p>
          )}
          <p className="text-sm font-medium text-foreground">
            Based on your answers and the records in 521. If any income or expenses are missing, this number is wrong.
          </p>
          <p className="text-sm text-muted-foreground">
            {job ? "Your business adds about " : withheld ? "In all, job and business, you'll likely owe " : "You'll likely owe "}
            <span className="font-medium tabular-nums text-foreground">
              {rangeIsOne
                ? wholeDollars.format(quarterly.range.high)
                : `${wholeDollars.format(quarterly.range.low)}–${wholeDollars.format(quarterly.range.high)}`}
            </span>{" "}
            in federal tax for {taxYear}
            {rangeIsOne ? "." : ", depending on whether the rest of the year looks like the year so far or the last three months."}
          </p>
          {job ? (
            <p className="text-sm text-muted-foreground">Your W-2 paychecks already cover the tax on your job pay.</p>
          ) : null}
          {withheld ? (
            <p className="text-sm text-muted-foreground">
              Your paychecks will withhold about{" "}
              <span className="font-medium tabular-nums text-foreground">{wholeDollars.format(withheld.annual)}</span> of
              that this year, from the pay stub you entered; we&apos;ve subtracted it.
            </p>
          ) : null}
          {job || withheld ? (
            <p className="text-sm text-muted-foreground">
              You can also cover this by asking your employer to withhold more (a new W-4).
            </p>
          ) : null}
          {quarterly.belowEstimatesThreshold ? (
            <p className="text-sm text-muted-foreground">
              {job ? "Your business adds under $1,000" : withheld ? "Under $1,000 is left after withholding" : "Under $1,000 owed"}, so
              the IRS doesn&apos;t require quarterly payments.
            </p>
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
                  in {name} tax{job ? " from your business" : ""}, paid to the state.
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
          {w2TipsCounted ? (
            <p className="text-sm text-muted-foreground">
              The tips deduction includes your W-2 tips. It depends on what your employer reports on your W-2 (Box 14b).
            </p>
          ) : null}
          {quarterly.unsupported.includes("qbi_above_threshold") ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              At your income the business income deduction shrinks unless your business pays employees or owns significant property. We assumed it doesn&apos;t, so if it does, this may be a little high. A tax pro can firm it up.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* What stands between the person and a (better) number */}
      {missingAnswers.length > 0 ? (
        <div className={showSafeHarbor || showEstimate ? "mt-4" : ""}>
          <p className="text-lg font-semibold text-foreground">Your estimate is paused.</p>
          <p className="mb-2 mt-1 text-sm text-muted-foreground">
            We need {missingAnswers.length} more {missingAnswers.length === 1 ? "answer" : "answers"} before we can estimate your taxes:
          </p>
        </div>
      ) : null}
      {blockers.length > 0 || warnings.length > 0 ? (
        <ul className={`${showSafeHarbor || showEstimate ? "mt-4" : ""} space-y-2`}>
          {[...blockers, ...warnings].map((issue) => (
            <li key={issue.code} className="flex gap-2 text-sm">
              <AlertCircle className={`mt-0.5 size-4 shrink-0 ${issue.severity === "blocker" ? "text-amber-500" : "text-muted-foreground"}`} aria-hidden="true" />
              <span className="min-w-0 text-foreground">
                {issue.message}
                {issue.code === "missing_earlier_months" && firstRecordDate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 flex"
                    onClick={markStartedAtFirstRecord}
                    disabled={savingStart}
                  >
                    {savingStart ? "Saving…" : `My business started ${dueLabel(firstRecordDate)}`}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!showEstimate && blockers.some((issue) => PROFILE_CODES.includes(issue.code) || issue.code === "missing_earlier_months") ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onEditAnswers}>
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
              job={job}
            />
            {(withheld?.credit ?? 0) > 0 || quarterly.paymentsCredit > 0 ? (
              <dl className="space-y-1.5 border-t border-border/70 pt-3 text-sm">
                {withheld && withheld.credit > 0 ? (
                  <MathRow label="Withholding counted by this date" sub="From your pay stub, spread evenly over the year" value={-withheld.credit} />
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
      {paymentsSheet}
    </section>
  )
}
