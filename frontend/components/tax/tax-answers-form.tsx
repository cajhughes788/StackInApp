"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { saveTaxEstimateProfile } from "@/lib/api/taxEstimateApi"
import type { TaxEstimateProfile, TaxEstimateProfilePatch } from "@shared/schemas/taxEstimateProfile"
import { NO_TIPPED_OCCUPATION, TIPPED_OCCUPATIONS } from "@shared/estimatedTax/tippedOccupations"
import { US_STATES } from "@shared/estimatedTax/states"
import { getEstimatedTaxYear } from "@shared/estimatedTax/years"

// The official list grouped by category, for the line-of-work question.
const OCCUPATION_GROUPS = TIPPED_OCCUPATIONS.reduce<Record<string, typeof TIPPED_OCCUPATIONS>>((groups, occupation) => {
  ;(groups[occupation.category] ??= []).push(occupation)
  return groups
}, {})

// The tax estimate's questions, shown on the Taxes page. Every one is
// required except last year's return, and saving needs the "everything is
// complete" box ticked (each time): the estimate is only as good as the
// answers. Unanswered stays null so the estimate can tell "not answered"
// from "no" — except children and itemizing, which start at the answer
// almost everyone gives (0 and No).
//
// W-2 income: with W-2 workspaces in 521, "Is all of your W-2 income
// recorded in 521?"; without, "Do you have a W-2 job?". Pay not in 521 is a
// yearly amount. The estimate is then the business's share — or, if the
// person enters the tax withheld so far from a pay stub (optional), the
// whole return less that withholding, and last year's return is asked
// again (quarterly.ts).

export type W2Workspaces = {
  workspaces: Array<{ id: string; name: string; projectedPay: number; ytdTips?: number }>
  key: string
}

const FILING_STATUSES: Array<{ value: NonNullable<TaxEstimateProfile["filingStatus"]>; label: string }> = [
  { value: "single", label: "Single" },
  { value: "marriedJoint", label: "Married, filing together" },
  { value: "marriedSeparate", label: "Married, filing separately" },
  { value: "headOfHousehold", label: "Head of household" },
]

type Draft = {
  filingStatus: TaxEstimateProfile["filingStatus"]
  qualifyingChildren: string
  spouseHasIncome: boolean | null
  investmentOrRentalIncome: boolean | null
  itemizesDeductions: boolean | null
  startedThisYear: boolean | null
  businessStartDate: string
  priorYearTax: string
  priorYearAgi: string
  w2AllRecorded: boolean | null
  hasW2Job: boolean | null
  unrecordedW2Pay: string
  unrecordedW2Tips: string
  w2OccupationCode: string
  ytdWithholding: string
  withholdingAsOf: string
  confirmed: boolean
  remindersEnabled: boolean
  occupationCode: string
  stateCode: string
}

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const formatWholeDollars = (value: number) => wholeDollars.format(value)

const money = (value: number | null | undefined) => (value == null ? "" : String(value))

function toDraft(profile: TaxEstimateProfile, suggestedStateCode: string | null, w2Key: string): Draft {
  // An answer about a different set of W-2 workspaces is asked again.
  const w2AllRecorded = profile.w2WorkspaceKey === w2Key ? profile.w2AllRecorded : null
  return {
    filingStatus: profile.filingStatus,
    qualifyingChildren: profile.qualifyingChildren == null ? "0" : String(profile.qualifyingChildren),
    spouseHasIncome: profile.spouseHasIncome,
    investmentOrRentalIncome: profile.investmentOrRentalIncome,
    itemizesDeductions: profile.itemizesDeductions ?? false,
    startedThisYear: profile.businessStartDate ? true : profile.updatedAt ? false : null,
    businessStartDate: profile.businessStartDate ?? "",
    priorYearTax: money(profile.priorYearTax),
    priorYearAgi: money(profile.priorYearAgi),
    w2AllRecorded,
    hasW2Job: profile.hasW2Job,
    unrecordedW2Pay: w2AllRecorded === false || profile.hasW2Job ? money(profile.unrecordedW2Pay) : "",
    unrecordedW2Tips: w2AllRecorded === false || profile.hasW2Job ? money(profile.unrecordedW2Tips) : "",
    // Most people's job is the same line of work as their business.
    w2OccupationCode: profile.w2OccupationCode ?? profile.occupationCode ?? "",
    ytdWithholding: money(profile.ytdWithholding),
    withholdingAsOf: profile.withholdingAsOf ?? "",
    // Ticked again on every save.
    confirmed: false,
    remindersEnabled: profile.remindersEnabled,
    occupationCode: profile.occupationCode ?? "",
    stateCode: profile.stateCode ?? suggestedStateCode ?? "",
  }
}

function parseMoney(value: string): number | null {
  const trimmed = value.replace(/[$,\s]/g, "")
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

function YesNo({
  value,
  onChange,
  label,
  info,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  label: string
  // Shown behind an (i) next to the question.
  info?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">
        {label}
        {info ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`About: ${label}`}
                className="ml-1 inline-flex size-5 translate-y-[3px] items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <Info className="size-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-72 space-y-2 text-sm">
              {info}
            </PopoverContent>
          </Popover>
        ) : null}
      </span>
      <div className="flex shrink-0 rounded-full bg-muted p-0.5" role="group" aria-label={label}>
        {[true, false].map((option) => (
          <button
            key={String(option)}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              value === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-[22px] border border-card-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function TaxAnswersForm({
  profile,
  w2,
  hasTips,
  suggestedStateCode,
  onSaved,
}: {
  profile: TaxEstimateProfile
  // The person's W-2 workspaces in 521 (none = the "W-2 job?" question).
  w2: W2Workspaces
  // Tips are recorded this year — ask the line of work for the tips deduction.
  hasTips: boolean
  // From a W-2 paycheck tax profile, to pre-fill the state question.
  suggestedStateCode: string | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile, suggestedStateCode, w2.key))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const year = profile.taxYear
  const showOccupation = hasTips || profile.occupationCode != null
  const singleStandardDeduction = getEstimatedTaxYear(year)?.federal.single.standardDeduction ?? null

  // Reset only when the saved answers change, not on every refetch of the
  // estimate (a new record refetches it), so typing isn't wiped.
  const savedKey = `${profile.taxYear}:${profile.updatedAt ?? ""}:${w2.key}`
  const hasW2Workspace = w2.workspaces.length > 0
  const asksUnrecordedPay = hasW2Workspace ? draft.w2AllRecorded === false : draft.hasW2Job === true
  const hasW2 = hasW2Workspace || draft.hasW2Job === true
  // Last year's tax covers the whole return, job included: with W-2 pay it's
  // only used when the pay stub's withholding is entered (quarterly.ts).
  const withholdingEntered = hasW2 && draft.ytdWithholding.trim() !== ""
  // W-2 tips (recorded, or in pay not recorded): ask the job's line of work.
  const recordedW2Tips = w2.workspaces.reduce((sum, w) => sum + (w.ytdTips ?? 0), 0)
  const hasW2Tips = (hasW2Workspace && recordedW2Tips > 0) || (asksUnrecordedPay && (parseMoney(draft.unrecordedW2Tips) ?? 0) > 0)
  const asksLastYear = !hasW2 || withholdingEntered
  useEffect(() => {
    setDraft(toDraft(profile, suggestedStateCode, w2.key))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, suggestedStateCode])

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }))

  // The first missing or invalid answer, in the order the form asks them.
  function problem(children: number | null, amounts: Record<string, number | null>): string | null {
    if (!draft.filingStatus) return "Choose how you file."
    if (!draft.stateCode) return "Choose the state you live in."
    if (children == null || !Number.isInteger(children) || children < 0 || children > 20) {
      return "Enter the number of children you claim as a whole number (0 if none)."
    }
    if (hasW2Workspace ? draft.w2AllRecorded == null : draft.hasW2Job == null) {
      return hasW2Workspace ? "Answer whether all of your W-2 income is recorded in 521." : "Answer whether you have a W-2 job."
    }
    if (asksUnrecordedPay && !(amounts.unrecordedW2Pay != null && amounts.unrecordedW2Pay > 0)) {
      return hasW2Workspace ? "Enter about how much W-2 pay a year isn't recorded in 521." : "Enter about how much your W-2 job pays a year."
    }
    if (amounts.unrecordedW2Tips != null && amounts.unrecordedW2Pay != null && amounts.unrecordedW2Tips > amounts.unrecordedW2Pay) {
      return "The tips can't be more than the W-2 pay they're part of."
    }
    if (hasW2Tips && !draft.w2OccupationCode) return "Choose your line of work at your W-2 job — you have W-2 tips."
    if (draft.filingStatus === "marriedJoint" && draft.spouseHasIncome == null) return "Answer whether your spouse has income."
    if (draft.investmentOrRentalIncome == null) return "Answer whether you have investment, rental or other side income."
    if (draft.itemizesDeductions == null) return "Answer whether you itemize personal deductions."
    if (draft.startedThisYear == null) return `Answer whether your business started after Jan 1, ${year}.`
    if (draft.startedThisYear && !draft.businessStartDate.startsWith(`${year}-`)) return `Pick the date in ${year} your business started.`
    if (hasTips && !draft.occupationCode) return "Choose your line of work — you have tips recorded."
    if (amounts.ytdWithholding != null && !Number.isNaN(amounts.ytdWithholding) && !draft.withholdingAsOf.startsWith(`${year}-`)) {
      return "Add the pay stub's date so we know how far into the year it covers."
    }
    if (Object.values(amounts).some((value) => Number.isNaN(value))) return "Amounts should be dollar figures, like 4,250."
    if (!draft.confirmed) return "Tick the box to confirm your answers are complete."
    return null
  }

  async function save() {
    const children = draft.qualifyingChildren.trim() === "" ? null : Number(draft.qualifyingChildren)
    const amounts = {
      priorYearTax: asksLastYear ? parseMoney(draft.priorYearTax) : null,
      priorYearAgi: asksLastYear ? parseMoney(draft.priorYearAgi) : null,
      unrecordedW2Pay: asksUnrecordedPay ? parseMoney(draft.unrecordedW2Pay) : null,
      unrecordedW2Tips: asksUnrecordedPay ? parseMoney(draft.unrecordedW2Tips) : null,
      ytdWithholding: withholdingEntered ? parseMoney(draft.ytdWithholding) : null,
    }
    const firstProblem = problem(children, amounts)
    if (firstProblem) {
      setError(firstProblem)
      return
    }
    const patch: TaxEstimateProfilePatch = {
      filingStatus: draft.filingStatus,
      qualifyingChildren: children,
      spouseHasIncome: draft.filingStatus === "marriedJoint" ? draft.spouseHasIncome : false,
      investmentOrRentalIncome: draft.investmentOrRentalIncome,
      itemizesDeductions: draft.itemizesDeductions,
      businessStartDate: draft.startedThisYear ? draft.businessStartDate : null,
      priorYearTax: amounts.priorYearTax,
      priorYearAgi: amounts.priorYearAgi,
      ytdWithholding: amounts.ytdWithholding,
      withholdingAsOf: amounts.ytdWithholding != null ? draft.withholdingAsOf : null,
      w2AllRecorded: hasW2Workspace ? draft.w2AllRecorded : null,
      hasW2Job: hasW2Workspace ? null : draft.hasW2Job,
      unrecordedW2Pay: amounts.unrecordedW2Pay,
      unrecordedW2Tips: amounts.unrecordedW2Tips,
      ...(hasW2Tips ? { w2OccupationCode: draft.w2OccupationCode || null } : {}),
      w2WorkspaceKey: w2.key,
      confirmedComplete: true,
      remindersEnabled: draft.remindersEnabled,
      ...(showOccupation ? { occupationCode: draft.occupationCode || null } : {}),
      stateCode: draft.stateCode || null,
    }
    setSaving(true)
    setError(null)
    try {
      await saveTaxEstimateProfile(patch)
      toast({ title: "Answers saved" })
      onSaved()
    } catch {
      toast({ title: "Couldn't save your answers", description: "Please try again.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Section title="How you file">
        <div className="grid grid-cols-2 gap-2">
          {FILING_STATUSES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.filingStatus === value}
              onClick={() => update("filingStatus", value)}
              className={`rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                draft.filingStatus === value ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="tax-state" className="font-normal">State you live in</Label>
          <select
            id="tax-state"
            value={draft.stateCode}
            onChange={(e) => update("stateCode", e.target.value)}
            className="w-44 rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
          >
            <option value="">Choose…</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>{state.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="tax-children" className="font-normal">Children you claim (under 17)</Label>
          <Input
            id="tax-children"
            inputMode="numeric"
            className="w-20 text-right"
            placeholder="0"
            value={draft.qualifyingChildren}
            onChange={(e) => update("qualifyingChildren", e.target.value)}
          />
        </div>
      </Section>

      <Section title="Your W-2 income" hint="Include every job that gives you a W-2, even part-time or seasonal ones.">
        {hasW2Workspace ? (
          <>
            <YesNo
              label="Is all of your W-2 income recorded in 521?"
              value={draft.w2AllRecorded}
              onChange={(v) => update("w2AllRecorded", v)}
            />
            <p className="text-xs text-muted-foreground">
              We found:{" "}
              {w2.workspaces
                .map((w) => `${w.name || "W-2 workspace"} (about ${formatWholeDollars(w.projectedPay)} this year)`)
                .join(", ")}
            </p>
          </>
        ) : (
          <YesNo label="Do you have a W-2 job?" value={draft.hasW2Job} onChange={(v) => update("hasW2Job", v)} />
        )}
        {asksUnrecordedPay ? (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tax-w2-pay" className="font-normal">
              {hasW2Workspace ? "About how much W-2 pay a year isn't recorded in 521?" : "About how much does it pay a year?"}
            </Label>
            <Input
              id="tax-w2-pay"
              inputMode="decimal"
              className="w-32 text-right"
              placeholder="$0"
              value={draft.unrecordedW2Pay}
              onChange={(e) => update("unrecordedW2Pay", e.target.value)}
            />
          </div>
        ) : null}
        {asksUnrecordedPay ? (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tax-w2-tips" className="font-normal">
              About how much of that is tips you reported to your employer?
            </Label>
            <Input
              id="tax-w2-tips"
              inputMode="decimal"
              className="w-32 text-right"
              placeholder="$0"
              value={draft.unrecordedW2Tips}
              onChange={(e) => update("unrecordedW2Tips", e.target.value)}
            />
          </div>
        ) : null}
        {hasW2Tips ? (
          <div className="space-y-1.5">
            <Label htmlFor="tax-w2-occupation" className="font-normal">Your line of work at your W-2 job</Label>
            <select
              id="tax-w2-occupation"
              value={draft.w2OccupationCode}
              onChange={(e) => update("w2OccupationCode", e.target.value)}
              className="w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="">Choose your line of work…</option>
              {Object.entries(OCCUPATION_GROUPS).map(([category, occupations]) => (
                <optgroup key={category} label={category}>
                  {occupations.map((occupation) => (
                    <option key={occupation.code} value={occupation.code}>{occupation.title}</option>
                  ))}
                </optgroup>
              ))}
              <option value={NO_TIPPED_OCCUPATION}>None of these, or my employer says my tips don&apos;t qualify</option>
            </select>
            <p className="text-xs text-muted-foreground">
              For the no-tax-on-tips deduction on your W-2 tips. Your employer reports this on your W-2 (Box 14b; &quot;000&quot;
              means your tips don&apos;t qualify). Ask payroll if you&apos;re unsure.
            </p>
          </div>
        ) : null}
        {hasW2 ? (
          <div className="space-y-3 border-t border-border/70 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">Federal tax withheld so far (optional)</p>
              <p className="text-xs text-muted-foreground">
                From your latest pay stub, year to date — add up every W-2 job. Without it, we assume your jobs withhold
                the right amount for your job pay. With it, we use your real withholding.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tax-withheld" className="font-normal">Federal tax withheld this year</Label>
              <Input
                id="tax-withheld"
                inputMode="decimal"
                className="w-32 text-right"
                placeholder="$0"
                value={draft.ytdWithholding}
                onChange={(e) => update("ytdWithholding", e.target.value)}
              />
            </div>
            {withholdingEntered ? (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="tax-withheld-date" className="font-normal">Pay stub date</Label>
                <Input
                  id="tax-withheld-date"
                  type="date"
                  className="w-44"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  value={draft.withholdingAsOf}
                  onChange={(e) => update("withholdingAsOf", e.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title="Three quick questions" hint="Most people say No. A Yes makes the estimate rough, or means a tax pro should give you the exact number.">
        {draft.filingStatus === "marriedJoint" ? (
          <YesNo label="Does your spouse have income?" value={draft.spouseHasIncome} onChange={(v) => update("spouseHasIncome", v)} />
        ) : null}
        <YesNo label="Investment, rental or other side income?" value={draft.investmentOrRentalIncome} onChange={(v) => update("investmentOrRentalIncome", v)} />
        <YesNo
          label="Do you itemize personal deductions?"
          value={draft.itemizesDeductions}
          onChange={(v) => update("itemizesDeductions", v)}
          info={
            <>
              <p className="font-medium text-foreground">Most people say No.</p>
              <p className="text-muted-foreground">
                Personal deductions are things like mortgage interest, charity and medical bills. They are not your
                business expenses; we already subtract those to get your profit.
              </p>
              <p className="text-muted-foreground">
                You only itemize if your personal costs add up to more than the standard deduction
                {singleStandardDeduction != null ? ` (${formatWholeDollars(singleStandardDeduction)} if single in ${year})` : ""}.
              </p>
            </>
          }
        />
        <YesNo label={`Did your business start after Jan 1, ${year}?`} value={draft.startedThisYear} onChange={(v) => update("startedThisYear", v)} />
        {draft.startedThisYear ? (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tax-start" className="font-normal">Start date</Label>
            <Input
              id="tax-start"
              type="date"
              className="w-44"
              min={`${year}-01-02`}
              max={`${year}-12-31`}
              value={draft.businessStartDate}
              onChange={(e) => update("businessStartDate", e.target.value)}
            />
          </div>
        ) : null}
      </Section>

      {showOccupation ? (
        <Section
          title="Your line of work"
          hint={`Tips in jobs on the IRS list can be deducted from income tax (up to $25,000) through 2028.`}
        >
          <select
            aria-label="Your line of work"
            value={draft.occupationCode}
            onChange={(e) => update("occupationCode", e.target.value)}
            className="w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-foreground"
          >
            <option value="">Choose your line of work…</option>
            {Object.entries(OCCUPATION_GROUPS).map(([category, occupations]) => (
              <optgroup key={category} label={category}>
                {occupations.map((occupation) => (
                  <option key={occupation.code} value={occupation.code}>{occupation.title}</option>
                ))}
              </optgroup>
            ))}
            <option value={NO_TIPPED_OCCUPATION}>None of these</option>
          </select>
        </Section>
      ) : null}

      {asksLastYear ? (
        <Section
          title="Last year's return (optional)"
          hint="With these we can tell you exactly what to pay to avoid an IRS penalty."
        >
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tax-prior" className="font-normal">Total tax ({year - 1} Form 1040, line 24)</Label>
            <Input id="tax-prior" inputMode="decimal" className="w-32 text-right" placeholder="$0" value={draft.priorYearTax} onChange={(e) => update("priorYearTax", e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tax-prior-agi" className="font-normal">Adjusted gross income (line 11)</Label>
            <Input id="tax-prior-agi" inputMode="decimal" className="w-32 text-right" placeholder="$0" value={draft.priorYearAgi} onChange={(e) => update("priorYearAgi", e.target.value)} />
          </div>
        </Section>
      ) : null}

      <Section title="Reminders">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="tax-reminders" className="font-normal">
              Remind me a week before each due date
            </Label>
            <p className="text-xs text-muted-foreground">And on the day, if no payment is recorded.</p>
          </div>
          <Switch id="tax-reminders" checked={draft.remindersEnabled} onCheckedChange={(v) => update("remindersEnabled", v)} />
        </div>
      </Section>

      <label htmlFor="tax-confirm" className="flex items-start gap-3 rounded-[22px] border border-card-border bg-card p-5 text-sm text-foreground">
        <Checkbox
          id="tax-confirm"
          className="mt-0.5 size-5"
          checked={draft.confirmed}
          onCheckedChange={(v) => update("confirmed", v === true)}
        />
        <span>I&apos;ve answered every question for my whole tax return and recorded all my income in 521.</span>
      </label>

      {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}

      <Button className="w-full" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save answers"}
      </Button>
    </div>
  )
}
