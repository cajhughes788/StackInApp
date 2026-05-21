//frontend/components/tax/TaxForm
"use client";
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { StateDropdown } from "./StateDropdown";
import { useToast } from "@/hooks/use-toast";
import * as taxProfileService from "@/lib/domain/taxProfileService";
import { TaxProfile } from "@shared/schemas";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";

const LOCAL_TAX_STATES = new Set([
    "Maryland",
    "Ohio",
    "Indiana",
    "NewYork",
    "Pennsylvania",
    "Oregon",
]);
const LOCATION_DETAIL_STATES = new Set([
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
]);

const EMPTY_FORM: TaxProfile.InputType = {
    filingStatus: "single",
    dependents: 0,
    insurancePreTax: true,
    state: "" as TaxProfile.InputType["state"], // user must choose before save
    localTaxJurisdictionIds: [],
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

function FieldHint({ children }: { children: React.ReactNode; }) {
    return <p className="text-xs text-muted-foreground">{children}</p>;
}
function LabelWithInfo({ htmlFor, label, info, className }: {
    htmlFor: string;
    label: React.ReactNode;
    info: React.ReactNode;
    className?: string;
}) {
    return (<div className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className={className}>
        {label}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`More info about ${typeof label === "string" ? label : htmlFor}`}>
            <Info className="w-4 h-4"/>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 text-sm" align="start" sideOffset={4}>
          <div className="space-y-2">{info}</div>
        </PopoverContent>
      </Popover>
    </div>);
}
export default function TaxForm({ onClose }: {
    onClose?: () => void;
}) {
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const taxEntry = useTaxProfileStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const taxProfile = taxEntry?.taxProfile ?? null;
    const taxLoading = activeWorkspaceId != null
        ? (taxEntry?.status ?? "idle") === "loading"
        : true;
    const setTaxProfileStore = useTaxProfileStore((s) => s.setTaxProfile);
    const { toast } = useToast();
    const [formData, setFormData] = useState<TaxProfile.InputType>(() => {
        return (taxProfile as TaxProfile.InputType) ?? EMPTY_FORM;
    });
    useEffect(() => {
        if (taxProfile) {
            setFormData(taxProfile as TaxProfile.InputType);
        }
        else {
            setFormData(EMPTY_FORM);
        }
    }, [taxProfile]);
    const updateField = <K extends keyof TaxProfile.Type>(field: K, value: TaxProfile.Type[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };
    const handlePrimaryStateChange = (value: string) => {
        setFormData((prev) => ({
            ...prev,
            state: value,
            residenceState: !prev.multiStateWorker || !prev.residenceState || prev.residenceState === prev.state
                ? value
                : prev.residenceState,
            workState: !prev.multiStateWorker || !prev.workState || prev.workState === prev.state
                ? value
                : prev.workState,
        }));
    };
    const handleMultiStateToggle = (checked: boolean) => {
        setFormData((prev) => ({
            ...prev,
            multiStateWorker: checked,
            residenceState: checked ? prev.residenceState : (prev.residenceState || prev.state),
            workState: checked ? prev.workState : (prev.workState || prev.state),
        }));
    };
    const handleSave = async () => {
        if (!activeWorkspaceId) {
            toast({
                title: "Save failed",
                description: "No active workspace selected.",
                variant: "destructive",
            });
            return;
        }
        const marylandResidentSelected = formData.state === "Maryland"
            || formData.residenceState === "Maryland"
            || (!formData.residenceState && formData.state === "Maryland");
        if (marylandResidentSelected && !(formData.residenceCounty ?? "").trim()) {
            toast({
                title: "Maryland county required",
                description: "Maryland paycheck withholding depends on your residence county, so add it before saving.",
                variant: "destructive",
            });
            return;
        }
        let parsed: TaxProfile.Type;
        try {
            parsed = TaxProfile.Schema.parse({
                ...formData,
                residenceState: formData.multiStateWorker
                    ? (formData.residenceState || undefined)
                    : (formData.state || undefined),
                workState: formData.multiStateWorker
                    ? (formData.workState || undefined)
                    : (formData.state || undefined),
                residenceCounty: formData.residenceCounty?.trim() || undefined,
                workCounty: formData.workCounty?.trim() || undefined,
                residenceCity: formData.residenceCity?.trim() || undefined,
                workCity: formData.workCity?.trim() || undefined,
                postalCode: formData.postalCode?.trim() || undefined,
                schoolDistrictId: formData.schoolDistrictId?.trim() || undefined,
                localTaxJurisdictionIds: (formData.localTaxJurisdictionIds ?? []).map((id) => id.trim()).filter(Boolean),
                ohioSchoolDistrictNumber: formData.ohioSchoolDistrictNumber?.trim() || undefined,
                newYorkLocality: formData.newYorkLocality,
                pennsylvaniaResidentPsdCode: formData.pennsylvaniaResidentPsdCode?.trim() || undefined,
                pennsylvaniaWorkPsdCode: formData.pennsylvaniaWorkPsdCode?.trim() || undefined,
            });
        }
        catch (err: any) {
            toast({
                title: "Save failed",
                description: err.message || "Could not save tax profile",
                variant: "destructive",
            });
            return;
        }
        const previousTaxProfile = taxProfile;
        setTaxProfileStore(activeWorkspaceId, parsed);
        onClose?.();
        toast({
            title: "Tax profile updated",
            description: "We saved your tax settings in the background.",
        });
        void (async () => {
            try {
                const saved = await taxProfileService.save(activeWorkspaceId, parsed);
                setTaxProfileStore(activeWorkspaceId, saved);
            }
            catch (err: any) {
                setTaxProfileStore(activeWorkspaceId, previousTaxProfile);
                toast({
                    title: "Background save failed",
                    description: err.message || "Could not save tax profile",
                    variant: "destructive",
                });
            }
        })();
    };
    if (taxLoading) {
        return (<div className="flex items-center justify-center py-10">
        <p className="text-muted-foreground">Loading tax profile...</p>
      </div>);
    }
    if (workspaceState.status !== "ready" || !activeWorkspaceId) {
        return null;
    }
    const effectiveResidenceState = formData.multiStateWorker
        ? (formData.residenceState ?? "")
        : formData.state;
    const effectiveWorkState = formData.multiStateWorker
        ? (formData.workState ?? "")
        : formData.state;
    const activeStates = new Set([formData.state, effectiveResidenceState, effectiveWorkState].filter(Boolean));
    const stateSelected = (stateCode: string) => activeStates.has(stateCode);
    const localTaxStateSelected = Array.from(activeStates).some((stateCode) => LOCAL_TAX_STATES.has(stateCode));
    const locationDetailsRelevant = formData.multiStateWorker
        || Array.from(activeStates).some((stateCode) => LOCATION_DETAIL_STATES.has(stateCode));
    const arkansasSelected = stateSelected("Arkansas");
    const alabamaSelected = stateSelected("Alabama");
    const marylandSelected = stateSelected("Maryland");
    const arizonaSelected = stateSelected("Arizona");
    const californiaSelected = stateSelected("California");
    const connecticutSelected = stateSelected("Connecticut");
    const delawareSelected = stateSelected("Delaware");
    const illinoisSelected = stateSelected("Illinois");
    const indianaSelected = stateSelected("Indiana");
    const indianaResidentSelected = effectiveResidenceState === "Indiana";
    const massachusettsSelected = stateSelected("Massachusetts");
    const coloradoSelected = stateSelected("Colorado");
    const georgiaSelected = stateSelected("Georgia");
    const hawaiiSelected = stateSelected("Hawaii");
    const idahoSelected = stateSelected("Idaho");
    const kentuckySelected = stateSelected("Kentucky");
    const maineSelected = stateSelected("Maine");
    const marylandResidentSelected = effectiveResidenceState === "Maryland";
    const michiganSelected = stateSelected("Michigan");
    const minnesotaSelected = stateSelected("Minnesota");
    const montanaSelected = stateSelected("Montana");
    const nebraskaSelected = stateSelected("Nebraska");
    const iowaSelected = stateSelected("Iowa");
    const kansasSelected = stateSelected("Kansas");
    const louisianaSelected = stateSelected("Louisiana");
    const mississippiSelected = stateSelected("Mississippi");
    const missouriSelected = stateSelected("Missouri");
    const newMexicoSelected = stateSelected("NewMexico");
    const newJerseySelected = stateSelected("NewJersey");
    const missingMarylandResidentCounty = marylandResidentSelected && !(formData.residenceCounty ?? "").trim();
    const northCarolinaSelected = stateSelected("NorthCarolina");
    const northDakotaSelected = stateSelected("NorthDakota");
    const ohioSelected = stateSelected("Ohio");
    const newYorkSelected = stateSelected("NewYork");
    const oregonSelected = stateSelected("Oregon");
    const pennsylvaniaSelected = stateSelected("Pennsylvania");
    const oklahomaSelected = stateSelected("Oklahoma");
    const rhodeIslandSelected = stateSelected("RhodeIsland");
    const southCarolinaSelected = stateSelected("SouthCarolina");
    const washingtonDCSelected = stateSelected("WashingtonDC");
    const vermontSelected = stateSelected("Vermont");
    const utahSelected = stateSelected("Utah");
    const virginiaSelected = stateSelected("Virginia");
    const westVirginiaSelected = stateSelected("WestVirginia");
    const wisconsinSelected = stateSelected("Wisconsin");
    return (<div className="p-0">
      <CardContent className="p-0">
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <h3 className="font-semibold text-base">Your paycheck tax setup</h3>
            <p className="text-sm text-muted-foreground">
              Start with the basics. We only show extra questions when they matter for your paycheck estimate.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <LabelWithInfo htmlFor="filingStatus" label="Filing status" info={<>
                    <p>The filing status you use on your tax forms changes how much tax is usually withheld.</p>
                    <p>Example: `Single` for one job and one filer, or `Married filing jointly` if you file together.</p>
                  </>}/>
              <Select value={formData.filingStatus} onValueChange={(value) => updateField("filingStatus", value as TaxProfile.Type["filingStatus"])}>
                <SelectTrigger id="filingStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="marriedJoint">Married filing jointly</SelectItem>
                  <SelectItem value="marriedSeparate">Married filing separately</SelectItem>
                  <SelectItem value="headOfHousehold">Head of household</SelectItem>
                </SelectContent>
              </Select>
              <FieldHint>Use the filing status you chose on your tax forms. This helps estimate federal and some state withholding.</FieldHint>
            </div>

            <div className="space-y-2">
              <LabelWithInfo htmlFor="dependents" label="Dependents" info={<>
                    <p>Enter how many dependents you want reflected in this estimate.</p>
                    <p>Example: `0` if none, `1` or `2` if you claimed dependents on your forms.</p>
                  </>}/>
              <Input id="dependents" type="number" min="0" inputMode="numeric" placeholder="0" value={formData.dependents === 0 ? "" : formData.dependents} onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
                updateField("dependents", 0);
                return;
            }
            updateField("dependents", Number(raw));
        }} className="text-right"/>
              <FieldHint>Enter the number of dependents you want reflected in your estimate. This is also used as a backup if you leave the credit field below blank.</FieldHint>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div>
              <LabelWithInfo htmlFor="federalExempt" label="I claimed exempt from federal withholding" className="cursor-pointer" info={<>
                    <p>Turn this on only if you marked yourself exempt on your W-4, so no federal income tax should come out.</p>
                    <p>Example: leave this off for most users.</p>
                  </>}/>
              <FieldHint>Turn this on only if you marked yourself as exempt on your W-4, so no federal income tax should come out of your paycheck.</FieldHint>
            </div>
            <Switch
              id="federalExempt"
              checked={formData.federalExempt ?? false}
              onCheckedChange={(checked) => updateField("federalExempt", checked)}
            />
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm">Extra federal W-4 details</h4>
              <p className="text-xs text-muted-foreground">
                Only fill these in if you entered them on your federal W-4. Most people can leave them blank.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
              <div>
                <LabelWithInfo htmlFor="federalMultipleJobsCheckbox" label="I checked the multiple jobs box on my W-4" className="cursor-pointer" info={<>
                    <p>Turn this on only if you checked the box on your W-4 because you have another job or your spouse also works.</p>
                    <p>Example: turn this on if both you and your spouse work and you checked that box.</p>
                  </>}/>
                <FieldHint>Turn this on only if you checked the box in Step 2(c) because you have more than one job or your spouse also works.</FieldHint>
              </div>
              <Switch
                id="federalMultipleJobsCheckbox"
                checked={formData.federalMultipleJobsCheckbox ?? false}
                onCheckedChange={(checked) => updateField("federalMultipleJobsCheckbox", checked)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithInfo htmlFor="federalStep3Credits" label="Tax credits from your W-4 (yearly total)" info={<>
                      <p>This is the yearly total credit amount you entered on your W-4.</p>
                      <p>Example: if you wrote `$2,000` on Step 3, enter `2000` here.</p>
                    </>}/>
                <Input
                  id="federalStep3Credits"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if you did not enter a credit amount"
                  value={getNumericInputValue(formData.federalStep3Credits)}
                  onChange={(e) => updateField("federalStep3Credits", parseOptionalNumber(e.target.value))}
                  className="text-right"
                />
                <FieldHint>Enter the yearly total from Step 3 of your W-4 if you filled it in. If you did not, leave this blank.</FieldHint>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="federalOtherIncome" label="Other income from your W-4 (yearly)" info={<>
                      <p>Only enter this if you listed other income on your W-4.</p>
                      <p>Example: if you wrote `$5,000` in other income, enter `5000` here.</p>
                    </>}/>
                <Input
                  id="federalOtherIncome"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if unused"
                  value={getNumericInputValue(formData.federalOtherIncome)}
                  onChange={(e) => updateField("federalOtherIncome", parseOptionalNumber(e.target.value))}
                  className="text-right"
                />
                <FieldHint>Only enter this if you listed other income in Step 4(a) of your W-4.</FieldHint>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="federalDeductions" label="Extra deductions from your W-4 (yearly)" info={<>
                      <p>Only enter this if you listed extra deductions on your W-4.</p>
                      <p>Example: if you wrote `$3,000` in deductions, enter `3000` here.</p>
                    </>}/>
                <Input
                  id="federalDeductions"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if unused"
                  value={getNumericInputValue(formData.federalDeductions)}
                  onChange={(e) => updateField("federalDeductions", parseOptionalNumber(e.target.value))}
                  className="text-right"
                />
                <FieldHint>Only enter this if you listed deductions in Step 4(b) of your W-4.</FieldHint>
              </div>
            </div>
          </div>

          <StateDropdown id="primaryState" value={formData.state} onChange={handlePrimaryStateChange} label="Primary withholding state" required className="mt-2"/>
          <FieldHint>This is the main state used for your paycheck estimate.</FieldHint>
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div>
              <LabelWithInfo htmlFor="multiStateWorker" label="I live or work in another state" className="cursor-pointer" info={<>
                    <p>Turn this on if your home state and work state are different.</p>
                    <p>Example: you live in New Jersey but work in New York.</p>
                  </>}/>
              <FieldHint>Turn this on only if your home state and work state are different.</FieldHint>
            </div>
            <Switch id="multiStateWorker" checked={formData.multiStateWorker ?? false} onCheckedChange={handleMultiStateToggle}/>
          </div>

          {arkansasSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Arkansas AR4EC withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Arkansas payroll withholding uses the 2026 DFA wage formula, a fixed standard deduction, and a per-exemption annual credit. If the employee elected the Arkansas low-income tables, turn that on below.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="arkansasExemptions" label="Arkansas withholding exemptions" info={<>
                        <p>Enter the exemption count from your Arkansas AR4EC if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` exemptions.</p>
                      </>}/>
                  <Input id="arkansasExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.arkansasExemptions)} onChange={(e) => updateField("arkansasExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total Arkansas exemptions from Form AR4EC. If left blank, the calculator uses zero exemptions, which matches the no-form default.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="arkansasLowIncomeRates" label="Use Arkansas low-income rates" className="cursor-pointer" info={<>
                          <p>Turn this on only if you chose Arkansas low-income withholding on your state form.</p>
                          <p>Example: leave this off unless that option is on your paperwork.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee elected the low-income withholding tables on their Arkansas certificate.</FieldHint>
                  </div>
                  <Switch id="arkansasLowIncomeRates" checked={formData.arkansasLowIncomeRates ?? false} onCheckedChange={(checked) => updateField("arkansasLowIncomeRates", checked)}/>
                </div>
              </div>
            </div>)}

          {alabamaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Alabama tax details</h4>
                <p className="text-xs text-muted-foreground">
                  If you filled out an Alabama A-4, enter that code here so your Alabama estimate is more accurate.
                </p>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="alabamaExemptionCode" label="Alabama A-4 exemption code" info={<>
                      <p>Choose the Alabama code from your A-4 if you know it.</p>
                      <p>Example: codes like `S`, `M`, or `H` may appear on your form.</p>
                    </>}/>
                <Select value={formData.alabamaExemptionCode ?? ""} onValueChange={(value) => updateField("alabamaExemptionCode", value ? value as TaxProfile.Type["alabamaExemptionCode"] : undefined)}>
                  <SelectTrigger id="alabamaExemptionCode">
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
                <FieldHint>Use the exact Form A-4 code on file. Leave blank only if you want the estimate to map from the filing status above.</FieldHint>
              </div>
            </div>)}

          {arizonaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Arizona A-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Arizona withholding is a straight percentage election on gross taxable wages. If no A-4 is on file, employers generally default to 2.0%.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="arizonaWithholdingPercent" label="Arizona withholding percentage (%)" info={<>
                        <p>Choose the percent from your Arizona A-4 if you filled one out.</p>
                        <p>Example: many users pick `2.0%`.</p>
                      </>}/>
                  <Select value={formData.arizonaWithholdingPercent != null ? String(formData.arizonaWithholdingPercent) : ""} onValueChange={(value) => updateField("arizonaWithholdingPercent", value ? Number(value) : undefined)}>
                    <SelectTrigger id="arizonaWithholdingPercent">
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
                  <FieldHint>Choose the percentage elected on Arizona Form A-4. Leave blank to use the employer default rate of 2.0%.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="arizonaExempt" label="Arizona exempt election" className="cursor-pointer" info={<>
                          <p>Turn this on only if you claimed exempt from Arizona withholding.</p>
                          <p>Example: leave this off for most users.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee elected zero withholding on Arizona Form A-4.</FieldHint>
                  </div>
                  <Switch id="arizonaExempt" checked={formData.arizonaExempt ?? false} onCheckedChange={(checked) => updateField("arizonaExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {californiaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">California DE 4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  California payroll withholding uses DE 4 allowance counts. Regular allowances reduce the exemption credit, and estimated-deduction allowances reduce wages before tax is computed.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="californiaRegularAllowances" label="DE 4 regular withholding allowances" info={<>
                        <p>Enter the allowance count from your California DE 4 if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` allowances.</p>
                      </>}/>
                  <Input id="californiaRegularAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.californiaRegularAllowances)} onChange={(e) => updateField("californiaRegularAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1a from California DE 4. If blank, the calculator defaults to zero regular allowances.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="californiaEstimatedDeductionAllowances" label="DE 4 estimated-deduction allowances" info={<>
                        <p>Only enter this if you added estimated-deduction allowances on your California form.</p>
                        <p>Example: `0`, `1`, or another allowance count.</p>
                      </>}/>
                  <Input id="californiaEstimatedDeductionAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.californiaEstimatedDeductionAllowances)} onChange={(e) => updateField("californiaEstimatedDeductionAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1b from California DE 4 if the employee claimed estimated-deduction allowances.</FieldHint>
                </div>
              </div>
            </div>)}

          {connecticutSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Connecticut CT-W4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Connecticut payroll withholding uses CT-W4 withholding codes plus any additional or reduced per-paycheck amount. If no CT-W4 is on file, employers must withhold at 6.99% with no exemption allowance.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="connecticutWithholdingCode" label="CT-W4 withholding code" info={<>
                        <p>Choose the letter from your Connecticut CT-W4 if you know it.</p>
                        <p>Example: many users will have a code like `A`, `B`, or `C`.</p>
                      </>}/>
                  <Select value={formData.connecticutWithholdingCode ?? ""} onValueChange={(value) => updateField("connecticutWithholdingCode", value ? value as TaxProfile.Type["connecticutWithholdingCode"] : undefined)}>
                    <SelectTrigger id="connecticutWithholdingCode">
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
                  <FieldHint>A, B, C, and F follow the regular CT withholding tables. D uses the highest regular withholding path. E means no withholding is necessary.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="connecticutFifteenDayExempt" label="Connecticut 15-day nonresident exemption" className="cursor-pointer" info={<>
                          <p>Turn this on only if you qualify for Connecticut's short-term nonresident exemption.</p>
                          <p>Example: a nonresident working there 15 days or fewer in the year.</p>
                        </>}/>
                    <FieldHint>Turn this on only for a nonresident expected to work in Connecticut for 15 days or fewer during the calendar year.</FieldHint>
                  </div>
                  <Switch id="connecticutFifteenDayExempt" checked={formData.connecticutFifteenDayExempt ?? false} onCheckedChange={(checked) => updateField("connecticutFifteenDayExempt", checked)}/>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="connecticutAdditionalWithholding" label="CT-W4 additional withholding per paycheck" info={<>
                        <p>Enter any extra Connecticut amount you asked payroll to withhold each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="connecticutAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.connecticutAdditionalWithholding)} onChange={(e) => updateField("connecticutAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 2 from Form CT-W4 if the employee asked payroll to withhold an additional dollar amount each pay period.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="connecticutReducedWithholding" label="CT-W4 reduced withholding per paycheck" info={<>
                        <p>Enter this only if you were approved to have less Connecticut tax withheld.</p>
                        <p>Example: many users will leave this blank.</p>
                      </>}/>
                  <Input id="connecticutReducedWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.connecticutReducedWithholding)} onChange={(e) => updateField("connecticutReducedWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 3 from Form CT-W4 if the employee received DRS approval or worksheet support for reduced payroll withholding.</FieldHint>
                </div>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="connecticutNonresidentApportionmentPercent" label="CT-W4NA Connecticut work percentage (%)" info={<>
                      <p>Use this only if you work partly in Connecticut and partly elsewhere for the same employer.</p>
                      <p>Example: enter `60` for 60% of work performed in Connecticut.</p>
                    </>}/>
                <Input id="connecticutNonresidentApportionmentPercent" type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="Leave blank unless using CT-W4NA" value={getNumericInputValue(formData.connecticutNonresidentApportionmentPercent)} onChange={(e) => updateField("connecticutNonresidentApportionmentPercent", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>For a nonresident working partly inside and partly outside Connecticut for the same employer, enter the CT-W4NA percentage of services performed in Connecticut.</FieldHint>
              </div>
            </div>)}

          {marylandSelected && (<div className="space-y-2 rounded-lg border p-4">
              <Label htmlFor="marylandWithholdingExemptions">Maryland MW507 withholding exemptions</Label>
              <Input id="marylandWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="Leave blank to fall back to dependents" value={getNumericInputValue(formData.marylandWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("marylandWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
              <FieldHint>Maryland payroll withholding uses the exemption count from Form MW507. If you leave this blank, the calculator falls back to your dependents count.</FieldHint>
            </div>)}

          {illinoisSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Illinois IL-W-4 allowances</h4>
                <p className="text-xs text-muted-foreground">
                  Illinois withholding uses IL-W-4 Line 1 and Line 2 allowances, not just your filing status.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="illinoisAllowanceLine1">IL-W-4 Line 1 allowances</Label>
                  <Input id="illinoisAllowanceLine1" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.illinoisAllowanceLine1)} onChange={(e) => updateField("illinoisAllowanceLine1", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Basic personal allowances from Line 1 of Form IL-W-4.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="illinoisAllowanceLine2">IL-W-4 Line 2 allowances</Label>
                  <Input id="illinoisAllowanceLine2" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.illinoisAllowanceLine2)} onChange={(e) => updateField("illinoisAllowanceLine2", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Additional allowances from Line 2 of Form IL-W-4.</FieldHint>
                </div>
              </div>
              <FieldHint>
                Illinois residents of Iowa, Kentucky, Michigan, and Wisconsin may be exempt from Illinois withholding when reciprocity applies.
              </FieldHint>
            </div>)}

          {indianaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Indiana WH-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Indiana payroll withholding uses WH-4 deduction constants from lines 5 through 8, then applies the 2026 2.95% state rate to the remaining taxable wages. Indiana county withholding uses the same taxable wage base.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="indianaPersonalExemptions">WH-4 line 5 personal exemptions</Label>
                  <Input id="indianaPersonalExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaPersonalExemptions)} onChange={(e) => updateField("indianaPersonalExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total from line 5 of Indiana Form WH-4.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="indianaDependentExemptions">WH-4 line 6 dependent exemptions</Label>
                  <Input id="indianaDependentExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaDependentExemptions)} onChange={(e) => updateField("indianaDependentExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the number of qualifying dependent exemptions from line 6.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="indianaFirstTimeDependentExemptions">WH-4 line 7 first-time dependent exemptions</Label>
                  <Input id="indianaFirstTimeDependentExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaFirstTimeDependentExemptions)} onChange={(e) => updateField("indianaFirstTimeDependentExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 7 only for qualifying dependents claimed for the first time.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="indianaAdoptedChildExemptions">WH-4 line 8 adopted child exemptions</Label>
                  <Input id="indianaAdoptedChildExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.indianaAdoptedChildExemptions)} onChange={(e) => updateField("indianaAdoptedChildExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 8 for qualifying adopted dependents.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="indianaAdditionalStateWithholding">WH-4 line 9 extra state withholding</Label>
                  <Input id="indianaAdditionalStateWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.indianaAdditionalStateWithholding)} onChange={(e) => updateField("indianaAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter any extra Indiana state amount the employee requested each pay period.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="indianaAdditionalCountyWithholding">WH-4 line 10 extra county withholding</Label>
                  <Input id="indianaAdditionalCountyWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.indianaAdditionalCountyWithholding)} onChange={(e) => updateField("indianaAdditionalCountyWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter any extra Indiana county amount the employee requested each pay period.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="indianaNonresidentThirtyDayExempt" className="cursor-pointer">30-day nonresident waiver</Label>
                    <FieldHint>Turn this on only if a nonresident employee gave the employer Form WH-4AFF for Indiana work of 30 days or less during the calendar year.</FieldHint>
                  </div>
                  <Switch id="indianaNonresidentThirtyDayExempt" checked={formData.indianaNonresidentThirtyDayExempt ?? false} onCheckedChange={(checked) => updateField("indianaNonresidentThirtyDayExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="indianaNonresidentMilitarySpouseExempt" className="cursor-pointer">Nonresident military spouse exempt</Label>
                    <FieldHint>Turn this on only if the employee filed Indiana Form WH-4MIL.</FieldHint>
                  </div>
                  <Switch id="indianaNonresidentMilitarySpouseExempt" checked={formData.indianaNonresidentMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("indianaNonresidentMilitarySpouseExempt", checked)}/>
                </div>
              </div>
              <FieldHint>Indiana reciprocity with Kentucky, Michigan, Ohio, Pennsylvania, and Wisconsin can be applied with the reciprocity toggle below. That reciprocity affects state withholding, but Indiana county withholding can still apply.</FieldHint>
            </div>)}

          {massachusettsSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Massachusetts M-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Massachusetts wage withholding uses M-4 exemption counts, any extra withholding requested by the employee, and the 2026 4% surtax threshold for very high annualized wages.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="massachusettsExemptions">Massachusetts M-4 total exemptions</Label>
                  <Input id="massachusettsExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.massachusettsExemptions)} onChange={(e) => updateField("massachusettsExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total withholding exemptions from line 4 of Form M-4. If blank, the calculator uses zero Massachusetts withholding exemptions.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="massachusettsBlindExemptions">Massachusetts blindness exemptions</Label>
                  <Select value={formData.massachusettsBlindExemptions != null ? String(formData.massachusettsBlindExemptions) : "0"} onValueChange={(value) => updateField("massachusettsBlindExemptions", Number(value))}>
                    <SelectTrigger id="massachusettsBlindExemptions">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0</SelectItem>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>Use the total number of blindness exemptions claimed on Form M-4 for the employee and spouse, if applicable.</FieldHint>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="massachusettsAdditionalWithholding">Massachusetts additional withholding per paycheck</Label>
                <Input id="massachusettsAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.massachusettsAdditionalWithholding)} onChange={(e) => updateField("massachusettsAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Use line 5 from Form M-4 if the employee asked payroll to withhold an extra Massachusetts amount each pay period.</FieldHint>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="massachusettsFullTimeStudentExempt" className="cursor-pointer">Full-time student low-income exemption</Label>
                    <FieldHint>Turn this on only if the employee qualifies under M-4 line D and expects annual income of $8,000 or less.</FieldHint>
                  </div>
                  <Switch id="massachusettsFullTimeStudentExempt" checked={formData.massachusettsFullTimeStudentExempt ?? false} onCheckedChange={(checked) => updateField("massachusettsFullTimeStudentExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="massachusettsMsrraExempt" className="cursor-pointer">MSRRA exempt</Label>
                    <FieldHint>Turn this on only if the employee filed Massachusetts Form M-4-MS as a qualifying nonresident military spouse.</FieldHint>
                  </div>
                  <Switch id="massachusettsMsrraExempt" checked={formData.massachusettsMsrraExempt ?? false} onCheckedChange={(checked) => updateField("massachusettsMsrraExempt", checked)}/>
                </div>
              </div>
              <FieldHint>Head of household is taken from the filing status above. Massachusetts reduces withholding slightly for that status.</FieldHint>
            </div>)}

          {coloradoSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Colorado DR 0004 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Colorado withholding uses the DR 1098 worksheet. If you have a DR 0004, enter the annual deduction amount from Line 2.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="coloradoDeductionAmount">Colorado DR 0004 annual deduction amount</Label>
                <Input id="coloradoDeductionAmount" type="number" min="0" inputMode="decimal" placeholder="Leave blank to use the default worksheet amount" value={getNumericInputValue(formData.coloradoDeductionAmount)} onChange={(e) => updateField("coloradoDeductionAmount", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Leave blank to use Colorado&apos;s default annual deduction: $5,500 for single, head of household, or married filing separately, and $11,000 for married filing jointly.</FieldHint>
              </div>
            </div>)}

          {delawareSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Delaware W-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Delaware withholding uses an annualized wage formula with the Delaware standard deduction and a $110 personal credit for each Delaware withholding allowance.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="delawareStateWithholdingExemptions">Delaware withholding allowances</Label>
                <Input id="delawareStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.delawareWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("delawareWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the Delaware withholding allowance count from the employee&apos;s Delaware W-4. Delaware does not have wage-tax reciprocity with any state.</FieldHint>
              </div>
            </div>)}

          {georgiaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Georgia G-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Georgia payroll withholding uses your G-4 marital status and total allowance count.
                </p>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="georgiaAllowanceCount" label="Georgia G-4 total allowances" info={<>
                      <p>Enter the allowance count from your Georgia G-4 if you know it.</p>
                      <p>Example: `0`, `1`, or `2` allowances.</p>
                    </>}/>
                <Input id="georgiaAllowanceCount" type="number" min="0" inputMode="numeric" placeholder="Leave blank to fall back to dependents" value={getNumericInputValue(formData.georgiaAllowanceCount)} onChange={(e) => updateField("georgiaAllowanceCount", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the total allowances from Line 7 of your Georgia G-4. If you leave this blank, the calculator falls back to your dependents count.</FieldHint>
              </div>
              {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="georgiaMarriedBothWorking" label="Both spouses work" className="cursor-pointer" info={<>
                          <p>Turn this on only if both spouses have income and that matches your Georgia form situation.</p>
                          <p>Example: leave this off if only one spouse works.</p>
                        </>}/>
                    <FieldHint>Georgia uses a smaller standard deduction when both spouses have income.</FieldHint>
                  </div>
                  <Switch id="georgiaMarriedBothWorking" checked={formData.georgiaMarriedBothWorking ?? false} onCheckedChange={(checked) => updateField("georgiaMarriedBothWorking", checked)}/>
                </div>)}
            </div>)}

          {hawaiiSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Hawaii HW-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Hawaii withholding uses the 2026 Booklet A payroll tables with HW-4 allowance counts, Hawaii&apos;s extra lump-sum allowance amount, and the employee&apos;s married-versus-single rate election.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="hawaiiStateWithholdingExemptions" label="Hawaii HW-4 allowances" info={<>
                        <p>Enter the allowance count from your Hawaii HW-4 if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` allowances.</p>
                      </>}/>
                  <Input id="hawaiiStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.hawaiiWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("hawaiiWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 4 from Form HW-4. Hawaii does not allow a regular `EXEMPT` election, and if no HW-4 is filed payroll should generally use single with zero allowances.</FieldHint>
                </div>
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <LabelWithInfo htmlFor="hawaiiHigherSingleRate" label="Married but withhold at higher single rate" className="cursor-pointer" info={<>
                            <p>Turn this on only if you chose the higher single withholding rate on your Hawaii form.</p>
                            <p>Example: many married users leave this off unless they selected it.</p>
                          </>}/>
                      <FieldHint>Turn this on only if the employee checked the Hawaii HW-4 box to use the higher single rate.</FieldHint>
                    </div>
                    <Switch id="hawaiiHigherSingleRate" checked={formData.hawaiiHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("hawaiiHigherSingleRate", checked)}/>
                  </div>)}
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="hawaiiCertifiedDisabled" label="Certified disabled person" className="cursor-pointer" info={<>
                          <p>Turn this on only if this special Hawaii exemption applies to you.</p>
                          <p>Example: most users will leave this off.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee is a certified disabled person not subject to Hawaii withholding under Form HW-4.</FieldHint>
                  </div>
                  <Switch id="hawaiiCertifiedDisabled" checked={formData.hawaiiCertifiedDisabled ?? false} onCheckedChange={(checked) => updateField("hawaiiCertifiedDisabled", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="hawaiiNonresidentMilitarySpouse" label="Nonresident military spouse" className="cursor-pointer" info={<>
                          <p>Turn this on only if you qualify for the Hawaii military spouse withholding exemption.</p>
                          <p>Example: most users will leave this off.</p>
                        </>}/>
                    <FieldHint>Turn this on only for a qualifying nonresident military spouse whose Hawaii wages are not subject to withholding.</FieldHint>
                  </div>
                  <Switch id="hawaiiNonresidentMilitarySpouse" checked={formData.hawaiiNonresidentMilitarySpouse ?? false} onCheckedChange={(checked) => updateField("hawaiiNonresidentMilitarySpouse", checked)}/>
                </div>
              </div>
            </div>)}

          {idahoSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Idaho tax details</h4>
                <p className="text-xs text-muted-foreground">
                  If you filled out an Idaho ID W-4, add those details here so your Idaho estimate is closer to your real paycheck.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="idahoAllowances" label="Idaho child tax credit allowances" info={<>
                        <p>Enter the allowance count from your Idaho form if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2`.</p>
                      </>}/>
                  <Input id="idahoAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.idahoAllowances)} onChange={(e) => updateField("idahoAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1 from Form ID W-4. Idaho allowances are based mainly on qualifying children, with an extra 2 allowances for head of household.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="idahoAdditionalWithholding" label="Additional Idaho withholding per paycheck" info={<>
                        <p>Enter any extra Idaho amount you asked payroll to withhold from each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="idahoAdditionalWithholding" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.idahoAdditionalWithholding)} onChange={(e) => updateField("idahoAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 2 from Form ID W-4 if the employee requested an extra Idaho dollar amount each pay period.</FieldHint>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                <div>
                  <LabelWithInfo htmlFor="idahoExempt" label="Idaho exempt election" className="cursor-pointer" info={<>
                        <p>Turn this on only if you marked yourself exempt from Idaho withholding.</p>
                        <p>Example: leave this off for most users.</p>
                      </>}/>
                  <FieldHint>Turn this on only if the employee wrote `Exempt` on Form ID W-4 for the current year.</FieldHint>
                </div>
                <Switch id="idahoExempt" checked={formData.idahoExempt ?? false} onCheckedChange={(checked) => updateField("idahoExempt", checked)}/>
              </div>
            </div>)}

          {kentuckySelected && (<div className="space-y-2 rounded-lg border p-4">
              <LabelWithInfo htmlFor="kentuckyHint" label="Kentucky withholding rules" info={<>
                    <p>Kentucky uses a flat state withholding approach, so there are usually fewer choices here.</p>
                    <p>Example: if reciprocity applies, use the reciprocity toggle below.</p>
                  </>}/>
              <FieldHint>
                Kentucky payroll withholding uses the annual Kentucky standard deduction and flat withholding rate. If you qualify for a reciprocal-state exemption, turn on the reciprocity toggle below.
              </FieldHint>
            </div>)}

          {maineSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Maine W-4ME withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Maine withholding uses W-4ME allowance counts, a Maine-specific standard deduction phaseout, and either the married or single rate schedule.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="maineStateWithholdingExemptions" label="Maine withholding allowances" info={<>
                        <p>Enter the allowance count from your Maine W-4ME if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` allowances.</p>
                      </>}/>
                  <Input id="maineStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.maineWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("maineWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the number of Maine withholding allowances from Form W-4ME. If blank, the calculator uses zero allowances.</FieldHint>
                </div>
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <LabelWithInfo htmlFor="maineHigherSingleRate" label="Married but withhold at single rate" className="cursor-pointer" info={<>
                            <p>Turn this on only if you chose the higher single rate on your Maine form.</p>
                            <p>Example: many married users leave this off unless they selected it.</p>
                          </>}/>
                      <FieldHint>Turn this on only if the employee checked the Maine W-4ME option to withhold at the higher single rate.</FieldHint>
                    </div>
                    <Switch id="maineHigherSingleRate" checked={formData.maineHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("maineHigherSingleRate", checked)}/>
                  </div>)}
              </div>
              <FieldHint>Maine nonresident withholding can depend on annual Maine workdays and Maine wages, which are not separately tracked yet.</FieldHint>
            </div>)}

          {michiganSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Michigan MI-W4 exemptions</h4>
                <p className="text-xs text-muted-foreground">
                  Michigan withholding is based on the MI-W4 exemption count, not just your filing status.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="michiganExemptions">MI-W4 personal and dependent exemptions</Label>
                <Input id="michiganExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.michiganExemptions)} onChange={(e) => updateField("michiganExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the exemption count claimed on your Michigan MI-W4.</FieldHint>
              </div>
            </div>)}

          {iowaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Iowa IA W-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Iowa payroll withholding uses the 2026 IA W-4 deduction schedule, the total allowance amount from line 7, and any additional amount from line 8.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="iowaAllowanceAmount" label="Iowa IA W-4 total allowance amount" info={<>
                        <p>Enter the dollar amount from your Iowa form, not the number of allowances.</p>
                        <p>Example: if your form says `$2180`, enter `2180`.</p>
                      </>}/>
                  <Input id="iowaAllowanceAmount" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.iowaAllowanceAmount)} onChange={(e) => updateField("iowaAllowanceAmount", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total dollar amount from line 7 of Form IA W-4, not the number of allowances.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="iowaAdditionalWithholding" label="Additional Iowa withholding per paycheck" info={<>
                        <p>Enter any extra Iowa amount you asked payroll to withhold from each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="iowaAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.iowaAdditionalWithholding)} onChange={(e) => updateField("iowaAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 8 from Form IA W-4 if the employee asked payroll to withhold an extra Iowa amount each pay period.</FieldHint>
                </div>
              </div>
              {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="iowaSpouseHasIncome" className="cursor-pointer">Spouse also has earned income</Label>
                    <FieldHint>Iowa uses a smaller deduction amount when a married-joint employee&apos;s spouse also has earned income.</FieldHint>
                  </div>
                  <Switch id="iowaSpouseHasIncome" checked={formData.iowaSpouseHasIncome ?? false} onCheckedChange={(checked) => updateField("iowaSpouseHasIncome", checked)}/>
                </div>)}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="iowaExempt" label="Iowa exempt election" className="cursor-pointer" info={<>
                          <p>Turn this on only if you marked yourself exempt from Iowa withholding.</p>
                          <p>Example: leave this off for most users.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee wrote `EXEMPT` on the IA W-4. Nonresidents generally may not claim this election.</FieldHint>
                  </div>
                  <Switch id="iowaExempt" checked={formData.iowaExempt ?? false} onCheckedChange={(checked) => updateField("iowaExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="iowaMilitarySpouseExempt" className="cursor-pointer">Iowa military spouse exemption</Label>
                    <FieldHint>Turn this on only if the employee claimed the military spouse Iowa withholding exemption on Form IA W-4.</FieldHint>
                  </div>
                  <Switch id="iowaMilitarySpouseExempt" checked={formData.iowaMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("iowaMilitarySpouseExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {kansasSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Kansas K-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Kansas payroll withholding uses the K-4 allowance rate together with Kansas personal exemption amounts, any dependent allowances, and any extra amount requested per paycheck.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="kansasAllowanceRate">Kansas K-4 allowance rate</Label>
                  <Select value={formData.kansasAllowanceRate ?? ""} onValueChange={(value) => updateField("kansasAllowanceRate", value ? value as TaxProfile.Type["kansasAllowanceRate"] : undefined)}>
                    <SelectTrigger id="kansasAllowanceRate">
                      <SelectValue placeholder="Leave blank to estimate from filing status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single rate</SelectItem>
                      <SelectItem value="joint">Joint rate</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>Use the allowance rate selected on line A of Form K-4. Married employees often still use the Single rate when both spouses have income.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kansasAdditionalWithholding">Additional Kansas withholding per paycheck</Label>
                  <Input id="kansasAdditionalWithholding" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.kansasAdditionalWithholding)} onChange={(e) => updateField("kansasAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 5 of Form K-4 if the employee requested an extra Kansas dollar amount to be withheld each pay period.</FieldHint>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="kansasExempt" className="cursor-pointer">Kansas exempt election</Label>
                  <FieldHint>Turn this on only if the employee qualified for and claimed exemption from Kansas withholding on Form K-4.</FieldHint>
                </div>
                <Switch id="kansasExempt" checked={formData.kansasExempt ?? false} onCheckedChange={(checked) => updateField("kansasExempt", checked)}/>
              </div>
            </div>)}

          {louisianaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Louisiana L-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Louisiana withholding uses the employee&apos;s deduction claim and the Louisiana withholding rate published in the current state withholding tables.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="louisianaDeductionClaim">Louisiana deduction claim</Label>
                <Select value={formData.louisianaDeductionClaim ?? ""} onValueChange={(value) => updateField("louisianaDeductionClaim", value ? value as TaxProfile.Type["louisianaDeductionClaim"] : undefined)}>
                  <SelectTrigger id="louisianaDeductionClaim">
                    <SelectValue placeholder="Leave blank to estimate from filing status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0 - no standard deduction claim</SelectItem>
                    <SelectItem value="1">1 - single or married filing separately</SelectItem>
                    <SelectItem value="2">2 - married filing jointly or head of household</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>Use the exact Louisiana deduction claim on the employee&apos;s L-4. Leave blank only if you want the calculator to infer it from the filing status above.</FieldHint>
              </div>
            </div>)}

          {mississippiSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Mississippi 89-350 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Mississippi withholding depends heavily on the total exemption amount claimed on Form 89-350, especially for married employees who split exemptions across two jobs.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mississippiExemptionAmount">Mississippi total exemption amount</Label>
                  <Input id="mississippiExemptionAmount" type="number" min="0" step="1" inputMode="numeric" placeholder="Leave blank to estimate from filing status" value={getNumericInputValue(formData.mississippiExemptionAmount)} onChange={(e) => updateField("mississippiExemptionAmount", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the exact dollar exemption amount from line 6 of Form 89-350 when available.</FieldHint>
                </div>
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <Label htmlFor="mississippiSpouseEmployed" className="cursor-pointer">Spouse also employed</Label>
                      <FieldHint>Turn this on when the employee is married and both spouses work, so the calculator can warn about Mississippi exemption splitting.</FieldHint>
                    </div>
                    <Switch id="mississippiSpouseEmployed" checked={formData.mississippiSpouseEmployed ?? false} onCheckedChange={(checked) => updateField("mississippiSpouseEmployed", checked)}/>
                  </div>)}
              </div>
            </div>)}

          {missouriSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Missouri MO W-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Missouri withholding uses the current Missouri formula and a larger standard deduction only when the married employee checked the spouse-does-not-work box on Form MO W-4.
                </p>
              </div>
              {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="missouriSpouseDoesNotWork" className="cursor-pointer">Spouse does not work</Label>
                    <FieldHint>Turn this on only if the employee checked the Missouri spouse-does-not-work box on Form MO W-4.</FieldHint>
                  </div>
                  <Switch id="missouriSpouseDoesNotWork" checked={formData.missouriSpouseDoesNotWork ?? false} onCheckedChange={(checked) => updateField("missouriSpouseDoesNotWork", checked)}/>
                </div>)}
            </div>)}

          {minnesotaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Minnesota W-4MN withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Minnesota payroll withholding uses the 2026 W-4MN allowance method and annualized withholding schedules for single and married employees.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="minnesotaStateWithholdingExemptions">Minnesota withholding allowances</Label>
                <Input id="minnesotaStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.minnesotaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("minnesotaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the W-4MN allowance count. If blank, the calculator uses zero allowances, which also matches the no-form default.</FieldHint>
              </div>
              <FieldHint>Michigan and North Dakota reciprocity can be applied with the reciprocity toggle below when the employee gave the employer Form MWR.</FieldHint>
            </div>)}

          {montanaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Montana MW-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Montana withholding uses the 2026 payroll tables that follow the employee&apos;s MW-4 filing category and federal-standard-deduction-style thresholds.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <Label htmlFor="montanaBothSpousesWorking" className="cursor-pointer">Both spouses work</Label>
                      <FieldHint>Turn this on only if the employee checked line 2 on Form MW-4 to use the two-earner married schedule.</FieldHint>
                    </div>
                    <Switch id="montanaBothSpousesWorking" checked={formData.montanaBothSpousesWorking ?? false} onCheckedChange={(checked) => updateField("montanaBothSpousesWorking", checked)}/>
                  </div>)}
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="montanaExempt" className="cursor-pointer">Montana exempt election</Label>
                    <FieldHint>Turn this on only if the employee claimed a valid Montana withholding exemption on Form MW-4.</FieldHint>
                  </div>
                  <Switch id="montanaExempt" checked={formData.montanaExempt ?? false} onCheckedChange={(checked) => updateField("montanaExempt", checked)}/>
                </div>
              </div>
              <FieldHint>North Dakota reciprocity can be applied with the reciprocity toggle below when the employee gave the employer a valid reciprocity certificate.</FieldHint>
            </div>)}

          {nebraskaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Nebraska W-4N withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Nebraska payroll withholding uses Circular EN allowance values and percentage-method tables. Nebraska also has a special minimum withholding rule that can require a higher amount than the base formula.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nebraskaStateWithholdingExemptions">Nebraska withholding allowances</Label>
                  <Input id="nebraskaStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.nebraskaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("nebraskaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the Nebraska W-4N allowance count. If left blank, the calculator uses zero allowances.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="nebraskaExempt" className="cursor-pointer">Nebraska exempt election</Label>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from Nebraska withholding on Form W-4N.</FieldHint>
                  </div>
                  <Switch id="nebraskaExempt" checked={formData.nebraskaExempt ?? false} onCheckedChange={(checked) => updateField("nebraskaExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {newMexicoSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">New Mexico withholding</h4>
                <p className="text-xs text-muted-foreground">
                  New Mexico payroll withholding uses the annual wage tables in FYI-104, with special exempt categories for military spouse relief and certain qualifying tribal income.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <Label htmlFor="newMexicoHigherSingleRate" className="cursor-pointer">Use higher single rate</Label>
                      <FieldHint>Turn this on only if the married employee requested withholding at the higher single rate.</FieldHint>
                    </div>
                    <Switch id="newMexicoHigherSingleRate" checked={formData.newMexicoHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("newMexicoHigherSingleRate", checked)}/>
                  </div>)}
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="newMexicoExempt" className="cursor-pointer">New Mexico exempt election</Label>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from New Mexico withholding.</FieldHint>
                  </div>
                  <Switch id="newMexicoExempt" checked={formData.newMexicoExempt ?? false} onCheckedChange={(checked) => updateField("newMexicoExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="newMexicoMilitarySpouseExempt" className="cursor-pointer">Military spouse exempt</Label>
                    <FieldHint>Turn this on only for a qualifying nonresident military spouse who kept an out-of-state residence under federal relief rules.</FieldHint>
                  </div>
                  <Switch id="newMexicoMilitarySpouseExempt" checked={formData.newMexicoMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("newMexicoMilitarySpouseExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="newMexicoNativeAmericanExempt" className="cursor-pointer">Qualifying tribal-income exempt</Label>
                    <FieldHint>Turn this on only for exempt wages earned on the employee&apos;s own New Mexico tribal or pueblo land while domiciled there.</FieldHint>
                  </div>
                  <Switch id="newMexicoNativeAmericanExempt" checked={formData.newMexicoNativeAmericanExempt ?? false} onCheckedChange={(checked) => updateField("newMexicoNativeAmericanExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {newJerseySelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">New Jersey NJ-W4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  New Jersey withholding uses NJ-W4 allowances plus either the default filing-status rate table or a wage-chart rate letter for higher-income joint, head-of-household, or surviving-spouse situations.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="newJerseyRateTable">NJ-W4 rate table letter</Label>
                  <Select value={formData.newJerseyRateTable ?? ""} onValueChange={(value) => updateField("newJerseyRateTable", value ? value as TaxProfile.Type["newJerseyRateTable"] : undefined)}>
                    <SelectTrigger id="newJerseyRateTable">
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
                  <FieldHint>Use line 3 from NJ-W4 if the employee used the wage chart. Otherwise leave blank and the calculator will use the standard table for the filing status.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newJerseyAllowances">NJ-W4 total allowances</Label>
                  <Input id="newJerseyAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.newJerseyAllowances)} onChange={(e) => updateField("newJerseyAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the number of New Jersey withholding allowances from line 4 of Form NJ-W4.</FieldHint>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="newJerseyExempt" className="cursor-pointer">New Jersey exempt election</Label>
                  <FieldHint>Turn this on only if the employee wrote EXEMPT on line 6 of Form NJ-W4 for the current year.</FieldHint>
                </div>
                <Switch id="newJerseyExempt" checked={formData.newJerseyExempt ?? false} onCheckedChange={(checked) => updateField("newJerseyExempt", checked)}/>
              </div>
            </div>)}

          {northCarolinaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">North Carolina NC-4 allowances</h4>
                <p className="text-xs text-muted-foreground">
                  North Carolina withholding uses NC-4 allowances with the NC-30 withholding formula.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="northCarolinaAllowances">NC-4 withholding allowances</Label>
                <Input id="northCarolinaAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.northCarolinaAllowances)} onChange={(e) => updateField("northCarolinaAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the allowance count from your NC-4 or NC-4 EZ.</FieldHint>
              </div>
            </div>)}

          {northDakotaSelected && (<div className="space-y-2 rounded-lg border p-4">
              <Label htmlFor="northDakotaHint">North Dakota withholding rules</Label>
              <FieldHint>
                North Dakota withholding uses the 2026 annual percentage method tied to the federal Form W-4 filing status. Reciprocity with Minnesota and Montana can be applied with the toggle below.
              </FieldHint>
            </div>)}

          {oklahomaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Oklahoma OK-W-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Oklahoma withholding uses OK-W-4 allowance counts, an optional higher single-rate election for married employees, and any additional Oklahoma amount requested per paycheck.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="oklahomaAllowances">OK-W-4 withholding allowances</Label>
                  <Input id="oklahomaAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.oklahomaAllowances)} onChange={(e) => updateField("oklahomaAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the number of Oklahoma withholding allowances claimed on Form OK-W-4.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="oklahomaAdditionalWithholding">Additional Oklahoma withholding per paycheck</Label>
                  <Input id="oklahomaAdditionalWithholding" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.oklahomaAdditionalWithholding)} onChange={(e) => updateField("oklahomaAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use the employee&apos;s extra Oklahoma dollar amount if they requested additional withholding.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <Label htmlFor="oklahomaHigherSingleRate" className="cursor-pointer">Married but withhold at higher single rate</Label>
                      <FieldHint>Turn this on only if the employee made that election on Form OK-W-4.</FieldHint>
                    </div>
                    <Switch id="oklahomaHigherSingleRate" checked={formData.oklahomaHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("oklahomaHigherSingleRate", checked)}/>
                  </div>)}
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="oklahomaExempt" className="cursor-pointer">Oklahoma exempt election</Label>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from Oklahoma withholding.</FieldHint>
                  </div>
                  <Switch id="oklahomaExempt" checked={formData.oklahomaExempt ?? false} onCheckedChange={(checked) => updateField("oklahomaExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="oklahomaMilitarySpouseExempt" className="cursor-pointer">Military spouse exempt</Label>
                    <FieldHint>Turn this on only for a qualifying military spouse who is exempt from Oklahoma withholding.</FieldHint>
                  </div>
                  <Switch id="oklahomaMilitarySpouseExempt" checked={formData.oklahomaMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("oklahomaMilitarySpouseExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="oklahomaMilitaryIncomeExempt" className="cursor-pointer">Active-duty military income exempt</Label>
                    <FieldHint>Turn this on only if the wages themselves are exempt military compensation for Oklahoma income tax purposes.</FieldHint>
                  </div>
                  <Switch id="oklahomaMilitaryIncomeExempt" checked={formData.oklahomaMilitaryIncomeExempt ?? false} onCheckedChange={(checked) => updateField("oklahomaMilitaryIncomeExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {ohioSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Ohio tax details</h4>
                <p className="text-xs text-muted-foreground">
                  Add your Ohio IT-4 details here. If school district or city taxes apply to you, you can add those too.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="ohioExemptions" label="Ohio IT-4 total exemptions" info={<>
                        <p>Enter the exemption count from your Ohio IT-4 if you know it.</p>
                        <p>Example: `0`, `1`, or `2`.</p>
                      </>}/>
                  <Input id="ohioExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.ohioExemptions)} onChange={(e) => updateField("ohioExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 4 from Ohio Form IT-4, the employee&apos;s total Ohio withholding exemptions.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="ohioAdditionalStateWithholding" label="Additional Ohio withholding per paycheck" info={<>
                        <p>Enter any extra Ohio amount you asked payroll to withhold from each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="ohioAdditionalStateWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.ohioAdditionalStateWithholding)} onChange={(e) => updateField("ohioAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 5 from Ohio Form IT-4 if the employee asked for extra Ohio income tax withholding.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ohioSchoolDistrictNumber">Ohio school district number</Label>
                  <Input id="ohioSchoolDistrictNumber" inputMode="numeric" placeholder="4-digit tax district number" value={formData.ohioSchoolDistrictNumber ?? ""} onChange={(e) => updateField("ohioSchoolDistrictNumber", e.target.value || undefined)}/>
                  <FieldHint>Use the 4-digit Ohio taxation school district number from IT-4 or The Finder.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ohioSchoolDistrictIncomeTaxRate">Ohio school district income tax rate (%)</Label>
                  <Input id="ohioSchoolDistrictIncomeTaxRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.25" value={getNumericInputValue(formData.ohioSchoolDistrictIncomeTaxRate)} onChange={(e) => updateField("ohioSchoolDistrictIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the school district income tax rate as a percent, such as 1.25 for 1.25%.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ohioMunicipalIncomeTaxRate">Ohio municipal income tax rate (%)</Label>
                  <Input id="ohioMunicipalIncomeTaxRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 2.50" value={getNumericInputValue(formData.ohioMunicipalIncomeTaxRate)} onChange={(e) => updateField("ohioMunicipalIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the Ohio work municipality withholding rate from The Finder when city income tax withholding applies.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ohioJeddJedzIncomeTaxRate">Ohio JEDD/JEDZ rate (%)</Label>
                  <Input id="ohioJeddJedzIncomeTaxRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.00" value={getNumericInputValue(formData.ohioJeddJedzIncomeTaxRate)} onChange={(e) => updateField("ohioJeddJedzIncomeTaxRate", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter any additional JEDD or JEDZ worksite rate from The Finder when the Ohio job site falls inside one of those districts.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="ohioResidentMilitaryOutsideOhioExempt" className="cursor-pointer">Ohio resident active-duty military exemption</Label>
                    <FieldHint>Turn this on only if the employee is an Ohio resident servicemember stationed outside Ohio on active-duty orders.</FieldHint>
                  </div>
                  <Switch id="ohioResidentMilitaryOutsideOhioExempt" checked={formData.ohioResidentMilitaryOutsideOhioExempt ?? false} onCheckedChange={(checked) => updateField("ohioResidentMilitaryOutsideOhioExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="ohioNonresidentMilitaryExempt" className="cursor-pointer">Ohio nonresident military exemption</Label>
                    <FieldHint>Turn this on only for a nonresident servicemember in Ohio due to military orders.</FieldHint>
                  </div>
                  <Switch id="ohioNonresidentMilitaryExempt" checked={formData.ohioNonresidentMilitaryExempt ?? false} onCheckedChange={(checked) => updateField("ohioNonresidentMilitaryExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="ohioNonresidentMilitarySpouseExempt" className="cursor-pointer">Ohio nonresident military spouse exemption</Label>
                    <FieldHint>Turn this on only for a qualifying nonresident military spouse in Ohio solely due to military orders.</FieldHint>
                  </div>
                  <Switch id="ohioNonresidentMilitarySpouseExempt" checked={formData.ohioNonresidentMilitarySpouseExempt ?? false} onCheckedChange={(checked) => updateField("ohioNonresidentMilitarySpouseExempt", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="ohioStatutoryExempt" className="cursor-pointer">Ohio statutory withholding exemption</Label>
                    <FieldHint>Use this only if the employee certified another valid Ohio withholding waiver reason on Section III of Form IT-4.</FieldHint>
                  </div>
                  <Switch id="ohioStatutoryExempt" checked={formData.ohioStatutoryExempt ?? false} onCheckedChange={(checked) => updateField("ohioStatutoryExempt", checked)}/>
                </div>
              </div>
              <FieldHint>If Ohio city or JEDD/JEDZ taxes apply to you, those rates still need to be entered manually.</FieldHint>
            </div>)}

          {newYorkSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">New York state and local withholding</h4>
                <p className="text-xs text-muted-foreground">
                  New York State withholding uses the 2026 NYS-50-T-NYS exact payroll method. New York City and Yonkers local withholding use the same IT-2104 allowance count where local resident withholding applies.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="newYorkWithholdingExemptions" label="IT-2104 withholding allowances" info={<>
                        <p>Enter the allowance count from your New York form if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` allowances.</p>
                      </>}/>
                  <Input id="newYorkWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.newYorkWithholdingExemptions)} onChange={(e) => updateField("newYorkWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the New York withholding allowance count from Form IT-2104. This same allowance count is also used for New York City and Yonkers resident local withholding.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="newYorkAdditionalStateWithholding" label="Additional New York State withholding" info={<>
                        <p>Enter any extra New York amount you asked payroll to withhold from each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="newYorkAdditionalStateWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.newYorkAdditionalStateWithholding)} onChange={(e) => updateField("newYorkAdditionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use the additional New York State amount requested on Form IT-2104, if any.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="newYorkLocality">New York local withholding category</Label>
                  <Select value={formData.newYorkLocality ?? ""} onValueChange={(value) => updateField("newYorkLocality", value ? value as TaxProfile.Type["newYorkLocality"] : undefined)}>
                    <SelectTrigger id="newYorkLocality">
                      <SelectValue placeholder="Select if applicable"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_york_city_resident">New York City resident</SelectItem>
                      <SelectItem value="yonkers_resident">Yonkers resident</SelectItem>
                      <SelectItem value="yonkers_nonresident">Yonkers nonresident earning wages in Yonkers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="newYorkExempt" label="New York State exempt election" className="cursor-pointer" info={<>
                          <p>Turn this on only if you marked yourself exempt from New York State withholding.</p>
                          <p>Example: leave this off for most users.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from New York State withholding on Form IT-2104 for the current year.</FieldHint>
                  </div>
                  <Switch id="newYorkExempt" checked={formData.newYorkExempt ?? false} onCheckedChange={(checked) => updateField("newYorkExempt", checked)}/>
                </div>
              </div>
              <FieldHint>For nonresident employees who work partly inside and partly outside New York, Form IT-2104.1 allocation can affect the proper New York wage base. This calculator treats the current paycheck&apos;s taxable wages as fully New York-source unless you manually adjust the wage base.</FieldHint>
            </div>)}

          {oregonSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Oregon tax details</h4>
                <p className="text-xs text-muted-foreground">
                  Add your Oregon OR-W-4 details here. If Metro or Multnomah County taxes apply to your work location, you can turn those on below.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="oregonAllowances" label="Oregon OR-W-4 allowances" info={<>
                        <p>Enter the allowance count from your Oregon form if you filled it out.</p>
                        <p>Example: `0`, `1`, or `2` allowances.</p>
                      </>}/>
                  <Input id="oregonAllowances" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.oregonAllowances)} onChange={(e) => updateField("oregonAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 2 from Form OR-W-4, the Oregon withholding allowance count.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="oregonAdditionalWithholding" label="Additional Oregon withholding per paycheck" info={<>
                        <p>Enter any extra Oregon amount you asked payroll to withhold from each paycheck.</p>
                        <p>Example: `10` or `25` dollars.</p>
                      </>}/>
                  <Input id="oregonAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.oregonAdditionalWithholding)} onChange={(e) => updateField("oregonAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 3 from Form OR-W-4 if the employee asked for extra Oregon withholding.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {formData.filingStatus === "marriedJoint" && (<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                    <div>
                      <LabelWithInfo htmlFor="oregonHigherSingleRate" label="Married but withhold at higher single rate" className="cursor-pointer" info={<>
                            <p>Turn this on only if you chose Oregon's higher single withholding rate on your form.</p>
                            <p>Example: many married users leave this off unless they selected it.</p>
                          </>}/>
                      <FieldHint>Turn this on only if the employee checked the Oregon higher single-rate box on Form OR-W-4.</FieldHint>
                    </div>
                    <Switch id="oregonHigherSingleRate" checked={formData.oregonHigherSingleRate ?? false} onCheckedChange={(checked) => updateField("oregonHigherSingleRate", checked)}/>
                  </div>)}
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="oregonExempt" label="Oregon exempt election" className="cursor-pointer" info={<>
                          <p>Turn this on only if you marked yourself exempt from Oregon withholding.</p>
                          <p>Example: leave this off for most users.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from Oregon withholding on Form OR-W-4.</FieldHint>
                  </div>
                  <Switch id="oregonExempt" checked={formData.oregonExempt ?? false} onCheckedChange={(checked) => updateField("oregonExempt", checked)}/>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="oregonMetroLocation" label="Works within Metro" className="cursor-pointer" info={<>
                          <p>Turn this on if your work location is inside the Portland Metro district.</p>
                          <p>Example: leave this off if you work outside Metro.</p>
                        </>}/>
                    <FieldHint>Turn this on only if the employee&apos;s work location is inside the Metro district.</FieldHint>
                  </div>
                  <Switch id="oregonMetroLocation" checked={formData.oregonMetroLocation ?? false} onCheckedChange={(checked) => updateField("oregonMetroLocation", checked)}/>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <LabelWithInfo htmlFor="oregonMultnomahCountyLocation" label="Works within Multnomah County" className="cursor-pointer" info={<>
                          <p>Turn this on if your work location is in Multnomah County.</p>
                          <p>Example: leave this off if you work in another county.</p>
                        </>}/>
                    <FieldHint>Turn this on when the employee&apos;s work location is in Multnomah County for Preschool for All withholding.</FieldHint>
                  </div>
                  <Switch id="oregonMultnomahCountyLocation" checked={formData.oregonMultnomahCountyLocation ?? false} onCheckedChange={(checked) => updateField("oregonMultnomahCountyLocation", checked)}/>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="oregonMetroWithholdingElection" label="Metro SHS withholding election" info={<>
                        <p>Choose whether Metro tax should be withheld automatically, opted in, or opted out.</p>
                        <p>Example: most users can leave this on `Automatic employer withholding`.</p>
                      </>}/>
                  <Select value={formData.oregonMetroWithholdingElection ?? "auto"} onValueChange={(value) => updateField("oregonMetroWithholdingElection", value as TaxProfile.Type["oregonMetroWithholdingElection"])}>
                    <SelectTrigger id="oregonMetroWithholdingElection">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatic employer withholding</SelectItem>
                      <SelectItem value="opt_in">Employee opted in</SelectItem>
                      <SelectItem value="opt_out">Employee opted out</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>Automatic withholding starts at employer payroll thresholds. Opt in or opt out if the employee filed a Metro election form.</FieldHint>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="oregonPfaWithholdingElection" label="Multnomah PFA withholding election" info={<>
                        <p>Choose whether Preschool for All tax should be withheld automatically, opted in, or opted out.</p>
                        <p>Example: most users can leave this on `Automatic employer withholding`.</p>
                      </>}/>
                  <Select value={formData.oregonPfaWithholdingElection ?? "auto"} onValueChange={(value) => updateField("oregonPfaWithholdingElection", value as TaxProfile.Type["oregonPfaWithholdingElection"])}>
                    <SelectTrigger id="oregonPfaWithholdingElection">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatic employer withholding</SelectItem>
                      <SelectItem value="opt_in">Employee opted in</SelectItem>
                      <SelectItem value="opt_out">Employee opted out</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>Use the employee&apos;s Multnomah opt form when they elected in, elected out, or requested different payroll handling.</FieldHint>
                </div>
              </div>
              <FieldHint>TriMet and Lane transit payroll taxes are employer-paid and are not deducted from the employee paycheck here.</FieldHint>
            </div>)}

          {utahSelected && (<div className="space-y-2 rounded-lg border p-4">
              <Label htmlFor="utahHint">Utah withholding rules</Label>
              <FieldHint>
                Utah payroll withholding uses the official Publication 14 pay-period schedule based on your federal filing status. Head of household follows the Utah single schedule.
              </FieldHint>
            </div>)}

          {virginiaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Virginia VA-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Virginia withholding uses the VA-4 exemption counts, with personal/dependent exemptions on one line and age/blindness exemptions on another.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="virginiaPersonalExemptions">VA-4 personal and dependent exemptions</Label>
                  <Input id="virginiaPersonalExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.virginiaPersonalExemptions)} onChange={(e) => updateField("virginiaPersonalExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1(a) from Virginia Form VA-4.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="virginiaAgeBlindExemptions">VA-4 age 65 / blindness exemptions</Label>
                  <Input id="virginiaAgeBlindExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.virginiaAgeBlindExemptions)} onChange={(e) => updateField("virginiaAgeBlindExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1(b) from Virginia Form VA-4.</FieldHint>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="virginiaExempt" className="cursor-pointer">Virginia exempt election</Label>
                  <FieldHint>Turn this on only if the employee certified they are not subject to Virginia withholding on Form VA-4.</FieldHint>
                </div>
                <Switch id="virginiaExempt" checked={formData.virginiaExempt ?? false} onCheckedChange={(checked) => updateField("virginiaExempt", checked)}/>
              </div>
            </div>)}

          {pennsylvaniaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Pennsylvania tax details</h4>
                <p className="text-xs text-muted-foreground">
                  Pennsylvania state tax is straightforward, but local earned income tax can depend on both where you live and where you work.
                </p>
              </div>
              <FieldHint>Only add the local Pennsylvania fields if local earned income tax applies to you.</FieldHint>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pennsylvaniaResidentPsdCode">Resident PSD code</Label>
                  <Input id="pennsylvaniaResidentPsdCode" inputMode="numeric" placeholder="6-digit PSD code" value={formData.pennsylvaniaResidentPsdCode ?? ""} onChange={(e) => updateField("pennsylvaniaResidentPsdCode", e.target.value || undefined)}/>
                  <FieldHint>Use the PSD code for the municipality where you live in Pennsylvania.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pennsylvaniaResidentEitRate">Resident total EIT rate (%)</Label>
                  <Input id="pennsylvaniaResidentEitRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 1.00" value={getNumericInputValue(formData.pennsylvaniaResidentEitRate)} onChange={(e) => updateField("pennsylvaniaResidentEitRate", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total resident EIT rate as a percent, such as 1.00 for 1.00%.</FieldHint>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pennsylvaniaWorkPsdCode">Work PSD code</Label>
                  <Input id="pennsylvaniaWorkPsdCode" inputMode="numeric" placeholder="6-digit PSD code" value={formData.pennsylvaniaWorkPsdCode ?? ""} onChange={(e) => updateField("pennsylvaniaWorkPsdCode", e.target.value || undefined)}/>
                  <FieldHint>Use the PSD code for your Pennsylvania work municipality. Leave blank if you do not work in Pennsylvania.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pennsylvaniaWorkNonResidentEitRate">Work nonresident EIT rate (%)</Label>
                  <Input id="pennsylvaniaWorkNonResidentEitRate" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" placeholder="Example: 0.50" value={getNumericInputValue(formData.pennsylvaniaWorkNonResidentEitRate)} onChange={(e) => updateField("pennsylvaniaWorkNonResidentEitRate", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the Pennsylvania work municipality&apos;s nonresident EIT rate as a percent.</FieldHint>
                </div>
              </div>
            </div>)}

          {rhodeIslandSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Rhode Island RI-W4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Rhode Island withholding uses the RI-W4 allowance count, any additional Rhode Island amount requested per paycheck, and the 2026 percentage-method rate tables. If annual wages exceed $290,800, the RI-W4 exemption amount phases out to zero.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rhodeIslandAllowances">RI-W4 total allowances</Label>
                  <Input id="rhodeIslandAllowances" type="number" min="0" max="10" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.rhodeIslandAllowances)} onChange={(e) => updateField("rhodeIslandAllowances", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter line 1 from Form RI-W4. Rhode Island caps the regular allowance count at 10.</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rhodeIslandAdditionalWithholding">Additional Rhode Island withholding per paycheck</Label>
                  <Input id="rhodeIslandAdditionalWithholding" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={getNumericInputValue(formData.rhodeIslandAdditionalWithholding)} onChange={(e) => updateField("rhodeIslandAdditionalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Use line 2 from Form RI-W4 if the employee requested extra Rhode Island withholding.</FieldHint>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rhodeIslandExemptStatus">Rhode Island exemption status</Label>
                <Select value={formData.rhodeIslandExemptStatus ?? ""} onValueChange={(value) => updateField("rhodeIslandExemptStatus", value ? value as TaxProfile.Type["rhodeIslandExemptStatus"] : undefined)}>
                  <SelectTrigger id="rhodeIslandExemptStatus">
                    <SelectValue placeholder="Select only if the employee claimed annual exemption" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EXEMPT">EXEMPT</SelectItem>
                    <SelectItem value="EXEMPT-MS">EXEMPT-MS</SelectItem>
                  </SelectContent>
                </Select>
                  <FieldHint>Use `EXEMPT` only if the employee expects no Rhode Island tax liability for 2026. Use `EXEMPT-MS` only for a qualifying military spouse under the Military Spouses Residency Relief Act.</FieldHint>
              </div>
            </div>)}

          {southCarolinaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">South Carolina SC W-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  South Carolina withholding uses the annual SC formula with a $5,000 value for each withholding allowance and a 10% standard deduction capped at $7,500 whenever one or more allowances are claimed.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="southCarolinaStateWithholdingExemptions">South Carolina withholding allowances</Label>
                  <Input id="southCarolinaStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.southCarolinaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("southCarolinaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total allowance count from the employee&apos;s SC W-4 worksheet. The extra state withholding field below can be used for any additional South Carolina amount requested on line 6.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="southCarolinaExempt" className="cursor-pointer">South Carolina exempt election</Label>
                    <FieldHint>Turn this on only if the employee properly claimed exemption from South Carolina withholding for 2026.</FieldHint>
                  </div>
                  <Switch id="southCarolinaExempt" checked={formData.southCarolinaExempt ?? false} onCheckedChange={(checked) => updateField("southCarolinaExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {washingtonDCSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">District of Columbia D-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  District withholding uses the employee&apos;s D-4 allowance count together with current DC resident rate brackets. Nonresidents generally should not have DC wage withholding.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="districtOfColumbiaStateWithholdingExemptions">DC D-4 allowances</Label>
                  <Input id="districtOfColumbiaStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.districtOfColumbiaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("districtOfColumbiaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total D-4 allowance count. If the employee lives outside DC, use the residence-state field below so the calculator can treat the wages as nonresident DC wages.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="districtOfColumbiaExempt" className="cursor-pointer">District exempt election</Label>
                    <FieldHint>Turn this on only if the employee properly claimed `EXEMPT` on Form D-4 for the current year.</FieldHint>
                  </div>
                  <Switch id="districtOfColumbiaExempt" checked={formData.districtOfColumbiaExempt ?? false} onCheckedChange={(checked) => updateField("districtOfColumbiaExempt", checked)}/>
                </div>
              </div>
            </div>)}

          {vermontSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Vermont W-4VT withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Vermont withholding uses W-4VT allowance counts and Vermont payroll rate schedules. Vermont also generally increases state withholding when extra federal withholding is requested.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vermontStateWithholdingExemptions">Vermont withholding allowances</Label>
                <Input id="vermontStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.vermontWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("vermontWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the number of allowances claimed on Form W-4VT. If blank, the calculator uses zero allowances.</FieldHint>
              </div>
              <FieldHint>For Vermont residents, the extra federal withholding field below is also used to estimate Vermont&apos;s related 30% payroll add-on.</FieldHint>
            </div>)}

          {westVirginiaSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">West Virginia IT-104 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  West Virginia withholding uses IT-104 exemption counts and, when elected on the certificate, a lower one-earner rate table for single, head-of-household, or one-income households.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="westVirginiaStateWithholdingExemptions">West Virginia IT-104 exemptions</Label>
                  <Input id="westVirginiaStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.westVirginiaWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("westVirginiaWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                  <FieldHint>Enter the total IT-104 exemption count. If blank, the calculator uses zero exemptions.</FieldHint>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="westVirginiaLowerRateElection" className="cursor-pointer">Use lower one-earner rate</Label>
                    <FieldHint>Turn this on only if the employee checked line 5 on Form IT-104 to use the lower one-earner withholding table.</FieldHint>
                  </div>
                  <Switch id="westVirginiaLowerRateElection" checked={formData.westVirginiaLowerRateElection ?? false} onCheckedChange={(checked) => updateField("westVirginiaLowerRateElection", checked)}/>
                </div>
              </div>
            </div>)}

          {wisconsinSelected && (<div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Wisconsin WT-4 withholding</h4>
                <p className="text-xs text-muted-foreground">
                  Wisconsin payroll withholding uses the W-166 alternate annualized method together with WT-4 exemption counts.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wisconsinStateWithholdingExemptions">Wisconsin WT-4 exemptions</Label>
                <Input id="wisconsinStateWithholdingExemptions" type="number" min="0" inputMode="numeric" placeholder="0" value={getNumericInputValue(formData.wisconsinWithholdingExemptions ?? formData.stateWithholdingExemptions)} onChange={(e) => updateField("wisconsinWithholdingExemptions", parseOptionalNumber(e.target.value))} className="text-right"/>
                <FieldHint>Enter the number of Wisconsin withholding exemptions from Form WT-4. If blank, the calculator uses zero exemptions.</FieldHint>
              </div>
              <FieldHint>Use the reciprocity toggle below only if you filed the Wisconsin reciprocity form with your employer.</FieldHint>
            </div>)}

          {locationDetailsRelevant && (<div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm">Where you live and work</h4>
              <p className="text-xs text-muted-foreground">
                We only need this because your state or local tax estimate can change based on where you live, where you work, or both.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <StateDropdown id="residenceState" value={formData.residenceState} onChange={(value) => updateField("residenceState", value)} label="Residence state"/>
              <StateDropdown id="workState" value={formData.workState} onChange={(value) => updateField("workState", value)} label="Work state"/>
            </div>
            {!formData.multiStateWorker && (<FieldHint>
                If you live and work in one state, these stay matched to your primary state automatically.
              </FieldHint>)}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithInfo htmlFor="residenceCounty" label={`Residence county${marylandResidentSelected ? " *" : ""}`} info={<>
                      <p>Enter your home county if state or local taxes depend on where you live.</p>
                      <p>Example: Maryland and Indiana often use this for withholding.</p>
                    </>}/>
                <Input id="residenceCounty" placeholder="Optional" value={formData.residenceCounty ?? ""} onChange={(e) => updateField("residenceCounty", e.target.value || undefined)}/>
                {marylandResidentSelected && (<FieldHint>
                    Maryland resident withholding uses your residence county.
                  </FieldHint>)}
                {indianaResidentSelected && (<FieldHint>
                    Indiana county withholding uses your Indiana county of residence as of January 1.
                  </FieldHint>)}
                {missingMarylandResidentCounty && (<p className="text-xs text-destructive">
                    Required for Maryland resident paycheck estimates.
                  </p>)}
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="workCounty" label="Work county" info={<>
                      <p>Enter the county where you usually work if local or state withholding depends on it.</p>
                      <p>Example: some Indiana and Maryland situations use this.</p>
                    </>}/>
                <Input id="workCounty" placeholder="Optional" value={formData.workCounty ?? ""} onChange={(e) => updateField("workCounty", e.target.value || undefined)}/>
                {marylandSelected && !marylandResidentSelected && (<FieldHint>
                    Maryland nonresident withholding uses the special nonresident rate, so work county is usually optional here.
                  </FieldHint>)}
                {indianaSelected && !indianaResidentSelected && (<FieldHint>
                    Indiana nonresident county withholding uses the principal Indiana work county as of January 1.
                  </FieldHint>)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithInfo htmlFor="residenceCity" label="Residence city" info={<>
                      <p>Enter your home city only if local taxes depend on where you live.</p>
                      <p>Example: many users can leave this blank.</p>
                    </>}/>
                <Input id="residenceCity" placeholder="Optional" value={formData.residenceCity ?? ""} onChange={(e) => updateField("residenceCity", e.target.value || undefined)}/>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="workCity" label="Work city" info={<>
                      <p>Enter your work city only if local taxes depend on where you work.</p>
                      <p>Example: many users can leave this blank.</p>
                    </>}/>
                <Input id="workCity" placeholder="Optional" value={formData.workCity ?? ""} onChange={(e) => updateField("workCity", e.target.value || undefined)}/>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithInfo htmlFor="postalCode" label="Postal code" info={<>
                      <p>Enter your ZIP or postal code if it helps identify local taxes in your area.</p>
                      <p>Example: `10001`.</p>
                    </>}/>
                <Input id="postalCode" placeholder="Optional" value={formData.postalCode ?? ""} onChange={(e) => updateField("postalCode", e.target.value || undefined)}/>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="schoolDistrictId" label="School district / district code" info={<>
                      <p>Use this only if you already know a school district or similar local tax code.</p>
                      <p>Example: Ohio school district numbers often go here.</p>
                    </>}/>
                <Input id="schoolDistrictId" placeholder="Optional" value={formData.schoolDistrictId ?? ""} onChange={(e) => updateField("schoolDistrictId", e.target.value || undefined)}/>
                <FieldHint>Only use this if you already know a district code that affects your local taxes.</FieldHint>
              </div>
            </div>

            {(localTaxStateSelected || formData.multiStateWorker) && (<div className="space-y-2">
                <LabelWithInfo htmlFor="localTaxJurisdictionIds" label="Known local tax IDs" info={<>
                      <p>Add any county, city, or district tax IDs only if you already know them.</p>
                      <p>Example: enter multiple IDs separated by commas.</p>
                    </>}/>
                <Input id="localTaxJurisdictionIds" placeholder="Optional" value={formatList(formData.localTaxJurisdictionIds)} onChange={(e) => updateField("localTaxJurisdictionIds", parseCommaSeparatedList(e.target.value))}/>
                <FieldHint>You can leave this blank unless you already know your county, city, or district tax IDs.</FieldHint>
              </div>)}

            <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
              <div>
                <LabelWithInfo htmlFor="reciprocityElection" label="Reciprocity applies" className="cursor-pointer" info={<>
                      <p>Turn this on only if you gave your employer a reciprocity form and your home/work states allow it.</p>
                      <p>Example: this can stop the work state from withholding in some cross-state cases.</p>
                    </>}/>
                <FieldHint>Turn this on only if you gave your employer a reciprocity form and your home state/work state qualify.</FieldHint>
              </div>
              <Switch id="reciprocityElection" checked={formData.reciprocityElection ?? false} onCheckedChange={(checked) => updateField("reciprocityElection", checked)}/>
            </div>
          </div>)}

          {formData.state === "Washington" && (<div className="space-y-4 p-4 bg-muted rounded-lg">
              <div className="space-y-1">
                <h3 className="font-semibold text-sm">Washington payroll programs</h3>
                <p className="text-xs text-muted-foreground">
                  Washington does not withhold state income tax on wages, but some employers withhold PFML and WA Cares.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="pfmlPercent" label="PFML (%)" info={<>
                        <p>Enter the employee-share percent for Washington Paid Family and Medical Leave if your employer withholds it.</p>
                        <p>Example: `0.44` means 0.44%.</p>
                      </>}/>
                  <Input id="pfmlPercent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={getNumericInputValue(formData.pfmlPercent)} onChange={(e) => updateField("pfmlPercent", parseOptionalNumber(e.target.value))} className="text-right"/>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="waCaresPercent" label="WA Cares (%)" info={<>
                        <p>Enter the employee-share percent for WA Cares if your employer withholds it.</p>
                        <p>Example: `0.58` means 0.58%.</p>
                      </>}/>
                  <Input id="waCaresPercent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={getNumericInputValue(formData.waCaresPercent)} onChange={(e) => updateField("waCaresPercent", parseOptionalNumber(e.target.value))} className="text-right"/>
                </div>
              </div>
            </div>)}

          <div className="space-y-4">
            <Separator />
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">Optional pre-tax and post-tax deductions</h3>
              <p className="text-sm text-muted-foreground">
                Add these only if you want your net pay preview to account for them.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">401(k) contributions</h4>
                <p className="text-xs text-muted-foreground">
                  Use either a percent, a flat amount, or both if your paystub uses both.
                </p>
              </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="retirement401kType" label="Contribution type" info={<>
                        <p>Choose whether your 401(k) money comes out before taxes or after taxes.</p>
                        <p>Example: `Traditional` is usually pre-tax, `Roth` is after-tax.</p>
                      </>}/>
                <Select value={formData.retirement401kType} onValueChange={(value) => updateField("retirement401kType", value as TaxProfile.Type["retirement401kType"])}>
                  <SelectTrigger id="retirement401kType">
                    <SelectValue placeholder="Select a 401(k) type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="traditional">Traditional (pre-tax)</SelectItem>
                    <SelectItem value="roth">Roth (after-tax)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="retirement401kPercent" label="Percent of pay" info={<>
                        <p>Enter the percent of each paycheck that goes into your 401(k).</p>
                        <p>Example: `3` for 3% or `6` for 6%.</p>
                      </>}/>
                  <Input id="retirement401kPercent" type="number" inputMode="decimal" min="0" max="100" step="0.1" placeholder="Leave blank if unused" value={getNumericInputValue(formData.retirement401kPercent)} onChange={(e) => updateField("retirement401kPercent", parseOptionalNumber(e.target.value))} className="text-right"/>
                </div>
                <div className="space-y-2">
                  <LabelWithInfo htmlFor="retirement401kFlat" label="Flat amount per paycheck" info={<>
                        <p>Enter a fixed dollar amount taken out for your 401(k) each paycheck.</p>
                        <p>Example: `25` or `50` dollars.</p>
                      </>}/>
                  <Input id="retirement401kFlat" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Leave blank if unused" value={getNumericInputValue(formData.retirement401kFlat)} onChange={(e) => updateField("retirement401kFlat", parseOptionalNumber(e.target.value))} className="text-right"/>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Health insurance</h4>
                <p className="text-xs text-muted-foreground">
                  Add the amount taken out of each paycheck if you want it reflected in take-home pay.
                </p>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="insurancePremium" label="Premium per paycheck" info={<>
                      <p>Enter the amount taken out of each paycheck for insurance.</p>
                      <p>Example: `35.50` or `80` dollars per paycheck.</p>
                    </>}/>
                <Input id="insurancePremium" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Leave blank if unused" value={getNumericInputValue(formData.insurancePremium)} onChange={(e) => updateField("insurancePremium", parseOptionalNumber(e.target.value))} className="text-right"/>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div>
                    <LabelWithInfo htmlFor="insurancePreTax" label="Deduct before taxes" className="cursor-pointer" info={<>
                          <p>Turn this on if your insurance comes out before taxes are calculated.</p>
                          <p>Example: many employer medical plans are pre-tax.</p>
                        </>}/>
                    <FieldHint>Turn this off if your premium comes out after taxes.</FieldHint>
                  </div>
                </div>
                <Switch id="insurancePreTax" checked={formData.insurancePreTax} onCheckedChange={(checked) => updateField("insurancePreTax", checked)}/>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h4 className="font-medium text-sm">Extra withholding</h4>
                <p className="text-xs text-muted-foreground">
                  If your W-4 asks payroll to withhold extra, add it here as a per-paycheck amount.
                </p>
              </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <LabelWithInfo htmlFor="additionalFederalWithholding" label="Extra federal withholding" info={<>
                      <p>Enter any extra federal amount you asked payroll to take from each paycheck.</p>
                      <p>Example: `15` or `25` dollars per paycheck.</p>
                    </>}/>
                <Input id="additionalFederalWithholding" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Leave blank if unused" value={getNumericInputValue(formData.additionalFederalWithholding)} onChange={(e) => updateField("additionalFederalWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
              </div>
              <div className="space-y-2">
                <LabelWithInfo htmlFor="additionalStateWithholding" label="Extra state withholding" info={<>
                      <p>Enter any extra state amount you asked payroll to take from each paycheck.</p>
                      <p>Example: `10` or `20` dollars per paycheck.</p>
                    </>}/>
                <Input id="additionalStateWithholding" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Leave blank if unused" value={getNumericInputValue(formData.additionalStateWithholding)} onChange={(e) => updateField("additionalStateWithholding", parseOptionalNumber(e.target.value))} className="text-right"/>
              </div>
            </div>
            </div>
          </div>

          <Button type="button" className="w-full" onClick={handleSave}>
            Save Paycheck Estimate Settings
          </Button>
        </form>
      </CardContent>
    </div>);
}
