"use client"

import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { saveTaxEstimateProfile } from "@/lib/api/taxEstimateApi"
import type { TaxEstimateProfile, TaxEstimateProfilePatch } from "@shared/schemas/taxEstimateProfile"
import { NO_TIPPED_OCCUPATION, TIPPED_OCCUPATIONS } from "@shared/estimatedTax/tippedOccupations"
import { US_STATES } from "@shared/estimatedTax/states"

// The official list grouped by category, for the line-of-work question.
const OCCUPATION_GROUPS = TIPPED_OCCUPATIONS.reduce<Record<string, typeof TIPPED_OCCUPATIONS>>((groups, occupation) => {
  ;(groups[occupation.category] ??= []).push(occupation)
  return groups
}, {})

// The tax estimate's one-time questions (about a minute). Unanswered stays
// null so the estimate can tell "not answered" from "no". Everything about
// last year and withholding is optional: it only sharpens the numbers.

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
  ytdWithholding: string
  withholdingAsOf: string
  remindersEnabled: boolean
  occupationCode: string
  stateCode: string
}

const money = (value: number | null | undefined) => (value == null ? "" : String(value))

function toDraft(profile: TaxEstimateProfile, suggestedStateCode: string | null): Draft {
  return {
    filingStatus: profile.filingStatus,
    qualifyingChildren: profile.qualifyingChildren == null ? "" : String(profile.qualifyingChildren),
    spouseHasIncome: profile.spouseHasIncome,
    investmentOrRentalIncome: profile.investmentOrRentalIncome,
    itemizesDeductions: profile.itemizesDeductions,
    startedThisYear: profile.businessStartDate ? true : profile.updatedAt ? false : null,
    businessStartDate: profile.businessStartDate ?? "",
    priorYearTax: money(profile.priorYearTax),
    priorYearAgi: money(profile.priorYearAgi),
    ytdWithholding: money(profile.ytdWithholding),
    withholdingAsOf: profile.withholdingAsOf ?? "",
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

function YesNo({ value, onChange, label }: { value: boolean | null; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
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
    <section className="space-y-3 rounded-2xl bg-muted/60 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function TaxAnswersSheet({
  open,
  onOpenChange,
  profile,
  hasW2Income,
  hasTips,
  suggestedStateCode,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: TaxEstimateProfile
  hasW2Income: boolean
  // Tips are recorded this year — ask the line of work for the tips deduction.
  hasTips: boolean
  // From a W-2 paycheck tax profile, to pre-fill the state question.
  suggestedStateCode: string | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile, suggestedStateCode))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const year = profile.taxYear
  const showOccupation = hasTips || profile.occupationCode != null

  useEffect(() => {
    if (open) {
      setDraft(toDraft(profile, suggestedStateCode))
      setError(null)
    }
  }, [open, profile, suggestedStateCode])

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }))

  async function save() {
    const children = draft.qualifyingChildren.trim() === "" ? null : Number(draft.qualifyingChildren)
    const amounts = {
      priorYearTax: parseMoney(draft.priorYearTax),
      priorYearAgi: parseMoney(draft.priorYearAgi),
      ytdWithholding: parseMoney(draft.ytdWithholding),
    }
    if (children != null && (!Number.isInteger(children) || children < 0 || children > 20)) {
      setError("Enter the number of children as a whole number.")
      return
    }
    if (Object.values(amounts).some((value) => Number.isNaN(value))) {
      setError("Amounts should be dollar figures, like 4,250.")
      return
    }
    if (draft.startedThisYear && !draft.businessStartDate.startsWith(`${year}-`)) {
      setError(`Pick the date in ${year} your business started.`)
      return
    }
    if (amounts.ytdWithholding != null && !draft.withholdingAsOf) {
      setError("Add the pay stub's date so we know how far into the year it covers.")
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
      remindersEnabled: draft.remindersEnabled,
      ...(showOccupation ? { occupationCode: draft.occupationCode || null } : {}),
      stateCode: draft.stateCode || null,
    }
    setSaving(true)
    setError(null)
    try {
      await saveTaxEstimateProfile(patch)
      onSaved()
      onOpenChange(false)
    } catch {
      toast({ title: "Couldn't save your answers", description: "Please try again.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92vh] max-w-lg flex-col gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-3 pt-1">
          <SheetTitle className="text-lg">Your tax answers</SheetTitle>
          <SheetDescription>
            About a minute. Used only to estimate your {year} federal tax; you can change them any time.
          </SheetDescription>
        </SheetHeader>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 pb-3">
          <Section title="How you file">
            <div className="grid grid-cols-2 gap-2">
              {FILING_STATUSES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.filingStatus === value}
                  onClick={() => update("filingStatus", value)}
                  className={`rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                    draft.filingStatus === value ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-secondary"
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

          <Section title="Three quick questions" hint="A yes means your situation needs a tax pro for an exact number.">
            {draft.filingStatus === "marriedJoint" ? (
              <YesNo label="Does your spouse have income?" value={draft.spouseHasIncome} onChange={(v) => update("spouseHasIncome", v)} />
            ) : null}
            <YesNo label="Investment, rental or other side income?" value={draft.investmentOrRentalIncome} onChange={(v) => update("investmentOrRentalIncome", v)} />
            <YesNo label="Do you itemize deductions?" value={draft.itemizesDeductions} onChange={(v) => update("itemizesDeductions", v)} />
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

          {hasW2Income ? (
            <Section
              title={`W-2 withholding in ${year} (optional)`}
              hint="From a real pay stub, so tax your job already takes out is counted."
            >
              <>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="tax-withheld" className="font-normal">Federal tax withheld (year to date, from your latest pay stub)</Label>
                  <Input id="tax-withheld" inputMode="decimal" className="w-32 text-right" placeholder="$0" value={draft.ytdWithholding} onChange={(e) => update("ytdWithholding", e.target.value)} />
                </div>
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
              </>
            </Section>
          ) : null}

          <Section title="Reminders">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tax-reminders" className="font-normal">
                Remind me a week before each due date
                <span className="block text-xs text-muted-foreground">And on the day, if no payment is recorded.</span>
              </Label>
              <Switch id="tax-reminders" checked={draft.remindersEnabled} onCheckedChange={(v) => update("remindersEnabled", v)} />
            </div>
          </Section>

          {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
        </div>

        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save answers"}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
