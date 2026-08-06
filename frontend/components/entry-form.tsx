// /components/entry-form.tsx
"use client";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Plus, Minus, Info } from "lucide-react";
import { debounce } from "@/lib/timing";
import { formatCurrency, getLocalDateInputValue } from "@/lib/helpers";
import {
    categoryLabels,
    draftSum,
    emptyBreakdownDraft,
    parseMoney,
    paymentCategoryConfig,
    rebalanceBreakdownDraft,
    type BreakdownDraft,
} from "@/lib/incomeBreakdown";
import { createProfileTrace } from "@/lib/observability/profileTrace";
import { EntrySchema, IncomeBreakdownSchema, type IncomeCategory, type PaymentMethod, } from "@shared/schemas/entry";
import { EntryFormVisibility, resolveEntryFormVisibility, } from "@shared/entryVisibility";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import * as entriesService from "@/lib/domain/entriesService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingsDocSchema } from "@shared/schemas/settings";
import { debugLog, debugRender } from "@/lib/debugLoop";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore";
function enforceHHMM(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 1)
        return digits;
    if (digits.length === 2)
        return digits;
    if (digits.length === 3)
        return `${digits[0]}:${digits.slice(1, 3)}`;
    if (digits.length >= 4)
        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    return "";
}
export default function EntryForm() {
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const selectedPeriod = useSelectedPeriod(activeWorkspaceId);
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const settings = settingsEntry?.data ?? null;
    const visibility = useMemo<EntryFormVisibility | null>(() => {
        if (!settings || !activeWorkspace)
            return null;
        return resolveEntryFormVisibility(settings, activeWorkspace.type);
    }, [settings, activeWorkspace]);
    const initialNowIso = new Date().toISOString();
    const today = getLocalDateInputValue();
    /** ------------------------------------------------
     * RAW input-only form state
     * ------------------------------------------------ */
    // CHANGE: extended form state to include independent-only fields (independentHours, venmo, appleCash, posSales, cashSales, customIncome)
    const [form, setForm] = useState({
        date: today,
        // W2 earnings
        tips: "",
        reportedCash: "",
        unreportedCash: "",
        // W2 hours/manual
        hours: "",
        rate: settings?.w2?.defaultHourlyRate?.toString() ?? "",
        // W2 in/out mode
        inTime: "",
        inPeriod: "AM",
        outTime: "",
        outPeriod: "PM",
        // W2 deductions
        breakDeduction: settings?.w2?.autoBreakDeduction ?? false,
        breakMinutes: settings?.w2?.breakMinutesDefault ?? 30,
        appliedCustomDeductions: settings?.w2?.customDeductions
            ? settings.w2?.customDeductions.map((d: {
                label: string;
                amount: number;
            }) => d.label)
            : [],
        // independent-only fields
        independentHours: "",
        venmo: "",
        appleCash: "",
        zelle: "",
        posSales: "",
        cashSales: "",
        paymentBreakdowns: {
            venmo: emptyBreakdownDraft(),
            appleCash: emptyBreakdownDraft(),
            zelle: emptyBreakdownDraft(),
            posSales: emptyBreakdownDraft(),
            cashSales: emptyBreakdownDraft(),
        },
        customIncome: [] as {
            label: string;
            amount: number;
            category: IncomeCategory;
        }[],
        // notes
        notes: "",
        // Added timestamps back into INITIAL state
        // (per user request)
        createdAtLocal: initialNowIso,
        updatedAtLocal: initialNowIso,
    });
    /** keep form defaults aligned with settings changes */
    useEffect(() => {
        if (!settings)
            return;
        debugLog("entry-form", "sync_defaults_from_settings", {
            workspaceId: activeWorkspaceId,
            workspaceType: activeWorkspace?.type ?? null,
        });
        setForm((prev) => ({
            ...prev,
            rate: settings.w2?.defaultHourlyRate?.toString() ?? prev.rate,
            breakDeduction: settings.w2?.autoBreakDeduction ?? prev.breakDeduction,
            breakMinutes: settings.w2?.breakMinutesDefault ?? prev.breakMinutes,
        }));
    }, [settings]);
    /** keep the entry date inside the viewed (possibly past) period's bounds */
    useEffect(() => {
        if (!selectedPeriod)
            return;
        setForm((prev) => ({
            ...prev,
            date: prev.date < selectedPeriod.start || prev.date > selectedPeriod.end
                ? selectedPeriod.end
                : prev.date,
        }));
    }, [selectedPeriod]);
    /** UI-only total — allowed */
    const total = useMemo(() => {
        const t = Number(form.tips || 0);
        const rc = Number(form.reportedCash || 0);
        const uc = Number(form.unreportedCash || 0);
        return t + rc + uc;
    }, [form]);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const submitTraceRef = useRef<ReturnType<typeof createProfileTrace> | null>(null);
    debugRender("entry-form", {
        workspaceId: activeWorkspaceId,
        workspaceType: activeWorkspace?.type ?? null,
        hasSettings: settings !== null,
        visibilityMode: visibility?.mode ?? null,
        expanded,
        submitting,
    });
    const updateCategorizedPaymentAmount = useCallback((field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales", value: string) => {
        const config = paymentCategoryConfig[field];
        setForm((prev) => {
            const previousDraft = prev.paymentBreakdowns[field];
            const nextDraft = parseMoney(value) <= 0
                ? emptyBreakdownDraft()
                : previousDraft.selected.length === 0
                    ? {
                        ...emptyBreakdownDraft(),
                        selected: [config.defaultCategory],
                        [config.defaultCategory]: value,
                    }
                    : rebalanceBreakdownDraft(previousDraft, parseMoney(value), config.categories);
            return {
                ...prev,
                [field]: value,
                paymentBreakdowns: {
                    ...prev.paymentBreakdowns,
                    [field]: nextDraft,
                },
            };
        });
    }, []);
    const toggleBreakdownCategory = useCallback((field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales", category: IncomeCategory, checked: boolean) => {
        setForm((prev) => {
            const draft = prev.paymentBreakdowns[field];
            const selected = checked
                ? [...draft.selected, category]
                : draft.selected.filter((item) => item !== category);
            const nextDraft = rebalanceBreakdownDraft({
                ...draft,
                selected,
                [category]: checked ? draft[category] : "",
            }, parseMoney(prev[field]), paymentCategoryConfig[field].categories, checked ? category : undefined);
            return {
                ...prev,
                paymentBreakdowns: {
                    ...prev.paymentBreakdowns,
                    [field]: nextDraft,
                },
            };
        });
    }, []);
    const updateBreakdownAmount = useCallback((field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales", category: IncomeCategory, value: string) => {
        setForm((prev) => {
            const total = parseMoney(prev[field]);
            const draft = prev.paymentBreakdowns[field];
            const nextDraft = rebalanceBreakdownDraft({
                ...draft,
                [category]: value,
            }, total, paymentCategoryConfig[field].categories, category);
            return {
                ...prev,
                paymentBreakdowns: {
                    ...prev.paymentBreakdowns,
                    [field]: nextDraft,
                },
            };
        });
    }, []);
    const renderPaymentBreakdownFields = (field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales") => {
        const config = paymentCategoryConfig[field];
        const total = parseMoney(form[field]);
        const draft = form.paymentBreakdowns[field];
        if (total <= 0)
            return null;
        return (<div className="mt-3 space-y-3 rounded-md border bg-secondary/80 p-3">
        <div className="text-sm font-medium">
          Split {config.label} into categories
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {config.categories.map((category) => (<label key={`${field}-${category}`} className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.selected.includes(category)} onCheckedChange={(checked) => toggleBreakdownCategory(field, category, checked === true)}/>
              <span>{categoryLabels[category]}</span>
            </label>))}
        </div>

        {draft.selected.length > 0 && (<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {config.categories
                    .filter((category) => draft.selected.includes(category))
                    .map((category) => (<div key={`${field}-${category}-amount`}>
                  <Label htmlFor={`${field}-${category}`}>
                    {categoryLabels[category]} Amount
                  </Label>
                  <Input id={`${field}-${category}`} type="number" step="0.01" value={draft[category]} onChange={(e) => updateBreakdownAmount(field, category, e.target.value)}/>
                </div>))}
          </div>)}

        <p className="text-xs text-muted-foreground">
          Category split: {formatCurrency(draftSum(draft))} of {formatCurrency(total)}
        </p>
      </div>);
    };
    /** ------------------------------------------------
     * SUBMISSION HANDLER
     * ------------------------------------------------ */
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !settings || !visibility || !activeWorkspace)
            return;
        submitTraceRef.current = createProfileTrace("entry_create", {
            workspaceId: activeWorkspaceId ?? "unknown",
            workspaceType: activeWorkspace.type,
        });
        submitTraceRef.current.mark("entry_create.tap");
        setSubmitting(true);
        setSuccess(false);
        try {
            const parseNum = (v: string) => v === "" || v == null ? undefined : Number(v);
            let hours: number | undefined;
            let rate: number | undefined;
            if (visibility.mode === "w2" && visibility.showHoursSection) {
                rate = parseNum(form.rate);
                if (rate === undefined) {
                    alert("Hourly rate is required.");
                    setSubmitting(false);
                    return;
                }
                if (visibility.showHoursManual) {
                    hours = parseNum(form.hours);
                    if (hours === undefined) {
                        alert("Hours are required.");
                        setSubmitting(false);
                        return;
                    }
                }
                if (visibility.showInOutTimes) {
                    if (!form.inTime || !form.outTime) {
                        alert("In and Out times are required.");
                        setSubmitting(false);
                        return;
                    }
                }
            }
            // Insert timestamp generation (per user request)
            const nowIso = new Date().toISOString();
            // Historical break deduction amount
            const breakDeductionAmount = form.breakDeduction && visibility.mode === "w2" && visibility.showBreakDeduction
                ? (() => {
                    const minutes = form.breakMinutes ?? 0;
                    const r = parseNum(form.rate) ?? 0;
                    return (minutes / 60) * r;
                })()
                : 0;
            // Convert labels → full objects
            const appliedCustomDeductions = settings.w2?.customDeductions
                ?.filter((d: {
                label: string;
                amount: number;
            }) => form.appliedCustomDeductions.includes(d.label))
                .map((d: {
                label: string;
                amount: number;
            }) => ({ label: d.label, amount: d.amount })) ?? [];
            // CHANGE: build workspace-aware nested payload (root fields + w2/independent blocks) for EntrySchema
            const payload: any = {
                workspace: activeWorkspace.type,
                date: form.date,
                notes: form.notes.trim(),
                createdAtLocal: nowIso,
                updatedAtLocal: nowIso,
            };
            // W2 block (continues to use W-2 visibility flags)
            if (activeWorkspace.type === "w2") {
                payload.w2 = {
                    tips: parseNum(form.tips) ?? 0,
                    reportedCash: parseNum(form.reportedCash) ?? 0,
                    unreportedCash: parseNum(form.unreportedCash) ?? 0,
                    breakDeduction: form.breakDeduction,
                    breakMinutes: form.breakMinutes,
                    appliedCustomDeductions,
                    ...(visibility.mode === "w2" && visibility.showHoursManual && { hours }),
                    ...(visibility.mode === "w2" && visibility.showRate && { rate }),
                    ...(visibility.mode === "w2" && visibility.showInOutTimes && {
                        inTime: `${form.inTime} ${form.inPeriod}`,
                        outTime: `${form.outTime} ${form.outPeriod}`,
                    }),
                };
            }
            // Independent block (uses new Independent visibility flags)
            if (activeWorkspace.type === "independent") {
                const incomeBreakdowns: Array<{
                    paymentMethod: PaymentMethod;
                    services?: number;
                    tips?: number;
                    products?: number;
                    other?: number;
                }> = [];
                const buildCategorizedBreakdown = (field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales") => {
                    const total = parseNum(form[field]) ?? 0;
                    if (total <= 0)
                        return;
                    const config = paymentCategoryConfig[field];
                    const draft = form.paymentBreakdowns[field];
                    const selectedCategories = draft.selected.filter((category) => config.categories.includes(category));
                    if (selectedCategories.length === 0) {
                        throw new Error(`Select at least one ${config.label} income category.`);
                    }
                    const breakdownCandidate = {
                        paymentMethod: config.paymentMethod,
                        services: selectedCategories.includes("services")
                            ? parseMoney(draft.services)
                            : undefined,
                        tips: selectedCategories.includes("tips")
                            ? parseMoney(draft.tips)
                            : undefined,
                        products: selectedCategories.includes("products")
                            ? parseMoney(draft.products)
                            : undefined,
                        other: selectedCategories.includes("other")
                            ? parseMoney(draft.other)
                            : undefined,
                    };
                    const parsedBreakdown = IncomeBreakdownSchema.safeParse(breakdownCandidate);
                    if (!parsedBreakdown.success) {
                        throw new Error(parsedBreakdown.error.issues[0]?.message ?? `Invalid ${config.label} breakdown.`);
                    }
                    const sum = draftSum(draft);
                    if (Math.abs(sum - total) > 0.009) {
                        throw new Error(`${config.label} category amounts must add up to ${formatCurrency(total)}.`);
                    }
                    incomeBreakdowns.push(parsedBreakdown.data);
                };
                buildCategorizedBreakdown("venmo");
                buildCategorizedBreakdown("appleCash");
                buildCategorizedBreakdown("zelle");
                buildCategorizedBreakdown("posSales");
                buildCategorizedBreakdown("cashSales");
                const creditCardTips = parseNum(form.tips) ?? 0;
                const reportedCashTips = parseNum(form.reportedCash) ?? 0;
                const unreportedCashTips = parseNum(form.unreportedCash) ?? 0;
                if (creditCardTips > 0) {
                    incomeBreakdowns.push({
                        paymentMethod: "card",
                        tips: creditCardTips,
                    });
                }
                if (reportedCashTips > 0) {
                    incomeBreakdowns.push({
                        paymentMethod: "cash",
                        tips: reportedCashTips,
                    });
                }
                for (const item of form.customIncome ?? []) {
                    if (!item || Number(item.amount ?? 0) <= 0)
                        continue;
                    incomeBreakdowns.push({
                        paymentMethod: "other",
                        [item.category]: Number(item.amount ?? 0),
                    });
                }
                payload.independent = {
                    hours: parseNum(form.independentHours) ?? 0,
                    incomeBreakdowns,
                    unreportedCash: unreportedCashTips,
                    unreportedCashTips,
                    customIncome: form.customIncome ?? [],
                };
            }
            // ---------------------------------------------------------
            // ZOD VALIDATION — Entire Entry (FullEntrySchema)
            // ---------------------------------------------------------
            submitTraceRef.current.start("entry_create.validation");
            const parseResult = EntrySchema.safeParse(payload);
            if (!parseResult.success) {
                submitTraceRef.current.error("entry_create.validation", parseResult.error);
                // Extract first readable error message (if any)
                const firstError = parseResult.error.issues[0]?.message ??
                    "Some required fields are missing or invalid.";
                alert(firstError);
                setSubmitting(false);
                return;
            }
            submitTraceRef.current.end("entry_create.validation");
            if (!activeWorkspaceId) {
                throw new Error("No active workspace selected");
            }
            await entriesService.createEntry(activeWorkspaceId, parseResult.data, {
                trace: submitTraceRef.current
                    ? {
                        traceId: submitTraceRef.current.traceId,
                        flow: submitTraceRef.current.flow,
                    }
                    : null,
            });
            setSuccess(true);
            submitTraceRef.current.mark("entry_create.ui_success");
            /** Reset raw form fields */
            const resetNowIso = new Date().toISOString();
            // CHANGE: reset independent-only fields along with W2 fields
            setForm({
                ...form,
                date: getLocalDateInputValue(),
                tips: "",
                reportedCash: "",
                unreportedCash: "",
                hours: "",
                inTime: "",
                inPeriod: form.inPeriod,
                outTime: "",
                outPeriod: form.outPeriod,
                rate: settings.w2?.defaultHourlyRate?.toString() ?? "",
                notes: "",
                appliedCustomDeductions: settings.w2?.customDeductions
                    ? settings.w2?.customDeductions.map((d: {
                        label: string;
                        amount: number;
                    }) => d.label)
                    : [],
                independentHours: "",
                venmo: "",
                appleCash: "",
                zelle: "",
                posSales: "",
                cashSales: "",
                paymentBreakdowns: {
                    venmo: emptyBreakdownDraft(),
                    appleCash: emptyBreakdownDraft(),
                    zelle: emptyBreakdownDraft(),
                    posSales: emptyBreakdownDraft(),
                    cashSales: emptyBreakdownDraft(),
                },
                customIncome: [],
                // Add timestamps into RESET state (per user request)
                createdAtLocal: resetNowIso,
                updatedAtLocal: resetNowIso,
            });
            setExpanded(false);
            submitTraceRef.current.mark("entry_create.form_reset");
        }
        catch (error) {
            submitTraceRef.current?.error("entry_create.failed", error);
            alert(error instanceof Error
                ? error.message
                : "Failed to save entry. Please try again.");
        }
        finally {
            submitTraceRef.current?.mark("entry_create.complete");
            setSubmitting(false);
        }
    }, [form, submitting, visibility, settings, activeWorkspace, activeWorkspaceId]);
    /** ------------------------------------------------
     * FORM UI
     * ------------------------------------------------ */
    if (workspaceState.status !== "ready" || !activeWorkspaceId || !activeWorkspace) {
        return (<div className="p-4 text-center text-muted-foreground">
        Loading workspace…
      </div>);
    }
    if (!settings || !visibility) {
        return (<div className="p-4 text-center text-muted-foreground">
        Loading settings…
      </div>);
    }
    return (<Card className={`relative overflow-hidden ${expanded ? "gap-6 py-6" : "gap-0 py-4"}`}>
      <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${expanded ? "" : "px-5"}`}>
        <div className="flex items-center gap-2">
          <CardTitle>Add Entry</CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Entry form help">
                <Info className="h-4 w-4"/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm">
              Tap the plus button to expand and add a new entry.
            </PopoverContent>
          </Popover>
        </div>

        <Button type="button" variant="outline" size="icon" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Collapse entry form" : "Expand entry form"} disabled={submitting}>
          {expanded ? <Minus /> : <Plus />}
        </Button>
      </CardHeader>

      {!expanded ? (<CardContent className="px-5 pt-0 pb-0"/>) : (<CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitting ? (<p className="text-sm text-muted-foreground">
              Adding your entry and syncing in the background...
            </p>) : null}

          {/* Date */}
          <div>
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              data-stackin-date-input="true"
              className="w-full min-w-0"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              min={selectedPeriod?.start}
              max={selectedPeriod?.end}
              required
            />
          </div>

          {/* W-2 Tips */}
          {/* W-2 UI continues to use legacy visibility flags */}
          {visibility?.mode === "w2" && (<>
          {visibility?.showTips && (<div>
              <Label htmlFor="tips">Credit Card Tips</Label>
              <Input id="tips" type="number" step="0.01" value={form.tips} onChange={(e) => setForm({ ...form, tips: e.target.value })}/>
            </div>)}

          {/* W-2 Hours Section */}
          {visibility?.showHoursSection && (<>
              {visibility.showHoursManual && (<div>
                  <Label htmlFor="hours">Hours Worked</Label>
                  <Input id="hours" type="number" step="0.01" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} required/>
                </div>)}

              {visibility.showInOutTimes && (<div className="space-y-2">
                  <Label>In/Out Times</Label>
                  <div className="flex space-x-4">
                    <div>
                      <Input placeholder="HH:MM" inputMode="numeric" value={form.inTime} onChange={(e) => setForm({
                            ...form,
                            inTime: enforceHHMM(e.target.value),
                        })} className="w-24 text-center" required/>
                      <select value={form.inPeriod} onChange={(e) => setForm({ ...form, inPeriod: e.target.value })} className="ml-2 rounded border border-border bg-secondary px-2 py-1">
                        <option>AM</option>
                        <option>PM</option>
                      </select>
                    </div>

                    <div>
                      <Input placeholder="HH:MM" inputMode="numeric" value={form.outTime} onChange={(e) => setForm({
                            ...form,
                            outTime: enforceHHMM(e.target.value),
                        })} className="w-24 text-center" required/>
                      <select value={form.outPeriod} onChange={(e) => setForm({ ...form, outPeriod: e.target.value })} className="ml-2 rounded border border-border bg-secondary px-2 py-1">
                        <option>AM</option>
                        <option>PM</option>
                      </select>
                    </div>
                  </div>
                </div>)}

              {visibility.showRate && (<div>
                  <Label htmlFor="rate">Hourly Rate</Label>
                  <Input id="rate" type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required/>
                </div>)}
            </>)}

          {/* W-2 Cash + Deductions */}
          {visibility?.showReportedCash && (<div>
              <Label htmlFor="reportedCash">Reported Cash</Label>
              <Input id="reportedCash" type="number" step="0.01" value={form.reportedCash} onChange={(e) => setForm({ ...form, reportedCash: e.target.value })}/>
            </div>)}

          {visibility?.showUnreportedCash && (<div>
              <Label htmlFor="unreportedCash">Unreported Cash</Label>
              <Input id="unreportedCash" type="number" step="0.01" value={form.unreportedCash} onChange={(e) => setForm({ ...form, unreportedCash: e.target.value })}/>
            </div>)}

          {visibility?.showBreakDeduction && settings.w2?.autoBreakDeduction && (<>
              <div className="flex items-center space-x-2">
                <Checkbox id="breakDeduction" checked={form.breakDeduction} onCheckedChange={(checked) => setForm({
                        ...form,
                        breakDeduction: checked as boolean,
                        breakMinutes: checked
                            ? settings.w2?.breakMinutesDefault ?? 30
                            : 0,
                    })}/>
                <Label htmlFor="breakDeduction">
                  Break Deduction ({settings.w2?.breakMinutesDefault ?? 30} min)
                </Label>
              </div>
            </>)}

          {visibility?.showCustomDeductions && (<div className="space-y-2 pt-2">
              {(settings.w2?.customDeductions ?? []).map((d: {
                        label: string;
                        amount: number;
                    }) => {
                        const checked = form.appliedCustomDeductions.includes(d.label);
                        return (<div key={d.label} className="flex items-center space-x-2">
                    <Checkbox id={`custom-${d.label}`} checked={checked} onCheckedChange={(c) => {
                                setForm((prev) => {
                                    const next = new Set(prev.appliedCustomDeductions);
                                    if (c)
                                        next.add(d.label);
                                    else
                                        next.delete(d.label);
                                    return {
                                        ...prev,
                                        appliedCustomDeductions: [...next],
                                    };
                                });
                            }}/>
                    <Label htmlFor={`custom-${d.label}`}>{d.label}</Label>
                  </div>);
                    })}
            </div>)}  </>)}


          {/* Independent Section */}
          {/* CHANGE: Independent UI is now driven by visibility.mode === "independent"
                and uses the new independent visibility flags. */}
          {visibility?.mode === "independent" && (<>
              {/* Independent Hours */}
              {visibility.showHours && (<div>
                  <Label htmlFor="independentHours">Hours Worked</Label>
                  <Input id="independentHours" type="number" step="0.1" value={form.independentHours} onChange={(e) => setForm({ ...form, independentHours: e.target.value })}/>
                </div>)}

              {visibility.showIndependentTips && (<div>
                  <Label htmlFor="independentTips">Credit Card Tips</Label>
                  <Input id="independentTips" type="number" step="0.01" value={form.tips} onChange={(e) => setForm({ ...form, tips: e.target.value })}/>
                </div>)}

              {visibility.showIndependentReportedCash && (<div>
                  <Label htmlFor="independentReportedCash">Reported Cash</Label>
                  <Input id="independentReportedCash" type="number" step="0.01" value={form.reportedCash} onChange={(e) => setForm({ ...form, reportedCash: e.target.value })}/>
                </div>)}

              {visibility.showIndependentUnreportedCash && (<div>
                  <Label htmlFor="independentUnreportedCash">Unreported Cash</Label>
                  <Input id="independentUnreportedCash" type="number" step="0.01" value={form.unreportedCash} onChange={(e) => setForm({ ...form, unreportedCash: e.target.value })}/>
                </div>)}

              {/* Venmo */}
              {visibility.showVenmo && (<div>
                  <Label htmlFor="venmo">Venmo</Label>
                  <Input id="venmo" type="number" step="0.01" value={form.venmo} onChange={(e) => updateCategorizedPaymentAmount("venmo", e.target.value)}/>
                  {renderPaymentBreakdownFields("venmo")}
                </div>)}

              {/* Apple Pay */}
              {visibility.showAppleCash && (<div>
                  <Label htmlFor="appleCash">Apple Pay</Label>
                  <Input id="appleCash" type="number" step="0.01" value={form.appleCash} onChange={(e) => updateCategorizedPaymentAmount("appleCash", e.target.value)}/>
                  {renderPaymentBreakdownFields("appleCash")}
                </div>)}

              {visibility.showZelle && (<div>
                  <Label htmlFor="zelle">Zelle</Label>
                  <Input id="zelle" type="number" step="0.01" value={form.zelle} onChange={(e) => updateCategorizedPaymentAmount("zelle", e.target.value)}/>
                  {renderPaymentBreakdownFields("zelle")}
                </div>)}

              {/* POS Sales */}
              {visibility.showPosSales && (<div>
                  <Label htmlFor="posSales">POS Sales</Label>
                  <Input id="posSales" type="number" step="0.01" value={form.posSales} onChange={(e) => updateCategorizedPaymentAmount("posSales", e.target.value)}/>
                  {renderPaymentBreakdownFields("posSales")}
                </div>)}

              {visibility.showCashSales && (<div>
                  <Label htmlFor="cashSales">Cash Sales</Label>
                  <Input id="cashSales" type="number" step="0.01" value={form.cashSales} onChange={(e) => updateCategorizedPaymentAmount("cashSales", e.target.value)}/>
                  {renderPaymentBreakdownFields("cashSales")}
                </div>)}

              {/* Independent Custom Income Repeater */}
              {visibility.showCustomIncome && (<div className="space-y-2">
                  <Label>Custom Income</Label>
                  {(form.customIncome ?? []).map((item, idx) => (<div key={idx} className="flex gap-2">
                      <Input placeholder="Label" value={item.label} onChange={(e) => {
                            const next = [...form.customIncome];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setForm({ ...form, customIncome: next });
                        }}/>
                      <Input placeholder="Amount" type="number" step="0.01" value={item.amount} onChange={(e) => {
                            const next = [...form.customIncome];
                            next[idx] = {
                                ...next[idx],
                                amount: Number(e.target.value),
                            };
                            setForm({ ...form, customIncome: next });
                        }}/>
                      <select value={item.category} onChange={(e) => {
                            const next = [...form.customIncome];
                            next[idx] = {
                                ...next[idx],
                                category: e.target.value as IncomeCategory,
                            };
                            setForm({ ...form, customIncome: next });
                        }} className="rounded border border-border bg-secondary px-2 py-1 text-sm">
                        <option value="services">Services</option>
                        <option value="tips">Tips</option>
                        <option value="products">Products</option>
                        <option value="other">Other</option>
                      </select>
                    </div>))}
                  <Button type="button" onClick={() => setForm({
                        ...form,
                        customIncome: [
                            ...(form.customIncome ?? []),
                            { label: "", amount: 0, category: "other" },
                        ],
                    })}>
                    Add Custom Income
                  </Button>
                </div>)}
            </>)}

          {visibility?.showNotes && (<div>
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" type="text"/>
            </div>)}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving..." : "Add Entry"}
          </Button>
        </form>
      </CardContent>)}
    </Card>);
}
