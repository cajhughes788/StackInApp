"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { TaxProfile } from "@shared/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { StateDropdown } from "./StateDropdown";
import { useToast } from "@/hooks/use-toast";
import * as taxProfileService from "@/lib/domain/taxProfileService";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";

type TaxProfileDraft = Partial<TaxProfile.InputType>;

const EMPTY_FORM: TaxProfileDraft = {
  dependents: 0,
  insurancePreTax: false,
  multiStateWorker: false,
  state: "",
  localTaxJurisdictionIds: [],
};

type StepId =
  | "filing_status"
  | "dependents"
  | "primary_state"
  | "multi_state"
  | "residence_state"
  | "work_state"
  | "arkansas_withholding"
  | "alabama_tax_details"
  | "delaware_withholding"
  | "colorado_deduction"
  | "idaho_tax_details"
  | "kentucky_info"
  | "maine_withholding"
  | "michigan_exemptions"
  | "louisiana_withholding"
  | "mississippi_withholding"
  | "missouri_withholding"
  | "minnesota_withholding"
  | "north_carolina_withholding"
  | "north_dakota_info"
  | "rhode_island_withholding"
  | "south_carolina_withholding"
  | "district_of_columbia_withholding"
  | "vermont_withholding"
  | "west_virginia_withholding"
  | "wisconsin_withholding"
  | "utah_info"
  | "arizona_withholding"
  | "california_withholding"
  | "connecticut_withholding"
  | "illinois_allowances"
  | "georgia_withholding"
  | "new_jersey_withholding"
  | "virginia_withholding"
  | "massachusetts_withholding"
  | "hawaii_withholding"
  | "iowa_withholding"
  | "kansas_withholding"
  | "oklahoma_withholding"
  | "new_mexico_withholding"
  | "montana_withholding"
  | "nebraska_withholding"
  | "maryland_withholding"
  | "indiana_withholding"
  | "ohio_tax_details"
  | "new_york_withholding"
  | "oregon_tax_details"
  | "pennsylvania_local_tax"
  | "location_local_details"
  | "washington_payroll_programs"
  | "federal_exempt"
  | "w4_details_gate"
  | "federal_multiple_jobs"
  | "federal_step3_credits"
  | "federal_other_income"
  | "federal_deductions"
  | "pre_tax_deductions"
  | "extra_withholding";

type StepDefinition = {
  id: StepId;
  title: string;
  description?: string;
  skippable: boolean;
};

const STEP_DEFINITIONS: Record<StepId, StepDefinition> = {
  filing_status: {
    id: "filing_status",
    title: "Filing status",
    description: "Choose the filing status you use for payroll withholding.",
    skippable: false,
  },
  dependents: {
    id: "dependents",
    title: "Dependents",
    description: "Dependents start at zero, and you can adjust them if needed.",
    skippable: false,
  },
  primary_state: {
    id: "primary_state",
    title: "Primary state",
    description: "Choose the main state used for your paycheck withholding estimate.",
    skippable: false,
  },
  multi_state: {
    id: "multi_state",
    title: "Multi-state work",
    description: "Turn this on only if your home state and work state are different.",
    skippable: true,
  },
  residence_state: {
    id: "residence_state",
    title: "Residence state",
    description: "Choose the state where you live.",
    skippable: false,
  },
  work_state: {
    id: "work_state",
    title: "Work state",
    description: "Choose the state where you physically work.",
    skippable: false,
  },
  arkansas_withholding: {
    id: "arkansas_withholding",
    title: "Arkansas AR4EC withholding",
    description: "Add your Arkansas exemptions or low-income election only if they apply.",
    skippable: true,
  },
  alabama_tax_details: {
    id: "alabama_tax_details",
    title: "Alabama tax details",
    description: "Add your Alabama A-4 code only if you filled it out.",
    skippable: true,
  },
  delaware_withholding: {
    id: "delaware_withholding",
    title: "Delaware W-4 withholding",
    description: "Add your Delaware allowance count only if you filled it out.",
    skippable: true,
  },
  colorado_deduction: {
    id: "colorado_deduction",
    title: "Colorado DR 0004 withholding",
    description: "Add your Colorado annual deduction amount only if you filed DR 0004.",
    skippable: true,
  },
  idaho_tax_details: {
    id: "idaho_tax_details",
    title: "Idaho tax details",
    description: "Add your Idaho allowances, extra withholding, or exempt election if they apply.",
    skippable: true,
  },
  kentucky_info: {
    id: "kentucky_info",
    title: "Kentucky withholding rules",
    description: "Kentucky usually does not need extra state-specific inputs here.",
    skippable: true,
  },
  maine_withholding: {
    id: "maine_withholding",
    title: "Maine W-4ME withholding",
    description: "Add your Maine allowances or married single-rate election only if they apply.",
    skippable: true,
  },
  michigan_exemptions: {
    id: "michigan_exemptions",
    title: "Michigan MI-W4 exemptions",
    description: "Add your Michigan exemption count if you filled it out.",
    skippable: true,
  },
  louisiana_withholding: {
    id: "louisiana_withholding",
    title: "Louisiana L-4 withholding",
    description: "Add your Louisiana deduction claim only if you filled it out.",
    skippable: true,
  },
  mississippi_withholding: {
    id: "mississippi_withholding",
    title: "Mississippi 89-350 withholding",
    description: "Add your Mississippi exemption amount or spouse-work detail if they apply.",
    skippable: true,
  },
  missouri_withholding: {
    id: "missouri_withholding",
    title: "Missouri MO W-4 withholding",
    description: "Add the spouse-does-not-work election only if it applies.",
    skippable: true,
  },
  minnesota_withholding: {
    id: "minnesota_withholding",
    title: "Minnesota W-4MN withholding",
    description: "Add your Minnesota allowance count only if you filled it out.",
    skippable: true,
  },
  north_carolina_withholding: {
    id: "north_carolina_withholding",
    title: "North Carolina NC-4 allowances",
    description: "Add your North Carolina allowance count only if you filled it out.",
    skippable: true,
  },
  north_dakota_info: {
    id: "north_dakota_info",
    title: "North Dakota withholding rules",
    description: "North Dakota usually does not need extra state-specific inputs here.",
    skippable: true,
  },
  rhode_island_withholding: {
    id: "rhode_island_withholding",
    title: "Rhode Island RI-W4 withholding",
    description: "Add your Rhode Island allowances, extra withholding, or exemption status if they apply.",
    skippable: true,
  },
  south_carolina_withholding: {
    id: "south_carolina_withholding",
    title: "South Carolina SC W-4 withholding",
    description: "Add your South Carolina allowances or exempt election only if they apply.",
    skippable: true,
  },
  district_of_columbia_withholding: {
    id: "district_of_columbia_withholding",
    title: "District of Columbia D-4 withholding",
    description: "Add your DC allowances or exempt election only if they apply.",
    skippable: true,
  },
  vermont_withholding: {
    id: "vermont_withholding",
    title: "Vermont W-4VT withholding",
    description: "Add your Vermont allowance count only if you filled it out.",
    skippable: true,
  },
  west_virginia_withholding: {
    id: "west_virginia_withholding",
    title: "West Virginia IT-104 withholding",
    description: "Add your West Virginia exemptions or lower-rate election only if they apply.",
    skippable: true,
  },
  wisconsin_withholding: {
    id: "wisconsin_withholding",
    title: "Wisconsin WT-4 withholding",
    description: "Add your Wisconsin exemption count only if you filled it out.",
    skippable: true,
  },
  utah_info: {
    id: "utah_info",
    title: "Utah withholding rules",
    description: "Utah usually does not need extra state-specific inputs here.",
    skippable: true,
  },
  arizona_withholding: {
    id: "arizona_withholding",
    title: "Arizona A-4 withholding",
    description: "Add your Arizona percentage election only if you filled out Form A-4.",
    skippable: true,
  },
  california_withholding: {
    id: "california_withholding",
    title: "California DE 4 withholding",
    description: "Add your California regular and estimated-deduction allowances if they apply.",
    skippable: true,
  },
  connecticut_withholding: {
    id: "connecticut_withholding",
    title: "Connecticut CT-W4 withholding",
    description: "Add your Connecticut code, adjustments, or nonresident percentage only if they apply.",
    skippable: true,
  },
  illinois_allowances: {
    id: "illinois_allowances",
    title: "Illinois IL-W-4 allowances",
    description: "Add your Illinois Line 1 and Line 2 allowances if you filled them out.",
    skippable: true,
  },
  georgia_withholding: {
    id: "georgia_withholding",
    title: "Georgia G-4 withholding",
    description: "Add your Georgia allowance count and spouse-work election if they apply.",
    skippable: true,
  },
  new_jersey_withholding: {
    id: "new_jersey_withholding",
    title: "New Jersey NJ-W4 withholding",
    description: "Add your New Jersey table, allowances, or exempt election if they apply.",
    skippable: true,
  },
  virginia_withholding: {
    id: "virginia_withholding",
    title: "Virginia VA-4 withholding",
    description: "Add your Virginia exemption counts only if they apply to your payroll setup.",
    skippable: true,
  },
  massachusetts_withholding: {
    id: "massachusetts_withholding",
    title: "Massachusetts M-4 withholding",
    description: "Add your Massachusetts exemptions, extra withholding, or exempt details if they apply.",
    skippable: true,
  },
  hawaii_withholding: {
    id: "hawaii_withholding",
    title: "Hawaii HW-4 withholding",
    description: "Add your Hawaii allowances or special elections only if they apply.",
    skippable: true,
  },
  iowa_withholding: {
    id: "iowa_withholding",
    title: "Iowa IA W-4 withholding",
    description: "Add your Iowa allowance amount, extra withholding, or exemptions if they apply.",
    skippable: true,
  },
  kansas_withholding: {
    id: "kansas_withholding",
    title: "Kansas K-4 withholding",
    description: "Add your Kansas rate, extra withholding, or exempt election if they apply.",
    skippable: true,
  },
  oklahoma_withholding: {
    id: "oklahoma_withholding",
    title: "Oklahoma OK-W-4 withholding",
    description: "Add your Oklahoma allowances, extra withholding, or special elections if they apply.",
    skippable: true,
  },
  new_mexico_withholding: {
    id: "new_mexico_withholding",
    title: "New Mexico withholding",
    description: "Add your New Mexico withholding elections only if they apply.",
    skippable: true,
  },
  montana_withholding: {
    id: "montana_withholding",
    title: "Montana MW-4 withholding",
    description: "Add your Montana two-earner or exempt election only if it applies.",
    skippable: true,
  },
  nebraska_withholding: {
    id: "nebraska_withholding",
    title: "Nebraska W-4N withholding",
    description: "Add your Nebraska allowances or exempt election only if they apply.",
    skippable: true,
  },
  maryland_withholding: {
    id: "maryland_withholding",
    title: "Maryland MW507 withholding",
    description: "Add your Maryland withholding exemption count if you filled it in.",
    skippable: true,
  },
  indiana_withholding: {
    id: "indiana_withholding",
    title: "Indiana WH-4 withholding",
    description: "Add your Indiana WH-4 details if they apply to your paycheck.",
    skippable: true,
  },
  ohio_tax_details: {
    id: "ohio_tax_details",
    title: "Ohio tax details",
    description: "Add your Ohio IT-4 and any school district, city, or JEDD details if they apply.",
    skippable: true,
  },
  new_york_withholding: {
    id: "new_york_withholding",
    title: "New York state and local withholding",
    description: "Add your New York allowance count, extra withholding, and local category if they apply.",
    skippable: true,
  },
  oregon_tax_details: {
    id: "oregon_tax_details",
    title: "Oregon tax details",
    description: "Add your OR-W-4 details and any Metro or Multnomah elections if they apply.",
    skippable: true,
  },
  pennsylvania_local_tax: {
    id: "pennsylvania_local_tax",
    title: "Pennsylvania local tax details",
    description: "Add Pennsylvania local earned income tax details only if they apply to you.",
    skippable: true,
  },
  location_local_details: {
    id: "location_local_details",
    title: "Where you live and work",
    description: "We only need this because your estimate can change based on where you live, where you work, or both.",
    skippable: true,
  },
  washington_payroll_programs: {
    id: "washington_payroll_programs",
    title: "Washington payroll programs",
    description: "Washington does not withhold state income tax on wages, but some employers withhold PFML and WA Cares.",
    skippable: true,
  },
  federal_exempt: {
    id: "federal_exempt",
    title: "Federal exempt",
    description: "Most users will leave this off.",
    skippable: true,
  },
  w4_details_gate: {
    id: "w4_details_gate",
    title: "Did you fill any extra boxes on your federal W-4?",
    description:
      "Only continue if you entered the multiple jobs box, Step 3 credits, other income, or deductions.",
    skippable: true,
  },
  federal_multiple_jobs: {
    id: "federal_multiple_jobs",
    title: "Multiple jobs box",
    description: "Did you check the multiple jobs box on your W-4?",
    skippable: true,
  },
  federal_step3_credits: {
    id: "federal_step3_credits",
    title: "W-4 tax credits",
    description: "Enter the yearly total from Step 3 only if you filled it in.",
    skippable: true,
  },
  federal_other_income: {
    id: "federal_other_income",
    title: "Other income",
    description: "Enter yearly other income only if you listed it on your W-4.",
    skippable: true,
  },
  federal_deductions: {
    id: "federal_deductions",
    title: "Extra deductions",
    description: "Enter yearly deductions only if you listed them on your W-4.",
    skippable: true,
  },
  pre_tax_deductions: {
    id: "pre_tax_deductions",
    title: "Paycheck deductions",
    description: undefined,
    skippable: true,
  },
  extra_withholding: {
    id: "extra_withholding",
    title: "Extra withholding",
    description: "Add any extra federal or state amount your payroll withholds each paycheck.",
    skippable: true,
  },
};

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getNumericInputValue(value: number | undefined): string {
  return value == null ? "" : String(value);
}

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value: string[] | undefined): string {
  return (value ?? []).join(", ");
}

function hasAdvancedW4Details(profile: TaxProfileDraft): boolean {
  return (
    profile.federalMultipleJobsCheckbox !== undefined ||
    profile.federalStep3Credits != null ||
    profile.federalOtherIncome != null ||
    profile.federalDeductions != null
  );
}

function ChoiceGrid({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-2xl border p-3.5 text-left transition-colors sm:p-4",
              selected
                ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30"
                : "border-border bg-card text-card-foreground hover:border-emerald-300 hover:bg-emerald-50/40 dark:hover:bg-primary/15",
            ].join(" ")}
          >
            <div className={selected ? "font-medium text-primary-foreground" : "font-medium text-foreground"}>
              {option.label}
            </div>
            {option.hint ? (
              <div
                className={selected ? "mt-1 text-sm text-primary-foreground/80" : "mt-1 text-sm text-muted-foreground"}
              >
                {option.hint}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NumberAdjuster({
  label,
  value,
  onChange,
  helper,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  helper?: string;
}) {
  return (
    <div className="space-y-3">
      <Label>{label}</Label>
      <div className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 sm:px-4">
        <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => onChange(Math.max(0, value - 1))}>
          -
        </Button>
        <div className="min-w-0 flex-1 text-center text-2xl font-semibold tabular-nums sm:text-3xl">{value}</div>
        <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => onChange(value + 1)}>
          +
        </Button>
      </div>
      {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function StepShell({
  title,
  description,
  currentIndex,
  totalSteps,
  children,
}: {
  title: string;
  description?: string;
  currentIndex: number;
  totalSteps: number;
  children: React.ReactNode;
}) {
  const progressValue = ((currentIndex + 1) / totalSteps) * 100;

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <div className="space-y-2">
          <div className="flex flex-col gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Tax setup</span>
            <span>
              Step {currentIndex + 1} of {totalSteps}
            </span>
          </div>
          <Progress value={progressValue} className="h-2" />
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <CardTitle className="text-lg sm:text-xl">{title}</CardTitle>
            {description ? <CardDescription className="text-sm">{description}</CardDescription> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-4 pb-5 sm:space-y-6 sm:px-6 sm:pb-6">{children}</CardContent>
    </Card>
  );
}

export default function TaxCardFlowForm({ onClose }: { onClose?: () => void }) {
  const workspaceState = useWorkspaceStore((s) => s.state);
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null;
  const taxEntry = useTaxProfileStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined
  );
  const taxProfile = taxEntry?.taxProfile ?? null;
  const taxLoading =
    activeWorkspaceId != null ? (taxEntry?.status ?? "idle") === "loading" : true;
  const setTaxProfileStore = useTaxProfileStore((s) => s.setTaxProfile);
  const { toast } = useToast();

  const initialSetupRef = useRef(taxProfile == null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveHashRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const [formData, setFormData] = useState<TaxProfileDraft>(() => {
    return taxProfile ? (taxProfile as TaxProfileDraft) : EMPTY_FORM;
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [advancedW4Enabled, setAdvancedW4Enabled] = useState<boolean>(() =>
    taxProfile ? hasAdvancedW4Details(taxProfile as TaxProfileDraft) : false
  );
  const [advancedW4Selection, setAdvancedW4Selection] = useState<"yes" | "no" | undefined>(() =>
    taxProfile ? (hasAdvancedW4Details(taxProfile as TaxProfileDraft) ? "yes" : "no") : undefined
  );

  const isInitialSetup = initialSetupRef.current;
  const isEditingMode = !isInitialSetup;

  useEffect(() => {
    if (taxProfile) {
      setFormData(taxProfile as TaxProfileDraft);
      const hasAdvanced = hasAdvancedW4Details(taxProfile as TaxProfileDraft);
      setAdvancedW4Enabled(hasAdvanced);
      setAdvancedW4Selection(hasAdvanced ? "yes" : "no");
    } else {
      setFormData(EMPTY_FORM);
      setAdvancedW4Enabled(false);
      setAdvancedW4Selection(undefined);
    }
    autosaveHashRef.current = JSON.stringify(taxProfile ?? EMPTY_FORM);
  }, [taxProfile]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const updateField = <K extends keyof TaxProfile.Type>(
    field: K,
    value: TaxProfile.Type[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePrimaryStateChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      state: value,
      residenceState:
        !prev.multiStateWorker || !prev.residenceState || prev.residenceState === prev.state
          ? value
          : prev.residenceState,
      workState:
        !prev.multiStateWorker || !prev.workState || prev.workState === prev.state
          ? value
          : prev.workState,
    }));
  };

  const handleMultiStateToggle = (checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      multiStateWorker: checked,
      residenceState: checked ? prev.residenceState : prev.residenceState || prev.state,
      workState: checked ? prev.workState : prev.workState || prev.state,
    }));
  };

  const effectiveResidenceState = formData.multiStateWorker
    ? (formData.residenceState ?? "")
    : formData.state ?? "";
  const effectiveWorkState = formData.multiStateWorker
    ? (formData.workState ?? "")
    : formData.state ?? "";
  const activeStates = new Set<string>(
    [formData.state, effectiveResidenceState, effectiveWorkState].filter(
      (value): value is string => Boolean(value)
    )
  );
  const stateSelected = (stateCode: string) => activeStates.has(stateCode);
  const arkansasSelected = stateSelected("Arkansas");
  const alabamaSelected = stateSelected("Alabama");
  const delawareSelected = stateSelected("Delaware");
  const coloradoSelected = stateSelected("Colorado");
  const idahoSelected = stateSelected("Idaho");
  const kentuckySelected = stateSelected("Kentucky");
  const maineSelected = stateSelected("Maine");
  const michiganSelected = stateSelected("Michigan");
  const louisianaSelected = stateSelected("Louisiana");
  const mississippiSelected = stateSelected("Mississippi");
  const missouriSelected = stateSelected("Missouri");
  const minnesotaSelected = stateSelected("Minnesota");
  const northCarolinaSelected = stateSelected("NorthCarolina");
  const northDakotaSelected = stateSelected("NorthDakota");
  const rhodeIslandSelected = stateSelected("RhodeIsland");
  const southCarolinaSelected = stateSelected("SouthCarolina");
  const washingtonDCSelected = stateSelected("WashingtonDC");
  const vermontSelected = stateSelected("Vermont");
  const westVirginiaSelected = stateSelected("WestVirginia");
  const wisconsinSelected = stateSelected("Wisconsin");
  const utahSelected = stateSelected("Utah");
  const arizonaSelected = stateSelected("Arizona");
  const californiaSelected = stateSelected("California");
  const connecticutSelected = stateSelected("Connecticut");
  const illinoisSelected = stateSelected("Illinois");
  const georgiaSelected = stateSelected("Georgia");
  const massachusettsSelected = stateSelected("Massachusetts");
  const hawaiiSelected = stateSelected("Hawaii");
  const iowaSelected = stateSelected("Iowa");
  const kansasSelected = stateSelected("Kansas");
  const oklahomaSelected = stateSelected("Oklahoma");
  const newMexicoSelected = stateSelected("NewMexico");
  const montanaSelected = stateSelected("Montana");
  const nebraskaSelected = stateSelected("Nebraska");
  const newJerseySelected = stateSelected("NewJersey");
  const virginiaSelected = stateSelected("Virginia");
  const marylandSelected = stateSelected("Maryland");
  const marylandResidentSelected = effectiveResidenceState === "Maryland";
  const indianaSelected = stateSelected("Indiana");
  const indianaResidentSelected = effectiveResidenceState === "Indiana";
  const ohioSelected = stateSelected("Ohio");
  const newYorkSelected = stateSelected("NewYork");
  const oregonSelected = stateSelected("Oregon");
  const pennsylvaniaSelected = stateSelected("Pennsylvania");
  const washingtonSelected = stateSelected("Washington");
  const washingtonPrimarySelected = formData.state === "Washington";
  const localTaxStateSelected = Array.from(activeStates).some((stateCode) =>
    ["Maryland", "Ohio", "Indiana", "NewYork", "Pennsylvania", "Oregon"].includes(stateCode)
  );
  const locationDetailsRelevant =
    formData.multiStateWorker
    || Array.from(activeStates).some((stateCode) =>
      [
        "Connecticut",
        "Delaware",
        "Illinois",
        "Indiana",
        "Kentucky",
        "Maine",
        "Maryland",
        "Michigan",
        "Minnesota",
        "NewYork",
        "NorthDakota",
        "Ohio",
        "Oregon",
        "Pennsylvania",
        "Vermont",
        "WashingtonDC",
        "WestVirginia",
        "Wisconsin",
      ].includes(stateCode)
    );
  const insurancePremiumEntered = (formData.insurancePremium ?? 0) > 0;

  const steps = useMemo<StepDefinition[]>(() => {
    const list: StepDefinition[] = [
      STEP_DEFINITIONS.filing_status,
      STEP_DEFINITIONS.dependents,
      STEP_DEFINITIONS.primary_state,
      STEP_DEFINITIONS.multi_state,
    ];

    if (formData.multiStateWorker) {
      list.push(STEP_DEFINITIONS.residence_state, STEP_DEFINITIONS.work_state);
    }

    if (arkansasSelected) list.push(STEP_DEFINITIONS.arkansas_withholding);
    if (alabamaSelected) list.push(STEP_DEFINITIONS.alabama_tax_details);
    if (delawareSelected) list.push(STEP_DEFINITIONS.delaware_withholding);
    if (coloradoSelected) list.push(STEP_DEFINITIONS.colorado_deduction);
    if (idahoSelected) list.push(STEP_DEFINITIONS.idaho_tax_details);
    if (kentuckySelected) list.push(STEP_DEFINITIONS.kentucky_info);
    if (maineSelected) list.push(STEP_DEFINITIONS.maine_withholding);
    if (michiganSelected) list.push(STEP_DEFINITIONS.michigan_exemptions);
    if (louisianaSelected) list.push(STEP_DEFINITIONS.louisiana_withholding);
    if (mississippiSelected) list.push(STEP_DEFINITIONS.mississippi_withholding);
    if (missouriSelected) list.push(STEP_DEFINITIONS.missouri_withholding);
    if (minnesotaSelected) list.push(STEP_DEFINITIONS.minnesota_withholding);
    if (northCarolinaSelected) list.push(STEP_DEFINITIONS.north_carolina_withholding);
    if (northDakotaSelected) list.push(STEP_DEFINITIONS.north_dakota_info);
    if (rhodeIslandSelected) list.push(STEP_DEFINITIONS.rhode_island_withholding);
    if (southCarolinaSelected) list.push(STEP_DEFINITIONS.south_carolina_withholding);
    if (washingtonDCSelected) list.push(STEP_DEFINITIONS.district_of_columbia_withholding);
    if (vermontSelected) list.push(STEP_DEFINITIONS.vermont_withholding);
    if (westVirginiaSelected) list.push(STEP_DEFINITIONS.west_virginia_withholding);
    if (wisconsinSelected) list.push(STEP_DEFINITIONS.wisconsin_withholding);
    if (utahSelected) list.push(STEP_DEFINITIONS.utah_info);

    if (arizonaSelected) {
      list.push(STEP_DEFINITIONS.arizona_withholding);
    }

    if (californiaSelected) {
      list.push(STEP_DEFINITIONS.california_withholding);
    }

    if (connecticutSelected) {
      list.push(STEP_DEFINITIONS.connecticut_withholding);
    }

    if (illinoisSelected) {
      list.push(STEP_DEFINITIONS.illinois_allowances);
    }

    if (georgiaSelected) {
      list.push(STEP_DEFINITIONS.georgia_withholding);
    }

    if (massachusettsSelected) {
      list.push(STEP_DEFINITIONS.massachusetts_withholding);
    }

    if (hawaiiSelected) {
      list.push(STEP_DEFINITIONS.hawaii_withholding);
    }

    if (iowaSelected) {
      list.push(STEP_DEFINITIONS.iowa_withholding);
    }

    if (kansasSelected) {
      list.push(STEP_DEFINITIONS.kansas_withholding);
    }

    if (oklahomaSelected) {
      list.push(STEP_DEFINITIONS.oklahoma_withholding);
    }

    if (newMexicoSelected) {
      list.push(STEP_DEFINITIONS.new_mexico_withholding);
    }

    if (montanaSelected) {
      list.push(STEP_DEFINITIONS.montana_withholding);
    }

    if (nebraskaSelected) {
      list.push(STEP_DEFINITIONS.nebraska_withholding);
    }

    if (newJerseySelected) {
      list.push(STEP_DEFINITIONS.new_jersey_withholding);
    }

    if (virginiaSelected) {
      list.push(STEP_DEFINITIONS.virginia_withholding);
    }

    if (marylandSelected) {
      list.push(STEP_DEFINITIONS.maryland_withholding);
    }

    if (indianaSelected) {
      list.push(STEP_DEFINITIONS.indiana_withholding);
    }

    if (ohioSelected) {
      list.push(STEP_DEFINITIONS.ohio_tax_details);
    }

    if (newYorkSelected) {
      list.push(STEP_DEFINITIONS.new_york_withholding);
    }

    if (oregonSelected) {
      list.push(STEP_DEFINITIONS.oregon_tax_details);
    }

    if (pennsylvaniaSelected) {
      list.push(STEP_DEFINITIONS.pennsylvania_local_tax);
    }

    if (locationDetailsRelevant) {
      list.push(STEP_DEFINITIONS.location_local_details);
    }

    if (washingtonPrimarySelected) {
      list.push(STEP_DEFINITIONS.washington_payroll_programs);
    }

    list.push(STEP_DEFINITIONS.federal_exempt, STEP_DEFINITIONS.w4_details_gate);

    if (advancedW4Enabled) {
      list.push(
        STEP_DEFINITIONS.federal_multiple_jobs,
        STEP_DEFINITIONS.federal_step3_credits,
        STEP_DEFINITIONS.federal_other_income,
        STEP_DEFINITIONS.federal_deductions
      );
    }

    list.push(STEP_DEFINITIONS.pre_tax_deductions, STEP_DEFINITIONS.extra_withholding);

    return list;
  }, [
    advancedW4Enabled,
    formData.multiStateWorker,
    locationDetailsRelevant,
    arkansasSelected,
    alabamaSelected,
    delawareSelected,
    coloradoSelected,
    idahoSelected,
    kentuckySelected,
    maineSelected,
    michiganSelected,
    louisianaSelected,
    mississippiSelected,
    missouriSelected,
    minnesotaSelected,
    northCarolinaSelected,
    northDakotaSelected,
    rhodeIslandSelected,
    southCarolinaSelected,
    washingtonDCSelected,
    vermontSelected,
    westVirginiaSelected,
    wisconsinSelected,
    utahSelected,
    arizonaSelected,
    californiaSelected,
    connecticutSelected,
    illinoisSelected,
    georgiaSelected,
    massachusettsSelected,
    hawaiiSelected,
    iowaSelected,
    kansasSelected,
    oklahomaSelected,
    newMexicoSelected,
    montanaSelected,
    nebraskaSelected,
    newJerseySelected,
    virginiaSelected,
    marylandSelected,
    indianaSelected,
    ohioSelected,
    newYorkSelected,
    oregonSelected,
    pennsylvaniaSelected,
    washingtonPrimarySelected,
  ]);

  useEffect(() => {
    setCurrentStepIndex((prev) => Math.min(prev, Math.max(steps.length - 1, 0)));
  }, [steps.length]);

  const currentStep = steps[currentStepIndex];

  function isStepComplete(stepId: StepId): boolean {
    switch (stepId) {
      case "filing_status":
        return Boolean(formData.filingStatus);
      case "dependents":
        return (formData.dependents ?? 0) >= 0;
      case "primary_state":
        return Boolean(formData.state);
      case "multi_state":
        return formData.multiStateWorker === true;
      case "residence_state":
        return Boolean(formData.residenceState);
      case "work_state":
        return Boolean(formData.workState);
      case "arkansas_withholding":
      case "alabama_tax_details":
      case "delaware_withholding":
      case "colorado_deduction":
      case "idaho_tax_details":
      case "kentucky_info":
      case "maine_withholding":
      case "michigan_exemptions":
      case "louisiana_withholding":
      case "mississippi_withholding":
      case "missouri_withholding":
      case "minnesota_withholding":
      case "north_carolina_withholding":
      case "north_dakota_info":
      case "rhode_island_withholding":
      case "south_carolina_withholding":
      case "district_of_columbia_withholding":
      case "vermont_withholding":
      case "west_virginia_withholding":
      case "wisconsin_withholding":
      case "utah_info":
      case "arizona_withholding":
      case "california_withholding":
      case "connecticut_withholding":
      case "illinois_allowances":
      case "georgia_withholding":
      case "massachusetts_withholding":
      case "hawaii_withholding":
      case "iowa_withholding":
      case "kansas_withholding":
      case "oklahoma_withholding":
      case "new_mexico_withholding":
      case "montana_withholding":
      case "nebraska_withholding":
      case "new_jersey_withholding":
      case "maryland_withholding":
      case "indiana_withholding":
      case "ohio_tax_details":
      case "new_york_withholding":
      case "oregon_tax_details":
      case "pennsylvania_local_tax":
      case "virginia_withholding":
      case "location_local_details":
      case "washington_payroll_programs":
        return true;
      case "federal_exempt":
        return formData.federalExempt != null;
      case "w4_details_gate":
        return advancedW4Selection != null;
      case "federal_multiple_jobs":
        return formData.federalMultipleJobsCheckbox != null;
      case "federal_step3_credits":
      case "federal_other_income":
      case "federal_deductions":
      case "pre_tax_deductions":
      case "extra_withholding":
        return true;
      default:
        return true;
    }
  }

  function applySkip(stepId: StepId) {
    switch (stepId) {
      case "multi_state":
        handleMultiStateToggle(false);
        break;
      case "arkansas_withholding":
        updateField("arkansasExemptions", undefined);
        updateField("arkansasLowIncomeRates", false);
        break;
      case "alabama_tax_details":
        updateField("alabamaExemptionCode", undefined);
        break;
      case "delaware_withholding":
        updateField("delawareWithholdingExemptions", undefined);
        break;
      case "colorado_deduction":
        updateField("coloradoDeductionAmount", undefined);
        break;
      case "idaho_tax_details":
        updateField("idahoAllowances", undefined);
        updateField("idahoAdditionalWithholding", undefined);
        updateField("idahoExempt", false);
        break;
      case "kentucky_info":
      case "north_dakota_info":
      case "utah_info":
        break;
      case "maine_withholding":
        updateField("maineWithholdingExemptions", undefined);
        updateField("maineHigherSingleRate", false);
        break;
      case "michigan_exemptions":
        updateField("michiganExemptions", undefined);
        break;
      case "louisiana_withholding":
        updateField("louisianaDeductionClaim", undefined);
        break;
      case "mississippi_withholding":
        updateField("mississippiExemptionAmount", undefined);
        updateField("mississippiSpouseEmployed", false);
        break;
      case "missouri_withholding":
        updateField("missouriSpouseDoesNotWork", false);
        break;
      case "minnesota_withholding":
        updateField("minnesotaWithholdingExemptions", undefined);
        break;
      case "north_carolina_withholding":
        updateField("northCarolinaAllowances", undefined);
        break;
      case "rhode_island_withholding":
        updateField("rhodeIslandAllowances", undefined);
        updateField("rhodeIslandAdditionalWithholding", undefined);
        updateField("rhodeIslandExemptStatus", undefined);
        break;
      case "south_carolina_withholding":
        updateField("southCarolinaWithholdingExemptions", undefined);
        updateField("southCarolinaExempt", false);
        break;
      case "district_of_columbia_withholding":
        updateField("districtOfColumbiaWithholdingExemptions", undefined);
        updateField("districtOfColumbiaExempt", false);
        break;
      case "vermont_withholding":
        updateField("vermontWithholdingExemptions", undefined);
        break;
      case "west_virginia_withholding":
        updateField("westVirginiaWithholdingExemptions", undefined);
        updateField("westVirginiaLowerRateElection", false);
        break;
      case "wisconsin_withholding":
        updateField("wisconsinWithholdingExemptions", undefined);
        break;
      case "federal_exempt":
        updateField("federalExempt", false);
        break;
      case "w4_details_gate":
        setAdvancedW4Selection("no");
        setAdvancedW4Enabled(false);
        updateField("federalMultipleJobsCheckbox", undefined);
        updateField("federalStep3Credits", undefined);
        updateField("federalOtherIncome", undefined);
        updateField("federalDeductions", undefined);
        break;
      case "federal_multiple_jobs":
        updateField("federalMultipleJobsCheckbox", false);
        break;
      case "federal_step3_credits":
        updateField("federalStep3Credits", undefined);
        break;
      case "federal_other_income":
        updateField("federalOtherIncome", undefined);
        break;
      case "federal_deductions":
        updateField("federalDeductions", undefined);
        break;
      case "pre_tax_deductions":
        updateField("retirement401kType", undefined);
        updateField("retirement401kPercent", undefined);
        updateField("retirement401kFlat", undefined);
        updateField("insurancePremium", undefined);
        updateField("insurancePreTax", false);
        break;
      case "extra_withholding":
        updateField("additionalFederalWithholding", undefined);
        updateField("additionalStateWithholding", undefined);
        break;
      case "maryland_withholding":
        updateField("marylandWithholdingExemptions", undefined);
        break;
      case "arizona_withholding":
        updateField("arizonaWithholdingPercent", undefined);
        updateField("arizonaExempt", false);
        break;
      case "california_withholding":
        updateField("californiaRegularAllowances", undefined);
        updateField("californiaEstimatedDeductionAllowances", undefined);
        break;
      case "connecticut_withholding":
        updateField("connecticutWithholdingCode", undefined);
        updateField("connecticutFifteenDayExempt", false);
        updateField("connecticutAdditionalWithholding", undefined);
        updateField("connecticutReducedWithholding", undefined);
        updateField("connecticutNonresidentApportionmentPercent", undefined);
        break;
      case "illinois_allowances":
        updateField("illinoisAllowanceLine1", undefined);
        updateField("illinoisAllowanceLine2", undefined);
        break;
      case "georgia_withholding":
        updateField("georgiaAllowanceCount", undefined);
        updateField("georgiaMarriedBothWorking", false);
        break;
      case "massachusetts_withholding":
        updateField("massachusettsExemptions", undefined);
        updateField("massachusettsBlindExemptions", undefined);
        updateField("massachusettsAdditionalWithholding", undefined);
        updateField("massachusettsFullTimeStudentExempt", false);
        updateField("massachusettsMsrraExempt", false);
        break;
      case "hawaii_withholding":
        updateField("hawaiiWithholdingExemptions", undefined);
        updateField("hawaiiHigherSingleRate", false);
        updateField("hawaiiCertifiedDisabled", false);
        updateField("hawaiiNonresidentMilitarySpouse", false);
        break;
      case "iowa_withholding":
        updateField("iowaAllowanceAmount", undefined);
        updateField("iowaAdditionalWithholding", undefined);
        updateField("iowaSpouseHasIncome", false);
        updateField("iowaExempt", false);
        updateField("iowaMilitarySpouseExempt", false);
        break;
      case "kansas_withholding":
        updateField("kansasAllowanceRate", undefined);
        updateField("kansasAdditionalWithholding", undefined);
        updateField("kansasExempt", false);
        break;
      case "oklahoma_withholding":
        updateField("oklahomaAllowances", undefined);
        updateField("oklahomaAdditionalWithholding", undefined);
        updateField("oklahomaHigherSingleRate", false);
        updateField("oklahomaExempt", false);
        updateField("oklahomaMilitarySpouseExempt", false);
        updateField("oklahomaMilitaryIncomeExempt", false);
        break;
      case "new_mexico_withholding":
        updateField("newMexicoHigherSingleRate", false);
        updateField("newMexicoExempt", false);
        updateField("newMexicoMilitarySpouseExempt", false);
        updateField("newMexicoNativeAmericanExempt", false);
        break;
      case "montana_withholding":
        updateField("montanaBothSpousesWorking", false);
        updateField("montanaExempt", false);
        break;
      case "nebraska_withholding":
        updateField("nebraskaWithholdingExemptions", undefined);
        updateField("nebraskaExempt", false);
        break;
      case "new_jersey_withholding":
        updateField("newJerseyRateTable", undefined);
        updateField("newJerseyAllowances", undefined);
        updateField("newJerseyExempt", false);
        break;
      case "indiana_withholding":
        updateField("indianaPersonalExemptions", undefined);
        updateField("indianaDependentExemptions", undefined);
        updateField("indianaFirstTimeDependentExemptions", undefined);
        updateField("indianaAdoptedChildExemptions", undefined);
        updateField("indianaAdditionalStateWithholding", undefined);
        updateField("indianaAdditionalCountyWithholding", undefined);
        updateField("indianaNonresidentThirtyDayExempt", false);
        updateField("indianaNonresidentMilitarySpouseExempt", false);
        break;
      case "ohio_tax_details":
        updateField("ohioExemptions", undefined);
        updateField("ohioAdditionalStateWithholding", undefined);
        updateField("ohioSchoolDistrictNumber", undefined);
        updateField("ohioSchoolDistrictIncomeTaxRate", undefined);
        updateField("ohioMunicipalIncomeTaxRate", undefined);
        updateField("ohioJeddJedzIncomeTaxRate", undefined);
        updateField("ohioResidentMilitaryOutsideOhioExempt", false);
        updateField("ohioNonresidentMilitaryExempt", false);
        updateField("ohioNonresidentMilitarySpouseExempt", false);
        updateField("ohioStatutoryExempt", false);
        break;
      case "new_york_withholding":
        updateField("newYorkWithholdingExemptions", undefined);
        updateField("newYorkAdditionalStateWithholding", undefined);
        updateField("newYorkLocality", undefined);
        updateField("newYorkExempt", false);
        break;
      case "oregon_tax_details":
        updateField("oregonAllowances", undefined);
        updateField("oregonAdditionalWithholding", undefined);
        updateField("oregonHigherSingleRate", false);
        updateField("oregonExempt", false);
        updateField("oregonMetroLocation", false);
        updateField("oregonMultnomahCountyLocation", false);
        updateField("oregonMetroWithholdingElection", undefined);
        updateField("oregonPfaWithholdingElection", undefined);
        break;
      case "pennsylvania_local_tax":
        updateField("pennsylvaniaResidentPsdCode", undefined);
        updateField("pennsylvaniaResidentEitRate", undefined);
        updateField("pennsylvaniaWorkPsdCode", undefined);
        updateField("pennsylvaniaWorkNonResidentEitRate", undefined);
        break;
      case "virginia_withholding":
        updateField("virginiaPersonalExemptions", undefined);
        updateField("virginiaAgeBlindExemptions", undefined);
        updateField("virginiaExempt", false);
        break;
      case "location_local_details":
        updateField("residenceCounty", undefined);
        updateField("workCounty", undefined);
        updateField("residenceCity", undefined);
        updateField("workCity", undefined);
        updateField("postalCode", undefined);
        updateField("schoolDistrictId", undefined);
        updateField("localTaxJurisdictionIds", []);
        updateField("reciprocityElection", false);
        break;
      case "washington_payroll_programs":
        updateField("pfmlPercent", undefined);
        updateField("waCaresPercent", undefined);
        break;
      default:
        break;
    }
  }

  async function persistProfile(options: {
    closeOnSuccess: boolean;
    successTitle?: string;
    successDescription?: string;
    showSuccessToast?: boolean;
  }): Promise<boolean> {
    if (!activeWorkspaceId) {
      toast({
        title: "Save failed",
        description: "No active workspace selected.",
        variant: "destructive",
      });
      return false;
    }

    const marylandResidentSelectedNow =
      formData.state === "Maryland" ||
      formData.residenceState === "Maryland" ||
      (!formData.residenceState && formData.state === "Maryland");

    if (marylandResidentSelectedNow && !(formData.residenceCounty ?? "").trim()) {
      toast({
        title: "Maryland county required",
        description:
          "Maryland paycheck withholding depends on your residence county, so add it before saving.",
        variant: "destructive",
      });
      return false;
    }

    let parsed: TaxProfile.Type;
    try {
      parsed = TaxProfile.Schema.parse({
        ...formData,
        residenceState: formData.multiStateWorker
          ? formData.residenceState || undefined
          : formData.state || undefined,
        workState: formData.multiStateWorker
          ? formData.workState || undefined
          : formData.state || undefined,
        residenceCounty: formData.residenceCounty?.trim() || undefined,
        workCounty: formData.workCounty?.trim() || undefined,
        residenceCity: formData.residenceCity?.trim() || undefined,
        workCity: formData.workCity?.trim() || undefined,
        postalCode: formData.postalCode?.trim() || undefined,
        schoolDistrictId: formData.schoolDistrictId?.trim() || undefined,
        localTaxJurisdictionIds: (formData.localTaxJurisdictionIds ?? [])
          .map((id) => id.trim())
          .filter(Boolean),
        ohioSchoolDistrictNumber: formData.ohioSchoolDistrictNumber?.trim() || undefined,
        newYorkLocality: formData.newYorkLocality,
        pennsylvaniaResidentPsdCode:
          formData.pennsylvaniaResidentPsdCode?.trim() || undefined,
        pennsylvaniaWorkPsdCode:
          formData.pennsylvaniaWorkPsdCode?.trim() || undefined,
      });
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message || "Could not save tax profile",
        variant: "destructive",
      });
      return false;
    }

    const previousTaxProfile = taxProfile;
    setTaxProfileStore(activeWorkspaceId, parsed);
    autosaveHashRef.current = JSON.stringify(parsed);

    if (options.showSuccessToast) {
      toast({
        title: options.successTitle ?? "Tax profile updated",
        description: options.successDescription ?? "We saved your tax settings in the background.",
      });
    }

    if (options.closeOnSuccess) {
      onClose?.();
    }

    try {
      const saved = await taxProfileService.save(activeWorkspaceId, parsed);
      setTaxProfileStore(activeWorkspaceId, saved);
      autosaveHashRef.current = JSON.stringify(saved);
      return true;
    } catch (err: any) {
      setTaxProfileStore(activeWorkspaceId, previousTaxProfile);
      toast({
        title: "Background save failed",
        description: err.message || "Could not save tax profile",
        variant: "destructive",
      });
      return false;
    }
  }

  useEffect(() => {
    if (!mountedRef.current || !isEditingMode || !activeWorkspaceId) {
      return;
    }

    const nextHash = JSON.stringify(formData);
    if (nextHash === autosaveHashRef.current) {
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void persistProfile({
        closeOnSuccess: false,
        showSuccessToast: false,
      });
    }, 500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [activeWorkspaceId, formData, isEditingMode]);

  async function goToNextStep() {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= steps.length) {
      await persistProfile({
        closeOnSuccess: true,
        showSuccessToast: true,
        successTitle: "Paycheck estimate settings saved",
        successDescription: "Your paycheck tax setup is ready.",
      });
      return;
    }
    setCurrentStepIndex(nextIndex);
  }

  async function handleContinue() {
    await goToNextStep();
  }

  async function handleSkip() {
    applySkip(currentStep.id);
    await goToNextStep();
  }

  if (taxLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-muted-foreground">Loading tax profile...</p>
      </div>
    );
  }

  if (workspaceState.status !== "ready" || !activeWorkspaceId) {
    return null;
  }

  return (
    <div className="w-full">
      <StepShell
        title={currentStep.title}
        description={currentStep.description}
        currentIndex={currentStepIndex}
        totalSteps={steps.length}
      >
        {currentStep.id === "filing_status" ? (
          <ChoiceGrid
            value={formData.filingStatus}
            onChange={(value) =>
              updateField("filingStatus", value as TaxProfile.Type["filingStatus"])
            }
            options={[
              { value: "single", label: "Single", hint: "One filer" },
              {
                value: "marriedJoint",
                label: "Married filing jointly",
                hint: "Usually one shared return",
              },
              {
                value: "marriedSeparate",
                label: "Married filing separately",
                hint: "Separate returns",
              },
              {
                value: "headOfHousehold",
                label: "Head of household",
                hint: "Single parent or qualifying household",
              },
            ]}
          />
        ) : null}

        {currentStep.id === "dependents" ? (
          <NumberAdjuster
            label="Dependents"
            value={formData.dependents ?? 0}
            onChange={(value) => updateField("dependents", value)}
          />
        ) : null}

        {currentStep.id === "primary_state" ? (
          <StateDropdown
            id="cardPrimaryState"
            value={formData.state}
            onChange={handlePrimaryStateChange}
            label="Primary withholding state"
            required
          />
        ) : null}

        {currentStep.id === "multi_state" ? (
          <div className="rounded-2xl border px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="cardMultiStateWorker">I live or work in another state</Label>
                <p className="text-sm text-muted-foreground">
                  Leave this off unless your home state and work state are different.
                </p>
              </div>
              <Switch
                id="cardMultiStateWorker"
                checked={formData.multiStateWorker ?? false}
                onCheckedChange={handleMultiStateToggle}
              />
            </div>
          </div>
        ) : null}

        {currentStep.id === "residence_state" ? (
          <StateDropdown
            id="cardResidenceState"
            value={formData.residenceState}
            onChange={(value) => updateField("residenceState", value)}
            label="Residence state"
            required
          />
        ) : null}

        {currentStep.id === "work_state" ? (
          <StateDropdown
            id="cardWorkState"
            value={formData.workState}
            onChange={(value) => updateField("workState", value)}
            label="Work state"
            required
          />
        ) : null}

        {currentStep.id === "arkansas_withholding" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cardArkansasExemptions">Arkansas withholding exemptions</Label>
              <Input id="cardArkansasExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.arkansasExemptions)} onChange={(e) => updateField("arkansasExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardArkansasLowIncomeRates">Use Arkansas low-income rates</Label>
                <Switch id="cardArkansasLowIncomeRates" checked={formData.arkansasLowIncomeRates ?? false} onCheckedChange={(checked) => updateField("arkansasLowIncomeRates", checked)} />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "alabama_tax_details" ? (
          <div className="space-y-2">
            <Label htmlFor="cardAlabamaExemptionCode">Alabama A-4 exemption code</Label>
            <Select value={formData.alabamaExemptionCode ?? ""} onValueChange={(value) => updateField("alabamaExemptionCode", value ? value as TaxProfile.Type["alabamaExemptionCode"] : undefined)}>
              <SelectTrigger id="cardAlabamaExemptionCode">
                <SelectValue placeholder="Leave blank to estimate from filing status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="S">S</SelectItem>
                <SelectItem value="MS">MS</SelectItem>
                <SelectItem value="M">M</SelectItem>
                <SelectItem value="H">H</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {currentStep.id === "delaware_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardDelawareExemptions">Delaware withholding allowances</Label>
            <Input id="cardDelawareExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.delawareWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("delawareWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "colorado_deduction" ? (
          <div className="space-y-2">
            <Label htmlFor="cardColoradoDeductionAmount">Colorado DR 0004 annual deduction amount</Label>
            <Input id="cardColoradoDeductionAmount" type="number" min="0" inputMode="decimal" placeholder="Leave blank to use the default worksheet amount" value={getNumericInputValue(formData.coloradoDeductionAmount)} onChange={(e) => updateField("coloradoDeductionAmount", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "idaho_tax_details" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardIdahoAllowances">Idaho child tax credit allowances</Label>
                <Input id="cardIdahoAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.idahoAllowances)} onChange={(e) => updateField("idahoAllowances", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardIdahoAdditionalWithholding">Additional Idaho withholding per paycheck</Label>
                <Input id="cardIdahoAdditionalWithholding" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.idahoAdditionalWithholding)} onChange={(e) => updateField("idahoAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardIdahoExempt">Idaho exempt election</Label>
                <Switch id="cardIdahoExempt" checked={formData.idahoExempt ?? false} onCheckedChange={(checked) => updateField("idahoExempt", checked)} />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "kentucky_info" ? (
          <p className="text-sm text-muted-foreground">Kentucky payroll withholding uses a flat state approach. If reciprocity applies, use the reciprocity setting on the location card.</p>
        ) : null}

        {currentStep.id === "maine_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardMaineExemptions">Maine withholding allowances</Label>
                <Input id="cardMaineExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.maineWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("maineWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardMaineHigherSingleRate">Married but withhold at single rate</Label>
                    <Switch id="cardMaineHigherSingleRate" checked={formData.maineHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("maineHigherSingleRate", checked)} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {currentStep.id === "michigan_exemptions" ? (
          <div className="space-y-2">
            <Label htmlFor="cardMichiganExemptions">MI-W4 personal and dependent exemptions</Label>
            <Input id="cardMichiganExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.michiganExemptions)} onChange={(e) => updateField("michiganExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "louisiana_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardLouisianaDeductionClaim">Louisiana deduction claim</Label>
            <Select value={formData.louisianaDeductionClaim ?? ""} onValueChange={(value) => updateField("louisianaDeductionClaim", value ? value as TaxProfile.Type["louisianaDeductionClaim"] : undefined)}>
              <SelectTrigger id="cardLouisianaDeductionClaim">
                <SelectValue placeholder="Leave blank to estimate from filing status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0 - no standard deduction claim</SelectItem>
                <SelectItem value="1">1 - single or married filing separately</SelectItem>
                <SelectItem value="2">2 - married filing jointly or head of household</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {currentStep.id === "mississippi_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardMississippiExemptionAmount">Mississippi total exemption amount</Label>
                <Input id="cardMississippiExemptionAmount" type="number" min="0" step="1" inputMode="numeric" placeholder="Leave blank to estimate from filing status" value={getNumericInputValue(formData.mississippiExemptionAmount)} onChange={(e) => updateField("mississippiExemptionAmount", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardMississippiSpouseEmployed">Spouse also employed</Label>
                    <Switch id="cardMississippiSpouseEmployed" checked={formData.mississippiSpouseEmployed ?? false} onCheckedChange={(checked) => updateField("mississippiSpouseEmployed", checked)} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {currentStep.id === "missouri_withholding" ? (
          formData.filingStatus === "marriedJoint" ? (
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardMissouriSpouseDoesNotWork">Spouse does not work</Label>
                <Switch id="cardMissouriSpouseDoesNotWork" checked={formData.missouriSpouseDoesNotWork ?? false} onCheckedChange={(checked) => updateField("missouriSpouseDoesNotWork", checked)} />
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">This Missouri election only applies for married filing jointly setups.</p>
        ) : null}

        {currentStep.id === "minnesota_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardMinnesotaExemptions">Minnesota withholding allowances</Label>
            <Input id="cardMinnesotaExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.minnesotaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("minnesotaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "north_carolina_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardNorthCarolinaAllowances">NC-4 withholding allowances</Label>
            <Input id="cardNorthCarolinaAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.northCarolinaAllowances)} onChange={(e) => updateField("northCarolinaAllowances", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "north_dakota_info" ? (
          <p className="text-sm text-muted-foreground">North Dakota withholding follows the federal filing-status-based percentage method. If reciprocity applies, use the reciprocity setting on the location card.</p>
        ) : null}

        {currentStep.id === "rhode_island_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardRhodeIslandAllowances">RI-W4 total allowances</Label>
                <Input id="cardRhodeIslandAllowances" type="number" min="0" max="10" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.rhodeIslandAllowances)} onChange={(e) => updateField("rhodeIslandAllowances", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardRhodeIslandAdditionalWithholding">Additional Rhode Island withholding per paycheck</Label>
                <Input id="cardRhodeIslandAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.rhodeIslandAdditionalWithholding)} onChange={(e) => updateField("rhodeIslandAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardRhodeIslandExemptStatus">Rhode Island exemption status</Label>
              <Select value={formData.rhodeIslandExemptStatus ?? ""} onValueChange={(value) => updateField("rhodeIslandExemptStatus", value ? value as TaxProfile.Type["rhodeIslandExemptStatus"] : undefined)}>
                <SelectTrigger id="cardRhodeIslandExemptStatus">
                  <SelectValue placeholder="Select only if the employee claimed annual exemption" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXEMPT">EXEMPT</SelectItem>
                  <SelectItem value="EXEMPT-MS">EXEMPT-MS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        {currentStep.id === "south_carolina_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardSouthCarolinaExemptions">South Carolina withholding allowances</Label>
                <Input id="cardSouthCarolinaExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.southCarolinaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("southCarolinaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardSouthCarolinaExempt">South Carolina exempt election</Label>
                  <Switch id="cardSouthCarolinaExempt" checked={formData.southCarolinaExempt ?? false} onCheckedChange={(checked) => updateField("southCarolinaExempt", checked)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "district_of_columbia_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardDistrictOfColumbiaExemptions">DC D-4 allowances</Label>
                <Input id="cardDistrictOfColumbiaExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.districtOfColumbiaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("districtOfColumbiaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardDistrictOfColumbiaExempt">District exempt election</Label>
                  <Switch id="cardDistrictOfColumbiaExempt" checked={formData.districtOfColumbiaExempt ?? false} onCheckedChange={(checked) => updateField("districtOfColumbiaExempt", checked)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "vermont_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardVermontExemptions">Vermont withholding allowances</Label>
            <Input id="cardVermontExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.vermontWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("vermontWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "west_virginia_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardWestVirginiaExemptions">West Virginia IT-104 exemptions</Label>
                <Input id="cardWestVirginiaExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.westVirginiaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("westVirginiaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardWestVirginiaLowerRateElection">Use lower one-earner rate</Label>
                  <Switch id="cardWestVirginiaLowerRateElection" checked={formData.westVirginiaLowerRateElection ?? false} onCheckedChange={(checked) => updateField("westVirginiaLowerRateElection", checked)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "wisconsin_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardWisconsinExemptions">Wisconsin WT-4 exemptions</Label>
            <Input id="cardWisconsinExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.wisconsinWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("wisconsinWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
          </div>
        ) : null}

        {currentStep.id === "utah_info" ? (
          <p className="text-sm text-muted-foreground">Utah payroll withholding follows Utah Publication 14 based on your federal filing status. Head of household follows Utah’s single schedule.</p>
        ) : null}

        {currentStep.id === "arizona_withholding" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cardArizonaWithholdingPercent">Arizona withholding percentage (%)</Label>
              <Select
                value={
                  formData.arizonaWithholdingPercent != null
                    ? String(formData.arizonaWithholdingPercent)
                    : ""
                }
                onValueChange={(value) =>
                  updateField("arizonaWithholdingPercent", value ? Number(value) : undefined)
                }
              >
                <SelectTrigger id="cardArizonaWithholdingPercent">
                  <SelectValue placeholder="Use Arizona default 2.0% if left blank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5%</SelectItem>
                  <SelectItem value="1">1.0%</SelectItem>
                  <SelectItem value="1.5">1.5%</SelectItem>
                  <SelectItem value="2">2.0%</SelectItem>
                  <SelectItem value="2.5">2.5%</SelectItem>
                  <SelectItem value="3">3.0%</SelectItem>
                  <SelectItem value="3.5">3.5%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardArizonaExempt">Arizona exempt election</Label>
                <Switch
                  id="cardArizonaExempt"
                  checked={formData.arizonaExempt ?? false}
                  onCheckedChange={(checked) => updateField("arizonaExempt", checked)}
                />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "california_withholding" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cardCaliforniaRegularAllowances">DE 4 regular withholding allowances</Label>
              <Input
                id="cardCaliforniaRegularAllowances"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={getNumericInputValue(formData.californiaRegularAllowances)}
                onChange={(e) =>
                  updateField("californiaRegularAllowances", parseOptionalNumber(e.target.value))
                }
                className="text-right"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardCaliforniaEstimatedDeductionAllowances">DE 4 estimated-deduction allowances</Label>
              <Input
                id="cardCaliforniaEstimatedDeductionAllowances"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={getNumericInputValue(formData.californiaEstimatedDeductionAllowances)}
                onChange={(e) =>
                  updateField(
                    "californiaEstimatedDeductionAllowances",
                    parseOptionalNumber(e.target.value)
                  )
                }
                className="text-right"
              />
            </div>
          </div>
        ) : null}

        {currentStep.id === "connecticut_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardConnecticutWithholdingCode">CT-W4 withholding code</Label>
                <Select
                  value={formData.connecticutWithholdingCode ?? ""}
                  onValueChange={(value) =>
                    updateField(
                      "connecticutWithholdingCode",
                      value ? (value as TaxProfile.Type["connecticutWithholdingCode"]) : undefined
                    )
                  }
                >
                  <SelectTrigger id="cardConnecticutWithholdingCode">
                    <SelectValue placeholder="Leave blank to use the 6.99% no-form fallback" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
                    <SelectItem value="D">D</SelectItem>
                    <SelectItem value="E">E</SelectItem>
                    <SelectItem value="F">F</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardConnecticutFifteenDayExempt">Connecticut 15-day nonresident exemption</Label>
                  <Switch
                    id="cardConnecticutFifteenDayExempt"
                    checked={formData.connecticutFifteenDayExempt ?? false}
                    onCheckedChange={(checked) =>
                      updateField("connecticutFifteenDayExempt", checked)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardConnecticutAdditionalWithholding">CT-W4 additional withholding per paycheck</Label>
                <Input
                  id="cardConnecticutAdditionalWithholding"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={getNumericInputValue(formData.connecticutAdditionalWithholding)}
                  onChange={(e) =>
                    updateField("connecticutAdditionalWithholding", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardConnecticutReducedWithholding">CT-W4 reduced withholding per paycheck</Label>
                <Input
                  id="cardConnecticutReducedWithholding"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={getNumericInputValue(formData.connecticutReducedWithholding)}
                  onChange={(e) =>
                    updateField("connecticutReducedWithholding", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardConnecticutApportionmentPercent">CT-W4NA Connecticut work percentage (%)</Label>
              <Input
                id="cardConnecticutApportionmentPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                placeholder="Leave blank unless using CT-W4NA"
                value={getNumericInputValue(formData.connecticutNonresidentApportionmentPercent)}
                onChange={(e) =>
                  updateField(
                    "connecticutNonresidentApportionmentPercent",
                    parseOptionalNumber(e.target.value)
                  )
                }
                className="text-right"
              />
            </div>
          </div>
        ) : null}

        {currentStep.id === "illinois_allowances" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cardIllinoisAllowanceLine1">IL-W-4 Line 1 allowances</Label>
              <Input
                id="cardIllinoisAllowanceLine1"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={getNumericInputValue(formData.illinoisAllowanceLine1)}
                onChange={(e) =>
                  updateField("illinoisAllowanceLine1", parseOptionalNumber(e.target.value))
                }
                className="text-right"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardIllinoisAllowanceLine2">IL-W-4 Line 2 allowances</Label>
              <Input
                id="cardIllinoisAllowanceLine2"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={getNumericInputValue(formData.illinoisAllowanceLine2)}
                onChange={(e) =>
                  updateField("illinoisAllowanceLine2", parseOptionalNumber(e.target.value))
                }
                className="text-right"
              />
            </div>
          </div>
        ) : null}

        {currentStep.id === "georgia_withholding" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cardGeorgiaAllowanceCount">Georgia G-4 total allowances</Label>
              <Input
                id="cardGeorgiaAllowanceCount"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="Leave blank to fall back to dependents"
                value={getNumericInputValue(formData.georgiaAllowanceCount)}
                onChange={(e) =>
                  updateField("georgiaAllowanceCount", parseOptionalNumber(e.target.value))
                }
                className="text-right"
              />
            </div>
            {formData.filingStatus === "marriedJoint" ? (
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardGeorgiaMarriedBothWorking">Both spouses work</Label>
                  <Switch
                    id="cardGeorgiaMarriedBothWorking"
                    checked={formData.georgiaMarriedBothWorking ?? false}
                    onCheckedChange={(checked) => updateField("georgiaMarriedBothWorking", checked)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "massachusetts_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardMassachusettsExemptions">Massachusetts M-4 total exemptions</Label>
                <Input
                  id="cardMassachusettsExemptions"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.massachusettsExemptions)}
                  onChange={(e) =>
                    updateField("massachusettsExemptions", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardMassachusettsBlindExemptions">Massachusetts blindness exemptions</Label>
                <Select
                  value={
                    formData.massachusettsBlindExemptions != null
                      ? String(formData.massachusettsBlindExemptions)
                      : "0"
                  }
                  onValueChange={(value) =>
                    updateField("massachusettsBlindExemptions", Number(value))
                  }
                >
                  <SelectTrigger id="cardMassachusettsBlindExemptions">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardMassachusettsAdditionalWithholding">Massachusetts additional withholding per paycheck</Label>
              <Input
                id="cardMassachusettsAdditionalWithholding"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={getNumericInputValue(formData.massachusettsAdditionalWithholding)}
                onChange={(e) =>
                  updateField(
                    "massachusettsAdditionalWithholding",
                    parseOptionalNumber(e.target.value)
                  )
                }
                className="text-right"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardMassachusettsFullTimeStudentExempt">Full-time student low-income exemption</Label>
                  <Switch
                    id="cardMassachusettsFullTimeStudentExempt"
                    checked={formData.massachusettsFullTimeStudentExempt ?? false}
                    onCheckedChange={(checked) =>
                      updateField("massachusettsFullTimeStudentExempt", checked)
                    }
                  />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardMassachusettsMsrraExempt">MSRRA exempt</Label>
                  <Switch
                    id="cardMassachusettsMsrraExempt"
                    checked={formData.massachusettsMsrraExempt ?? false}
                    onCheckedChange={(checked) => updateField("massachusettsMsrraExempt", checked)}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "hawaii_withholding" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cardHawaiiExemptions">Hawaii HW-4 allowances</Label>
              <Input
                id="cardHawaiiExemptions"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={getNumericInputValue(formData.hawaiiWithholdingExemptions ?? formData.stateWithholdingExemptions)}
                onChange={(e) =>
                  updateField("hawaiiWithholdingExemptions", parseOptionalNumber(e.target.value))
                }
                className="text-right"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardHawaiiHigherSingleRate">Married but withhold at higher single rate</Label>
                    <Switch
                      id="cardHawaiiHigherSingleRate"
                      checked={formData.hawaiiHigherSingleRate ?? false}
                      onCheckedChange={(checked) => updateField("hawaiiHigherSingleRate", checked)}
                    />
                  </div>
                </div>
              ) : null}
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardHawaiiCertifiedDisabled">Certified disabled person</Label>
                  <Switch
                    id="cardHawaiiCertifiedDisabled"
                    checked={formData.hawaiiCertifiedDisabled ?? false}
                    onCheckedChange={(checked) => updateField("hawaiiCertifiedDisabled", checked)}
                  />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4 md:col-span-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardHawaiiNonresidentMilitarySpouse">Nonresident military spouse</Label>
                  <Switch
                    id="cardHawaiiNonresidentMilitarySpouse"
                    checked={formData.hawaiiNonresidentMilitarySpouse ?? false}
                    onCheckedChange={(checked) =>
                      updateField("hawaiiNonresidentMilitarySpouse", checked)
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "iowa_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardIowaAllowanceAmount">Iowa IA W-4 total allowance amount</Label>
                <Input
                  id="cardIowaAllowanceAmount"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.iowaAllowanceAmount)}
                  onChange={(e) =>
                    updateField("iowaAllowanceAmount", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardIowaAdditionalWithholding">Additional Iowa withholding per paycheck</Label>
                <Input
                  id="cardIowaAdditionalWithholding"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={getNumericInputValue(formData.iowaAdditionalWithholding)}
                  onChange={(e) =>
                    updateField("iowaAdditionalWithholding", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            {formData.filingStatus === "marriedJoint" ? (
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardIowaSpouseHasIncome">Spouse also has earned income</Label>
                  <Switch
                    id="cardIowaSpouseHasIncome"
                    checked={formData.iowaSpouseHasIncome ?? false}
                    onCheckedChange={(checked) => updateField("iowaSpouseHasIncome", checked)}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardIowaExempt">Iowa exempt election</Label>
                  <Switch
                    id="cardIowaExempt"
                    checked={formData.iowaExempt ?? false}
                    onCheckedChange={(checked) => updateField("iowaExempt", checked)}
                  />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardIowaMilitarySpouseExempt">Iowa military spouse exemption</Label>
                  <Switch
                    id="cardIowaMilitarySpouseExempt"
                    checked={formData.iowaMilitarySpouseExempt ?? false}
                    onCheckedChange={(checked) =>
                      updateField("iowaMilitarySpouseExempt", checked)
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "kansas_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardKansasAllowanceRate">Kansas K-4 allowance rate</Label>
                <Select
                  value={formData.kansasAllowanceRate ?? ""}
                  onValueChange={(value) =>
                    updateField(
                      "kansasAllowanceRate",
                      value ? (value as TaxProfile.Type["kansasAllowanceRate"]) : undefined
                    )
                  }
                >
                  <SelectTrigger id="cardKansasAllowanceRate">
                    <SelectValue placeholder="Leave blank to estimate from filing status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single rate</SelectItem>
                    <SelectItem value="joint">Joint rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardKansasAdditionalWithholding">Additional Kansas withholding per paycheck</Label>
                <Input
                  id="cardKansasAdditionalWithholding"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.kansasAdditionalWithholding)}
                  onChange={(e) =>
                    updateField("kansasAdditionalWithholding", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardKansasExempt">Kansas exempt election</Label>
                <Switch
                  id="cardKansasExempt"
                  checked={formData.kansasExempt ?? false}
                  onCheckedChange={(checked) => updateField("kansasExempt", checked)}
                />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "oklahoma_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOklahomaAllowances">OK-W-4 withholding allowances</Label>
                <Input
                  id="cardOklahomaAllowances"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.oklahomaAllowances)}
                  onChange={(e) =>
                    updateField("oklahomaAllowances", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOklahomaAdditionalWithholding">Additional Oklahoma withholding per paycheck</Label>
                <Input
                  id="cardOklahomaAdditionalWithholding"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.oklahomaAdditionalWithholding)}
                  onChange={(e) =>
                    updateField("oklahomaAdditionalWithholding", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardOklahomaHigherSingleRate">Married but withhold at higher single rate</Label>
                    <Switch
                      id="cardOklahomaHigherSingleRate"
                      checked={formData.oklahomaHigherSingleRate ?? false}
                      onCheckedChange={(checked) => updateField("oklahomaHigherSingleRate", checked)}
                    />
                  </div>
                </div>
              ) : null}
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOklahomaExempt">Oklahoma exempt election</Label>
                  <Switch
                    id="cardOklahomaExempt"
                    checked={formData.oklahomaExempt ?? false}
                    onCheckedChange={(checked) => updateField("oklahomaExempt", checked)}
                  />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOklahomaMilitarySpouseExempt">Military spouse exempt</Label>
                  <Switch
                    id="cardOklahomaMilitarySpouseExempt"
                    checked={formData.oklahomaMilitarySpouseExempt ?? false}
                    onCheckedChange={(checked) =>
                      updateField("oklahomaMilitarySpouseExempt", checked)
                    }
                  />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOklahomaMilitaryIncomeExempt">Active-duty military income exempt</Label>
                  <Switch
                    id="cardOklahomaMilitaryIncomeExempt"
                    checked={formData.oklahomaMilitaryIncomeExempt ?? false}
                    onCheckedChange={(checked) =>
                      updateField("oklahomaMilitaryIncomeExempt", checked)
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "new_mexico_withholding" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {formData.filingStatus === "marriedJoint" ? (
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardNewMexicoHigherSingleRate">Use higher single rate</Label>
                  <Switch
                    id="cardNewMexicoHigherSingleRate"
                    checked={formData.newMexicoHigherSingleRate ?? false}
                    onCheckedChange={(checked) =>
                      updateField("newMexicoHigherSingleRate", checked)
                    }
                  />
                </div>
              </div>
            ) : null}
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardNewMexicoExempt">New Mexico exempt election</Label>
                <Switch
                  id="cardNewMexicoExempt"
                  checked={formData.newMexicoExempt ?? false}
                  onCheckedChange={(checked) => updateField("newMexicoExempt", checked)}
                />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardNewMexicoMilitarySpouseExempt">Military spouse exempt</Label>
                <Switch
                  id="cardNewMexicoMilitarySpouseExempt"
                  checked={formData.newMexicoMilitarySpouseExempt ?? false}
                  onCheckedChange={(checked) =>
                    updateField("newMexicoMilitarySpouseExempt", checked)
                  }
                />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardNewMexicoNativeAmericanExempt">Qualifying tribal-income exempt</Label>
                <Switch
                  id="cardNewMexicoNativeAmericanExempt"
                  checked={formData.newMexicoNativeAmericanExempt ?? false}
                  onCheckedChange={(checked) =>
                    updateField("newMexicoNativeAmericanExempt", checked)
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "montana_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardMontanaBothSpousesWorking">Both spouses work</Label>
                    <Switch
                      id="cardMontanaBothSpousesWorking"
                      checked={formData.montanaBothSpousesWorking ?? false}
                      onCheckedChange={(checked) =>
                        updateField("montanaBothSpousesWorking", checked)
                      }
                    />
                  </div>
                </div>
              ) : null}
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardMontanaExempt">Montana exempt election</Label>
                  <Switch
                    id="cardMontanaExempt"
                    checked={formData.montanaExempt ?? false}
                    onCheckedChange={(checked) => updateField("montanaExempt", checked)}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "nebraska_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardNebraskaExemptions">Nebraska withholding allowances</Label>
                <Input
                  id="cardNebraskaExemptions"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.nebraskaWithholdingExemptions ?? formData.stateWithholdingExemptions)}
                  onChange={(e) =>
                    updateField("nebraskaWithholdingExemptions", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardNebraskaExempt">Nebraska exempt election</Label>
                  <Switch
                    id="cardNebraskaExempt"
                    checked={formData.nebraskaExempt ?? false}
                    onCheckedChange={(checked) => updateField("nebraskaExempt", checked)}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "new_jersey_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardNewJerseyRateTable">NJ-W4 rate table letter</Label>
                <Select
                  value={formData.newJerseyRateTable ?? ""}
                  onValueChange={(value) =>
                    updateField(
                      "newJerseyRateTable",
                      value ? (value as TaxProfile.Type["newJerseyRateTable"]) : undefined
                    )
                  }
                >
                  <SelectTrigger id="cardNewJerseyRateTable">
                    <SelectValue placeholder="Leave blank to use the default A or B table" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
                    <SelectItem value="D">D</SelectItem>
                    <SelectItem value="E">E</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardNewJerseyAllowances">NJ-W4 total allowances</Label>
                <Input
                  id="cardNewJerseyAllowances"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.newJerseyAllowances)}
                  onChange={(e) =>
                    updateField("newJerseyAllowances", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardNewJerseyExempt">New Jersey exempt election</Label>
                <Switch
                  id="cardNewJerseyExempt"
                  checked={formData.newJerseyExempt ?? false}
                  onCheckedChange={(checked) => updateField("newJerseyExempt", checked)}
                />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "virginia_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardVirginiaPersonalExemptions">VA-4 personal and dependent exemptions</Label>
                <Input
                  id="cardVirginiaPersonalExemptions"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.virginiaPersonalExemptions)}
                  onChange={(e) =>
                    updateField("virginiaPersonalExemptions", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardVirginiaAgeBlindExemptions">VA-4 age 65 / blindness exemptions</Label>
                <Input
                  id="cardVirginiaAgeBlindExemptions"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={getNumericInputValue(formData.virginiaAgeBlindExemptions)}
                  onChange={(e) =>
                    updateField("virginiaAgeBlindExemptions", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardVirginiaExempt">Virginia exempt election</Label>
                <Switch
                  id="cardVirginiaExempt"
                  checked={formData.virginiaExempt ?? false}
                  onCheckedChange={(checked) => updateField("virginiaExempt", checked)}
                />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "maryland_withholding" ? (
          <div className="space-y-2">
            <Label htmlFor="cardMarylandExemptions">Maryland MW507 withholding exemptions</Label>
            <Input
              id="cardMarylandExemptions"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="Leave blank to fall back to dependents"
              value={getNumericInputValue(formData.marylandWithholdingExemptions ?? formData.stateWithholdingExemptions)}
              onChange={(e) =>
                updateField("marylandWithholdingExemptions", parseOptionalNumber(e.target.value))
              }
              className="text-right"
            />
          </div>
        ) : null}

        {currentStep.id === "indiana_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardIndianaPersonalExemptions">WH-4 line 5 personal exemptions</Label>
                <Input id="cardIndianaPersonalExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaPersonalExemptions)} onChange={(e) => updateField("indianaPersonalExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardIndianaDependentExemptions">WH-4 line 6 dependent exemptions</Label>
                <Input id="cardIndianaDependentExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaDependentExemptions)} onChange={(e) => updateField("indianaDependentExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardIndianaFirstTimeDependentExemptions">WH-4 line 7 first-time dependent exemptions</Label>
                <Input id="cardIndianaFirstTimeDependentExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaFirstTimeDependentExemptions)} onChange={(e) => updateField("indianaFirstTimeDependentExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardIndianaAdoptedChildExemptions">WH-4 line 8 adopted child exemptions</Label>
                <Input id="cardIndianaAdoptedChildExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaAdoptedChildExemptions)} onChange={(e) => updateField("indianaAdoptedChildExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardIndianaAdditionalStateWithholding">WH-4 line 9 extra state withholding</Label>
                <Input id="cardIndianaAdditionalStateWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.indianaAdditionalStateWithholding)} onChange={(e) => updateField("indianaAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardIndianaAdditionalCountyWithholding">WH-4 line 10 extra county withholding</Label>
                <Input id="cardIndianaAdditionalCountyWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.indianaAdditionalCountyWithholding)} onChange={(e) => updateField("indianaAdditionalCountyWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardIndianaThirtyDayExempt">30-day nonresident waiver</Label>
                  <Switch id="cardIndianaThirtyDayExempt" checked={formData.indianaNonresidentThirtyDayExempt ?? false} onCheckedChange={(checked) => updateField("indianaNonresidentThirtyDayExempt", checked)} />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardIndianaMilitarySpouseExempt">Nonresident military spouse exempt</Label>
                  <Switch id="cardIndianaMilitarySpouseExempt" checked={formData.indianaNonresidentMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("indianaNonresidentMilitarySpouseExempt", checked)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "ohio_tax_details" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOhioExemptions">Ohio IT-4 total exemptions</Label>
                <Input id="cardOhioExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.ohioExemptions)} onChange={(e) => updateField("ohioExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOhioAdditionalWithholding">Additional Ohio withholding per paycheck</Label>
                <Input id="cardOhioAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.ohioAdditionalStateWithholding)} onChange={(e) => updateField("ohioAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOhioSchoolDistrictNumber">Ohio school district number</Label>
                <Input id="cardOhioSchoolDistrictNumber" inputMode="numeric" placeholder="4-digit tax district number" value={formData.ohioSchoolDistrictNumber ?? ""} onChange={(e) => updateField("ohioSchoolDistrictNumber", e.target.value || undefined)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOhioSchoolDistrictRate">Ohio school district income tax rate (%)</Label>
                <Input id="cardOhioSchoolDistrictRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.25" value={getNumericInputValue(formData.ohioSchoolDistrictIncomeTaxRate)} onChange={(e) => updateField("ohioSchoolDistrictIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOhioMunicipalRate">Ohio municipal income tax rate (%)</Label>
                <Input id="cardOhioMunicipalRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 2.50" value={getNumericInputValue(formData.ohioMunicipalIncomeTaxRate)} onChange={(e) => updateField("ohioMunicipalIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOhioJeddRate">Ohio JEDD/JEDZ rate (%)</Label>
                <Input id="cardOhioJeddRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.00" value={getNumericInputValue(formData.ohioJeddJedzIncomeTaxRate)} onChange={(e) => updateField("ohioJeddJedzIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border px-4 py-4"><div className="flex items-center justify-between gap-4"><Label htmlFor="cardOhioResidentMilitaryOutsideOhioExempt">Ohio resident active-duty military exemption</Label><Switch id="cardOhioResidentMilitaryOutsideOhioExempt" checked={formData.ohioResidentMilitaryOutsideOhioExempt ?? false} onCheckedChange={(checked) => updateField("ohioResidentMilitaryOutsideOhioExempt", checked)} /></div></div>
              <div className="rounded-2xl border px-4 py-4"><div className="flex items-center justify-between gap-4"><Label htmlFor="cardOhioNonresidentMilitaryExempt">Ohio nonresident military exemption</Label><Switch id="cardOhioNonresidentMilitaryExempt" checked={formData.ohioNonresidentMilitaryExempt ?? false} onCheckedChange={(checked) => updateField("ohioNonresidentMilitaryExempt", checked)} /></div></div>
              <div className="rounded-2xl border px-4 py-4"><div className="flex items-center justify-between gap-4"><Label htmlFor="cardOhioNonresidentMilitarySpouseExempt">Ohio nonresident military spouse exemption</Label><Switch id="cardOhioNonresidentMilitarySpouseExempt" checked={formData.ohioNonresidentMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("ohioNonresidentMilitarySpouseExempt", checked)} /></div></div>
              <div className="rounded-2xl border px-4 py-4"><div className="flex items-center justify-between gap-4"><Label htmlFor="cardOhioStatutoryExempt">Ohio statutory withholding exemption</Label><Switch id="cardOhioStatutoryExempt" checked={formData.ohioStatutoryExempt ?? false} onCheckedChange={(checked) => updateField("ohioStatutoryExempt", checked)} /></div></div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "new_york_withholding" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardNewYorkExemptions">IT-2104 withholding allowances</Label>
                <Input id="cardNewYorkExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.newYorkWithholdingExemptions)} onChange={(e) => updateField("newYorkWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardNewYorkAdditionalWithholding">Additional New York State withholding</Label>
                <Input id="cardNewYorkAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.newYorkAdditionalStateWithholding)} onChange={(e) => updateField("newYorkAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardNewYorkLocality">New York local withholding category</Label>
                <Select value={formData.newYorkLocality ?? ""} onValueChange={(value) => updateField("newYorkLocality", value ? value as TaxProfile.Type["newYorkLocality"] : undefined)}>
                  <SelectTrigger id="cardNewYorkLocality">
                    <SelectValue placeholder="Select if applicable" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new_york_city_resident">New York City resident</SelectItem>
                    <SelectItem value="yonkers_resident">Yonkers resident</SelectItem>
                    <SelectItem value="yonkers_nonresident">Yonkers nonresident earning wages in Yonkers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardNewYorkExempt">New York State exempt election</Label>
                  <Switch id="cardNewYorkExempt" checked={formData.newYorkExempt ?? false} onCheckedChange={(checked) => updateField("newYorkExempt", checked)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "oregon_tax_details" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOregonAllowances">Oregon OR-W-4 allowances</Label>
                <Input id="cardOregonAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.oregonAllowances)} onChange={(e) => updateField("oregonAllowances", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOregonAdditionalWithholding">Additional Oregon withholding per paycheck</Label>
                <Input id="cardOregonAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.oregonAdditionalWithholding)} onChange={(e) => updateField("oregonAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {formData.filingStatus === "marriedJoint" ? (
                <div className="rounded-2xl border px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="cardOregonHigherSingleRate">Married but withhold at higher single rate</Label>
                    <Switch id="cardOregonHigherSingleRate" checked={formData.oregonHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("oregonHigherSingleRate", checked)} />
                  </div>
                </div>
              ) : null}
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOregonExempt">Oregon exempt election</Label>
                  <Switch id="cardOregonExempt" checked={formData.oregonExempt ?? false} onCheckedChange={(checked) => updateField("oregonExempt", checked)} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOregonMetroLocation">Works within Metro</Label>
                  <Switch id="cardOregonMetroLocation" checked={formData.oregonMetroLocation ?? false} onCheckedChange={(checked) => updateField("oregonMetroLocation", checked)} />
                </div>
              </div>
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="cardOregonMultnomahCountyLocation">Works within Multnomah County</Label>
                  <Switch id="cardOregonMultnomahCountyLocation" checked={formData.oregonMultnomahCountyLocation ?? false} onCheckedChange={(checked) => updateField("oregonMultnomahCountyLocation", checked)} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardOregonMetroElection">Metro SHS withholding election</Label>
                <Select value={formData.oregonMetroWithholdingElection ?? "auto"} onValueChange={(value) => updateField("oregonMetroWithholdingElection", value as TaxProfile.Type["oregonMetroWithholdingElection"])}>
                  <SelectTrigger id="cardOregonMetroElection"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic employer withholding</SelectItem>
                    <SelectItem value="opt_in">Employee opted in</SelectItem>
                    <SelectItem value="opt_out">Employee opted out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardOregonPfaElection">Multnomah PFA withholding election</Label>
                <Select value={formData.oregonPfaWithholdingElection ?? "auto"} onValueChange={(value) => updateField("oregonPfaWithholdingElection", value as TaxProfile.Type["oregonPfaWithholdingElection"])}>
                  <SelectTrigger id="cardOregonPfaElection"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic employer withholding</SelectItem>
                    <SelectItem value="opt_in">Employee opted in</SelectItem>
                    <SelectItem value="opt_out">Employee opted out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "pennsylvania_local_tax" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardPennsylvaniaResidentPsdCode">Resident PSD code</Label>
                <Input id="cardPennsylvaniaResidentPsdCode" inputMode="numeric" placeholder="6-digit PSD code" value={formData.pennsylvaniaResidentPsdCode ?? ""} onChange={(e) => updateField("pennsylvaniaResidentPsdCode", e.target.value || undefined)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardPennsylvaniaResidentEitRate">Resident total EIT rate (%)</Label>
                <Input id="cardPennsylvaniaResidentEitRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.00" value={getNumericInputValue(formData.pennsylvaniaResidentEitRate)} onChange={(e) => updateField("pennsylvaniaResidentEitRate", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardPennsylvaniaWorkPsdCode">Work PSD code</Label>
                <Input id="cardPennsylvaniaWorkPsdCode" inputMode="numeric" placeholder="6-digit PSD code" value={formData.pennsylvaniaWorkPsdCode ?? ""} onChange={(e) => updateField("pennsylvaniaWorkPsdCode", e.target.value || undefined)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardPennsylvaniaWorkNonResidentEitRate">Work nonresident EIT rate (%)</Label>
                <Input id="cardPennsylvaniaWorkNonResidentEitRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 0.50" value={getNumericInputValue(formData.pennsylvaniaWorkNonResidentEitRate)} onChange={(e) => updateField("pennsylvaniaWorkNonResidentEitRate", parseOptionalNumber(e.target.value))} className="text-right" />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "location_local_details" ? (
          <div className="space-y-6">
            {!formData.multiStateWorker ? (
              <p className="text-sm text-muted-foreground">
                If you live and work in one state, residence and work states stay matched to your primary state automatically.
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardResidenceCounty">{marylandResidentSelected ? "Residence county *" : "Residence county"}</Label>
                <Input id="cardResidenceCounty" placeholder="Optional" value={formData.residenceCounty ?? ""} onChange={(e) => updateField("residenceCounty", e.target.value || undefined)} />
                {marylandResidentSelected && !(formData.residenceCounty ?? "").trim() ? <p className="text-xs text-destructive">Required for Maryland resident paycheck estimates.</p> : null}
                {indianaResidentSelected ? <p className="text-xs text-muted-foreground">Indiana county withholding uses your Indiana county of residence as of January 1.</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardWorkCounty">Work county</Label>
                <Input id="cardWorkCounty" placeholder="Optional" value={formData.workCounty ?? ""} onChange={(e) => updateField("workCounty", e.target.value || undefined)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardResidenceCity">Residence city</Label>
                <Input id="cardResidenceCity" placeholder="Optional" value={formData.residenceCity ?? ""} onChange={(e) => updateField("residenceCity", e.target.value || undefined)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardWorkCity">Work city</Label>
                <Input id="cardWorkCity" placeholder="Optional" value={formData.workCity ?? ""} onChange={(e) => updateField("workCity", e.target.value || undefined)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardPostalCode">Postal code</Label>
                <Input id="cardPostalCode" placeholder="Optional" value={formData.postalCode ?? ""} onChange={(e) => updateField("postalCode", e.target.value || undefined)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardSchoolDistrictId">School district / district code</Label>
                <Input id="cardSchoolDistrictId" placeholder="Optional" value={formData.schoolDistrictId ?? ""} onChange={(e) => updateField("schoolDistrictId", e.target.value || undefined)} />
              </div>
            </div>
            {(localTaxStateSelected || formData.multiStateWorker) ? (
              <div className="space-y-2">
                <Label htmlFor="cardLocalTaxJurisdictionIds">Known local tax IDs</Label>
                <Input id="cardLocalTaxJurisdictionIds" placeholder="Optional" value={formatList(formData.localTaxJurisdictionIds)} onChange={(e) => updateField("localTaxJurisdictionIds", parseCommaSeparatedList(e.target.value))} />
              </div>
            ) : null}
            <div className="rounded-2xl border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cardReciprocityElection">Reciprocity applies</Label>
                <Switch id="cardReciprocityElection" checked={formData.reciprocityElection ?? false} onCheckedChange={(checked) => updateField("reciprocityElection", checked)} />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "washington_payroll_programs" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cardPfmlPercent">PFML (%)</Label>
              <Input id="cardPfmlPercent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={getNumericInputValue(formData.pfmlPercent)} onChange={(e) => updateField("pfmlPercent", parseOptionalNumber(e.target.value))} className="text-right" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardWaCaresPercent">WA Cares (%)</Label>
              <Input id="cardWaCaresPercent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={getNumericInputValue(formData.waCaresPercent)} onChange={(e) => updateField("waCaresPercent", parseOptionalNumber(e.target.value))} className="text-right" />
            </div>
          </div>
        ) : null}

        {currentStep.id === "federal_exempt" ? (
          <ChoiceGrid
            value={
              formData.federalExempt == null ? undefined : formData.federalExempt ? "yes" : "no"
            }
            onChange={(value) => updateField("federalExempt", value === "yes")}
            options={[
              { value: "no", label: "No", hint: "Most users choose this" },
              { value: "yes", label: "Yes", hint: "Only if you claimed exempt on your W-4" },
            ]}
          />
        ) : null}

        {currentStep.id === "w4_details_gate" ? (
          <ChoiceGrid
            value={advancedW4Selection}
            onChange={(value) => {
              if (value === "yes") {
                setAdvancedW4Selection("yes");
                setAdvancedW4Enabled(true);
                if (formData.federalMultipleJobsCheckbox == null) {
                  updateField("federalMultipleJobsCheckbox", false);
                }
                return;
              }
              setAdvancedW4Selection("no");
              setAdvancedW4Enabled(false);
              updateField("federalMultipleJobsCheckbox", undefined);
              updateField("federalStep3Credits", undefined);
              updateField("federalOtherIncome", undefined);
              updateField("federalDeductions", undefined);
            }}
            options={[
              { value: "yes", label: "Yes, I entered extra W-4 details", hint: "Continue to the extra federal questions" },
              { value: "no", label: "No", hint: "Skip the extra federal questions" },
            ]}
          />
        ) : null}

        {currentStep.id === "federal_multiple_jobs" ? (
          <ChoiceGrid
            value={
              formData.federalMultipleJobsCheckbox == null
                ? undefined
                : formData.federalMultipleJobsCheckbox
                ? "yes"
                : "no"
            }
            onChange={(value) => updateField("federalMultipleJobsCheckbox", value === "yes")}
            options={[
              { value: "no", label: "No", hint: "Single job or box not checked" },
              { value: "yes", label: "Yes", hint: "Checked Step 2(c)" },
            ]}
          />
        ) : null}

        {currentStep.id === "federal_step3_credits" ? (
          <div className="space-y-2">
            <Label htmlFor="cardFederalStep3Credits">Yearly W-4 Step 3 credits</Label>
            <Input
              id="cardFederalStep3Credits"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Leave blank if unused"
              value={getNumericInputValue(formData.federalStep3Credits)}
              onChange={(e) =>
                updateField("federalStep3Credits", parseOptionalNumber(e.target.value))
              }
              className="text-right"
            />
          </div>
        ) : null}

        {currentStep.id === "federal_other_income" ? (
          <div className="space-y-2">
            <Label htmlFor="cardFederalOtherIncome">Yearly W-4 other income</Label>
            <Input
              id="cardFederalOtherIncome"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Leave blank if unused"
              value={getNumericInputValue(formData.federalOtherIncome)}
              onChange={(e) =>
                updateField("federalOtherIncome", parseOptionalNumber(e.target.value))
              }
              className="text-right"
            />
          </div>
        ) : null}

        {currentStep.id === "federal_deductions" ? (
          <div className="space-y-2">
            <Label htmlFor="cardFederalDeductions">Yearly W-4 deductions</Label>
            <Input
              id="cardFederalDeductions"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Leave blank if unused"
              value={getNumericInputValue(formData.federalDeductions)}
              onChange={(e) =>
                updateField("federalDeductions", parseOptionalNumber(e.target.value))
              }
              className="text-right"
            />
          </div>
        ) : null}

        {currentStep.id === "pre_tax_deductions" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardRetirement401kType">401(k) contribution type</Label>
                <Select
                  value={formData.retirement401kType}
                  onValueChange={(value) =>
                    updateField(
                      "retirement401kType",
                      value as TaxProfile.Type["retirement401kType"]
                    )
                  }
                >
                  <SelectTrigger id="cardRetirement401kType">
                    <SelectValue placeholder="Select a 401(k) type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="traditional">Traditional (pre-tax)</SelectItem>
                    <SelectItem value="roth">Roth (after-tax)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardRetirement401kPercent">401(k) percent of pay</Label>
                <Input
                  id="cardRetirement401kPercent"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="Leave blank if unused"
                  value={getNumericInputValue(formData.retirement401kPercent)}
                  onChange={(e) =>
                    updateField("retirement401kPercent", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardRetirement401kFlat">401(k) flat amount</Label>
                <Input
                  id="cardRetirement401kFlat"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if unused"
                  value={getNumericInputValue(formData.retirement401kFlat)}
                  onChange={(e) =>
                    updateField("retirement401kFlat", parseOptionalNumber(e.target.value))
                  }
                  className="text-right"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardInsurancePremium">Insurance premium per paycheck</Label>
                <Input
                  id="cardInsurancePremium"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if unused"
                  value={getNumericInputValue(formData.insurancePremium)}
                  onChange={(e) => {
                    const nextValue = parseOptionalNumber(e.target.value);
                    updateField("insurancePremium", nextValue);
                    if ((nextValue ?? 0) <= 0) {
                      updateField("insurancePreTax", false);
                    }
                  }}
                  className="text-right"
                />
              </div>
            </div>

            {insurancePremiumEntered ? (
              <div className="rounded-2xl border px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="cardInsurancePreTax">Deduct insurance before taxes</Label>
                  </div>
                  <Switch
                    id="cardInsurancePreTax"
                    checked={formData.insurancePreTax ?? false}
                    onCheckedChange={(checked) => updateField("insurancePreTax", checked)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "extra_withholding" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cardAdditionalFederalWithholding">
                Extra federal withholding
              </Label>
              <Input
                id="cardAdditionalFederalWithholding"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="Leave blank if unused"
                value={getNumericInputValue(formData.additionalFederalWithholding)}
                onChange={(e) =>
                  updateField(
                    "additionalFederalWithholding",
                    parseOptionalNumber(e.target.value)
                  )
                }
                className="text-right"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardAdditionalStateWithholding">Extra state withholding</Label>
              <Input
                id="cardAdditionalStateWithholding"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="Leave blank if unused"
                value={getNumericInputValue(formData.additionalStateWithholding)}
                onChange={(e) =>
                  updateField(
                    "additionalStateWithholding",
                    parseOptionalNumber(e.target.value)
                  )
                }
                className="text-right"
              />
            </div>
          </div>
        ) : null}

        {isInitialSetup ? (
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentStepIndex === 0}
            >
              Back
            </Button>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {currentStep.skippable ? (
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => void handleSkip()}>
                  Skip
                </Button>
              ) : null}
              <Button type="button" className="w-full sm:w-auto" onClick={() => void handleContinue()} disabled={!isStepComplete(currentStep.id)}>
                {currentStepIndex === steps.length - 1 ? "Finish Setup" : "Continue"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentStepIndex === 0}
            >
              Previous
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onClose?.()}>
              Done
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
              disabled={currentStepIndex === steps.length - 1}
            >
              Next
            </Button>
          </div>
        )}
      </StepShell>
    </div>
  );
}
