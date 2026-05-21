"use client";
import { useEffect, useRef, useState } from "react";
import { TaxProfile } from "@shared/schemas";
import { W2SettingsType } from "@shared/schemas/settings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Info } from "lucide-react";
import NextDynamic from "next/dynamic";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
const TaxForm = NextDynamic(() => import("@/components/tax/TaxForm"), {
    ssr: false,
});
export default function W2SettingsSection({ data, isInitialSetup = false, onChange, }: {
    data?: Partial<W2SettingsType>;
    isInitialSetup?: boolean;
    onChange: (patch: Partial<W2SettingsType>, behavior?: "immediate" | "deferred") => void;
}) {
    const [local, setLocal] = useState<Partial<W2SettingsType>>(data ?? {});
    const [editingRow, setEditingRow] = useState<number | null>(null);
    const [showTaxForm, setShowTaxForm] = useState(false);
    const [isHourInputModeOpen, setIsHourInputModeOpen] = useState(false);
    const hourInputModeRef = useRef<HTMLDivElement | null>(null);
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const hydrateTaxProfileFromCacheOnce = useTaxProfileStore((s) => s.hydrateFromCacheOnce);
    const taxEntry = useTaxProfileStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const savedTaxProfile = (taxEntry?.taxProfile ?? null) as TaxProfile.Type | null;
    const [deductionErrors, setDeductionErrors] = useState<{
        label?: string;
        amount?: string;
    }[]>([]);
    const [deductionGlobalError, setDeductionGlobalError] = useState<string | null>(null);
    useEffect(() => {
        setLocal(data ?? {});
    }, [data]);
    useEffect(() => {
        if (!activeWorkspaceId)
            return;
        hydrateTaxProfileFromCacheOnce(activeWorkspaceId).catch((error) => {
        });
    }, [activeWorkspaceId, hydrateTaxProfileFromCacheOnce]);
    function update<K extends keyof W2SettingsType>(field: K, value: W2SettingsType[K], behavior: "immediate" | "deferred" = "deferred") {
        setLocal((prev) => ({ ...prev, [field]: value }));
        onChange({ [field]: value }, behavior);
    }
    function updateDeductions(list: W2SettingsType["customDeductions"], behavior: "immediate" | "deferred" = "deferred") {
        update("customDeductions", list, behavior);
    }
    function promptForHourInputMode() {
        if (!isInitialSetup || !local.useHours || !local.defaultHourlyRate || local.defaultHourlyRate <= 0 || local.workInputMode) {
            return;
        }
        hourInputModeRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
        setIsHourInputModeOpen(true);
    }
    // Amount formatter — unchanged
    function formatCentsInput(raw: string): number {
        const digits = raw.replace(/\D/g, "");
        if (!digits)
            return 0;
        if (digits.length === 1)
            return Number("0.0" + digits);
        if (digits.length === 2)
            return Number("0." + digits);
        const dollars = digits.slice(0, -2);
        const cents = digits.slice(-2);
        return Number(`${dollars}.${cents}`);
    }
    return (<div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Income Gauge Target</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="incomeTargetPerPeriod">Target Income Per Pay Period ($)</Label>
          <Input id="incomeTargetPerPeriod" type="number" step="0.01" min="0" placeholder="Optional" value={local.incomeTargetPerPeriod ?? ""} onChange={(e) => {
            const raw = e.target.value;
            if (raw === "")
                return update("incomeTargetPerPeriod", undefined, "deferred");
            update("incomeTargetPerPeriod", Number(raw), "deferred");
        }}/>
          <p className="text-sm text-muted-foreground">
            If you set a target, your pay period income gauge will fill based on progress toward that amount.
          </p>
        </CardContent>
      </Card>

      {/* Hourly Employee */}
      <Card>
        <CardHeader>
          <CardTitle>Hourly Income</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="useHours">Do you have hourly income?</Label>
              <p className="text-sm text-muted-foreground">
                Enables hourly rate, input mode & deductions.
              </p>
            </div>
            <Switch id="useHours" checked={local.useHours ?? false} // FIX: optional boolean must default to false
     onCheckedChange={(v) => update("useHours", v, "immediate")}/>
          </div>

          {local.useHours && (<div className="space-y-6">
              {/* Default Hourly Rate */}
              <div className="space-y-2">
                <Label htmlFor="defaultHourlyRate">Default Hourly Rate ($)</Label>
                <Input id="defaultHourlyRate" type="number" step="0.01" placeholder="0.00" value={local.defaultHourlyRate ?? ""} // FIX: sparse optional numeric
         onChange={(e) => {
                const raw = e.target.value;
                // FIX: blank input should clear field (undefined), not force 0
                if (raw === "")
                    return update("defaultHourlyRate", undefined, "deferred");
                update("defaultHourlyRate", Number(raw), "deferred");
            }} onBlur={() => promptForHourInputMode()}/>
                {isInitialSetup &&
                    local.useHours &&
                    (local.defaultHourlyRate ?? 0) > 0 &&
                    !local.workInputMode ? (<p className="text-sm font-medium text-emerald-700">
                    Next: choose how you want to enter your hours below.
                  </p>) : null}
              </div>

              {/* Hour Input Mode */}
              <div ref={hourInputModeRef} className="space-y-2">
                <Label>Hour Input Mode</Label>
                <Select open={isHourInputModeOpen} onOpenChange={setIsHourInputModeOpen} value={local.workInputMode} onValueChange={(v) => {
                update("workInputMode", v as W2SettingsType["workInputMode"], "immediate");
                setIsHourInputModeOpen(false);
            }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose hour input mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enter_hours">Enter hours manually</SelectItem>
                    <SelectItem value="enter_in_out_times">
                      Enter in/out times
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isInitialSetup && local.useHours && !local.workInputMode ? (<p className="text-sm text-emerald-800">
                    Pick one to finish your hourly income setup.
                  </p>) : null}
              </div>

              {/* Break Deduction */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="autoBreakDeduction">Break Deduction</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically deduct selected break duration.
                    </p>
                  </div>
                  <Switch id="autoBreakDeduction" checked={local.autoBreakDeduction ?? false} // FIX: optional boolean
         onCheckedChange={(c) => update("autoBreakDeduction", c, "immediate")}/>
                </div>

                {local.autoBreakDeduction && (<div className="flex justify-end">
                    <select className="border rounded-md px-2 py-1 text-sm" value={local.breakMinutesDefault ?? 30} // UI fallback only
             onChange={(e) => update("breakMinutesDefault", Number(e.target.value), "immediate")}>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>60 min</option>
                    </select>
                  </div>)}
              </div>

              {/* Additional Deductions */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Additional Deductions</Label>
                  <div className="text-sm text-muted-foreground cursor-default">
                    i
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Create regular, customizable deductions (like uniforms or
                  meals). These will appear as checkboxes in your entry form so
                  you can include or skip them per shift.
                </p>

                {deductionGlobalError && (<p className="text-xs text-destructive">
                    {deductionGlobalError}
                  </p>)}

                {(local.customDeductions ?? []).map((d, index) => {
                const isEditing = editingRow === index;
                if (!isEditing) {
                    return (<div key={index} className="flex items-center justify-between rounded-md border bg-secondary/70 px-4 py-3">
                        <div className="flex items-center space-x-3">
                          <Label>{d.label}</Label>
                          <span className="text-sm text-muted-foreground">
                            ${d.amount.toFixed(2)}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingRow(index)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => {
                            const updated = [
                                ...(local.customDeductions ?? []),
                            ];
                            updated.splice(index, 1);
                            updateDeductions(updated, "immediate");
                            const errCopy = [...deductionErrors];
                            errCopy.splice(index, 1);
                            setDeductionErrors(errCopy);
                        }}>
                            Remove
                          </Button>
                        </div>
                      </div>);
                }
                return (<Card key={index} className="p-4 space-y-3">
                      <div className="space-y-1">
                        <Input placeholder="Label" value={d.label} onChange={(e) => {
                        const updated = [
                            ...(local.customDeductions ?? []),
                        ];
                        updated[index] = {
                            ...updated[index],
                            label: e.target.value,
                        };
                        updateDeductions(updated, "deferred");
                    }}/>
                      </div>

                      <div className="space-y-1">
                        <Input placeholder="Amount" value={d.amount === 0 ? "" : d.amount.toString()} onChange={(e) => {
                        const formatted = formatCentsInput(e.target.value);
                        const updated = [
                            ...(local.customDeductions ?? []),
                        ];
                        updated[index] = {
                            ...updated[index],
                            amount: formatted,
                        };
                        updateDeductions(updated, "deferred");
                    }}/>
                      </div>

                      <div className="flex justify-end space-x-2">
                        <Button variant="secondary" onClick={() => {
                        const arr = [...(local.customDeductions ?? [])];
                        const d = arr[index];
                        const isNewEmpty = (d.label ?? "").trim() === "" &&
                            (d.amount ?? 0) === 0;
                        if (isNewEmpty) {
                            arr.splice(index, 1);
                            updateDeductions(arr, "immediate");
                            const errCopy = [...deductionErrors];
                            errCopy.splice(index, 1);
                            setDeductionErrors(errCopy);
                        }
                        setEditingRow(null);
                    }}>
                          Cancel
                        </Button>

                        <Button onClick={() => setEditingRow(null)}>
                          Save
                        </Button>
                      </div>
                    </Card>);
            })}

                <Button type="button" variant="outline" onClick={() => {
                const arr = local.customDeductions ?? [];
                updateDeductions([...arr, { label: "", amount: 0 }], "immediate");
                setEditingRow(arr.length);
                setDeductionErrors((prev) => [...prev, {}]);
                setDeductionGlobalError(null);
            }}>
                  + Add Deduction
                </Button>
              </div>
            </div>)}
        </CardContent>
      </Card>

      {/* Tipped Employee */}
      <Card>
        <CardHeader>
          <CardTitle>Tip Income</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="isTippedEmployee">
                Do you have tip income?
              </Label>
              <p className="text-sm text-muted-foreground">
                Enables tracking of cash and credit tips.
              </p>
            </div>
            <Switch id="isTippedEmployee" checked={local.isTippedEmployee ?? false} // FIX: optional boolean
     onCheckedChange={(v) => update("isTippedEmployee", v, "immediate")}/>
          </div>

          {local.isTippedEmployee && (<div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Choose what you would like to track.
              </p>

              <div className="flex items-center justify-between">
                <Label htmlFor="askCardTips">Credit Card Tips</Label>
                <Switch id="askCardTips" checked={local.askCardTips ?? false} // FIX
         onCheckedChange={(v) => update("askCardTips", v, "immediate")}/>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="askReportedCash">Reported Cash</Label>
                <Switch id="askReportedCash" checked={local.askReportedCash ?? false} // FIX
         onCheckedChange={(v) => update("askReportedCash", v, "immediate")}/>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="askUnreportedCash">
                    Unreported Cash
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    For personal tracking only — your data stays yours.
                  </p>
                </div>
                <Switch id="askUnreportedCash" checked={local.askUnreportedCash ?? false} // FIX
         onCheckedChange={(v) => update("askUnreportedCash", v, "immediate")}/>
              </div>

              {local.askUnreportedCash && (<div className="flex items-center justify-between pl-2">
                  <div>
                    <Label htmlFor="includeUnreportedInUI">
                      Include unreported cash in income totals?
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Does not affect tax estimations; appears in totals +
                      averages.
                    </p>
                  </div>
                  <Switch id="includeUnreportedInUI" checked={local.includeUnreportedInUI ?? false} // FIX
             onCheckedChange={(v) => update("includeUnreportedInUI", v, "immediate")}/>
                </div>)}
            </div>)}
        </CardContent>
      </Card>

      {/* Paycheck Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Paycheck Preview</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Paycheck preview info">
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-sm" align="start" sideOffset={6}>
                We use these settings to estimate your take-home pay for this workspace.
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-sm text-muted-foreground">
            This is a paycheck preview, not a filed tax return.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Switch id="autoTaxCalculation" checked={local.autoTaxCalculation ?? false} // FIX: optional boolean safety
     onCheckedChange={(checked) => {
            update("autoTaxCalculation", checked, "immediate");
            if (checked && !savedTaxProfile) {
                setShowTaxForm(true);
                return;
            }
            setShowTaxForm(false);
        }}/>
          </div>

          {local.autoTaxCalculation && (<>
              {showTaxForm ? (<div className="mt-4 space-y-4">
                  <TaxForm onClose={() => setShowTaxForm(false)}/>
                </div>) : savedTaxProfile ? (<div className="mt-4 flex flex-col gap-3 rounded-lg border p-3 bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">Paycheck estimate profile saved</p>
                    <p className="text-sm text-muted-foreground">
                      {(savedTaxProfile.state || "No state selected")} • {savedTaxProfile.filingStatus === "marriedJoint"
                        ? "Married filing jointly"
                        : savedTaxProfile.filingStatus === "marriedSeparate"
                            ? "Married filing separately"
                            : savedTaxProfile.filingStatus === "headOfHousehold"
                                ? "Head of household"
                                : "Single"} • {savedTaxProfile.dependents ?? 0} dependents
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setShowTaxForm(true)}>
                    Edit Details
                  </Button>
                </div>) : (<div className="mt-4 flex flex-col gap-3 rounded-lg border p-3 bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">Paycheck estimate details needed</p>
                    <p className="text-sm text-muted-foreground">
                      Add your filing status, work state, and any paycheck deductions you want reflected.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setShowTaxForm(true)}>
                    Set Up Estimate
                  </Button>
                </div>)}
            </>)}
        </CardContent>
      </Card>

      {/* Pay Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Pay Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="payFrequency">Pay Frequency</Label>
            <Select value={local.payFrequency} onValueChange={(v) => update("payFrequency", v as W2SettingsType["payFrequency"], "immediate")}>
              <SelectTrigger id="payFrequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payPeriodStartDate">
              Pay Period Start Date
            </Label>
            <Input id="payPeriodStartDate" type="date" value={local.payPeriodStartDate} onChange={(e) => update("payPeriodStartDate", e.target.value, "deferred")}/>
            <p className="text-sm text-muted-foreground">
              The first day of your current or most recent pay period.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>);
}
