// /components/entry-form.tsx
"use client";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Plus, Minus, X } from "lucide-react";
import { debounce } from "@/lib/timing";
import { formatCurrency, getLocalDateInputValue } from "@/lib/helpers";
import {
    categoryLabels,
    draftSum,
    emptyBreakdownDraft,
    parseMoney,
    getSplitCategories,
    paymentCategoryConfig,
    rebalanceBreakdownDraft,
    type BreakdownDraft,
} from "@/lib/incomeBreakdown";
import { createProfileTrace } from "@/lib/observability/profileTrace";
import { EntrySchema, IncomeBreakdownSchema, type IncomeCategory, type PaymentMethod, } from "@shared/schemas/entry";
import { EntryFormVisibility, resolveEntryFormVisibility, } from "@shared/entryVisibility";
import { getCurrentEntryPeriod } from "@shared/payPeriods";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import * as entriesService from "@/lib/domain/entriesService";
import * as recurringRulesService from "@/lib/domain/recurringRulesService";
import { RecurringCadenceFields } from "@/components/recurring-cadence-picker";
import IncomeNameInput from "@/components/income-name-input";
import { canonicalIncomeName, getSavedIncomeNames, saveNewIncomeNames } from "@/lib/incomeNames";
import type { RecurringCadence, RecurringIncomeSource } from "@shared/schemas/recurringRule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsDocSchema } from "@shared/schemas/settings";
import { debugLog, debugRender } from "@/lib/debugLoop";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore";
import { CUSTOM_POSITION_ID, CUSTOM_POSITION_TITLE, getRateOptions } from "@shared/hourlyRates";
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
/** Last-used in/out AM/PM selections, remembered per device (not per
 * workspace) so a regular PM→PM or AM→PM shift doesn't need re-selecting
 * every time the form mounts, across app restarts and workspace switches. */
const TIME_PERIODS_STORAGE_KEY = "trackd:entry-form:time-periods";
type TimePeriod = "AM" | "PM";
const isTimePeriod = (value: unknown): value is TimePeriod => value === "AM" || value === "PM";
function readStoredTimePeriods(): { inPeriod?: TimePeriod; outPeriod?: TimePeriod } {
    try {
        const raw = window.localStorage.getItem(TIME_PERIODS_STORAGE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        return {
            ...(isTimePeriod(parsed?.inPeriod) && { inPeriod: parsed.inPeriod }),
            ...(isTimePeriod(parsed?.outPeriod) && { outPeriod: parsed.outPeriod }),
        };
    }
    catch {
        return {};
    }
}
function writeStoredTimePeriods(inPeriod: string, outPeriod: string) {
    try {
        window.localStorage.setItem(TIME_PERIODS_STORAGE_KEY, JSON.stringify({ inPeriod, outPeriod }));
    }
    catch {
        // storage unavailable — non-fatal, selection just won't persist
    }
}
/** Rate + position for a picked position id (null = default). Hand-typed
 * ("custom") rates are kept as-is; an id that no longer exists in settings
 * (position deleted) falls back to the default rate. */
function resolvePositionRate(settings: Parameters<typeof getRateOptions>[0], positionId: string | null, currentRate: string): {
    positionId: string | null;
    rate: string;
} {
    if (positionId === CUSTOM_POSITION_ID)
        return { positionId, rate: currentRate };
    const options = getRateOptions(settings);
    const option = options.find((o) => o.id === positionId) ?? options[0];
    if (option.id === null)
        return { positionId: null, rate: settings?.w2?.defaultHourlyRate?.toString() ?? currentRate };
    return { positionId: option.id, rate: option.rate.toString() };
}
// W-2 fields: one soft row each, label left and value right.
const W2_ROW = "flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-1.5";
const W2_LABEL = "shrink-0 text-sm font-normal text-muted-foreground";
const W2_INPUT = "h-9 w-32 border-0 bg-transparent px-0 text-right text-base font-medium tabular-nums shadow-none focus-visible:ring-0";
/** Width for a big amount input so the "$" sits right beside the number. */
function amountWidth(value: string | undefined): string {
    // Empty shows the "0.00" placeholder, which needs four characters.
    return `${(value ?? "").length || 4}ch`;
}
const PAYMENT_REPEAT_FIELDS = ["venmo", "appleCash", "zelle", "posSales", "cashSales"] as const;
type PaymentField = (typeof PAYMENT_REPEAT_FIELDS)[number];
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
    // "Receives Tips": a Tips line on every income source — inside the split
    // for Venmo/Apple Pay/Zelle, on top of sales for POS and Cash.
    const tipsEnabled = visibility?.mode === "independent" && visibility.showSourceTips;
    // Read by the memoized breakdown handlers below without re-creating them.
    const tipsEnabledRef = useRef(tipsEnabled);
    tipsEnabledRef.current = tipsEnabled;
    /** selectedPeriod is null while viewing the default "Current" period (see
     * usePeriodSelectionStore) — the date input's min/max must still be
     * bounded in that case, or nothing stops the user from typing a date
     * that lands in a different period than the one on screen. Such an
     * entry still saves fine (backend + cache both get it correctly scoped
     * to its own period), but useEntriesStore's applyEntryMutation
     * intentionally won't touch the currently-loaded period's in-memory
     * list for a foreign periodId, so the visible grid/gauge silently
     * doesn't reflect it until the user actually navigates to that period. */
    const rateOptions = useMemo(() => getRateOptions(settings), [settings]);
    const currentEntryPeriodBounds = useMemo(() => {
        if (!settings || !activeWorkspace)
            return null;
        return getCurrentEntryPeriod(settings, activeWorkspace.type);
    }, [settings, activeWorkspace]);
    const dateInputBounds = selectedPeriod ?? currentEntryPeriodBounds;
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
        // null = default rate, CUSTOM_POSITION_ID = hand-typed, else additionalRates id
        positionId: null as string | null,
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
        // Tips entered ON TOP of POS / cash sales (paymentCategoryConfig's
        // "salesPlusTips" style) — never taken out of the sales amount.
        posTips: "",
        cashTips: "",
        paymentBreakdowns: {
            venmo: emptyBreakdownDraft(),
            appleCash: emptyBreakdownDraft(),
            zelle: emptyBreakdownDraft(),
            posSales: emptyBreakdownDraft(),
            cashSales: emptyBreakdownDraft(),
        },
        customIncome: [] as {
            label: string;
            amount: string;
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
            // Re-resolve against the (possibly edited) settings instead of
            // always snapping back to the default: a background settings
            // refresh must not clobber a picked position or a typed rate.
            ...resolvePositionRate(settings, prev.positionId, prev.rate),
            breakDeduction: settings.w2?.autoBreakDeduction ?? prev.breakDeduction,
            breakMinutes: settings.w2?.breakMinutesDefault ?? prev.breakMinutes,
        }));
    }, [settings]);
    /** restore last-used AM/PM selections after mount (not in the useState
     * initializer, so the prerendered markup and first client render match).
     * Saving happens only in the selects' onChange — an effect keyed on the
     * form values would fire on the first commit with the AM/PM defaults
     * and overwrite the stored choice before this restore lands. */
    useEffect(() => {
        const stored = readStoredTimePeriods();
        if (stored.inPeriod || stored.outPeriod)
            setForm((prev) => ({ ...prev, ...stored }));
    }, []);
    /** keep the entry date inside the viewed (possibly past) period's bounds.
     * selectedPeriod is null when the period selector is back on "current" —
     * that's not "no period", it means today's period, so the date should
     * reset to today rather than being left at whatever past period's date
     * was still sitting in the form. */
    useEffect(() => {
        if (!selectedPeriod) {
            setForm((prev) => (prev.date === today ? prev : { ...prev, date: today }));
            return;
        }
        setForm((prev) => ({
            ...prev,
            date: prev.date < selectedPeriod.start || prev.date > selectedPeriod.end
                ? selectedPeriod.end
                : prev.date,
        }));
    }, [selectedPeriod, today]);
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
    // Which single income source (if any) is marked recurring. A recurring
    // rule can only carry one number with one category, so only one field's
    // Repeats switch can be on at a time — see isFieldRecurringEligible below.
    const [repeatSourceField, setRepeatSourceField] = useState<RecurringIncomeSource | null>(null);
    const [repeatCadence, setRepeatCadence] = useState<RecurringCadence>({ freq: "monthly" });
    const [repeatEndDate, setRepeatEndDate] = useState("");
    const submitTraceRef = useRef<ReturnType<typeof createProfileTrace> | null>(null);
    // Only the payment field being worked on shows its full category split;
    // the rest collapse to a one-line summary so the form stays readable.
    const [openBreakdownField, setOpenBreakdownField] = useState<PaymentField | null>(null);
    // Display only: the payment sources tapped open from the "How were you
    // paid?" chips. A source with an amount always shows, opened or not, so
    // nothing typed can end up hidden.
    const [openSources, setOpenSources] = useState<ReadonlySet<PaymentField | "personalCash">>(() => new Set());
    const openSource = useCallback((source: PaymentField | "personalCash") => {
        setOpenSources((prev) => new Set(prev).add(source));
        const inputId = source === "personalCash" ? "independentUnreportedCash" : source;
        window.setTimeout(() => document.getElementById(inputId)?.focus(), 0);
    }, []);
    const closeSource = useCallback((source: PaymentField | "personalCash") => {
        setOpenSources((prev) => {
            const next = new Set(prev);
            next.delete(source);
            return next;
        });
    }, []);
    useEffect(() => {
        if (!openBreakdownField)
            return;
        // pointerdown as well as focusin: iOS WebKit doesn't focus buttons
        // (the category checkboxes) on tap, so focus alone can't tell a tap
        // inside the panel from one outside it.
        const collapseIfOutside = (event: Event) => {
            const target = event.target as Element | null;
            if (target?.closest?.(`[data-breakdown-field="${openBreakdownField}"]`))
                return;
            setOpenBreakdownField(null);
        };
        document.addEventListener("pointerdown", collapseIfOutside);
        document.addEventListener("focusin", collapseIfOutside);
        return () => {
            document.removeEventListener("pointerdown", collapseIfOutside);
            document.removeEventListener("focusin", collapseIfOutside);
        };
    }, [openBreakdownField]);
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
                    : rebalanceBreakdownDraft(previousDraft, parseMoney(value), getSplitCategories(field, tipsEnabledRef.current));
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
            }, parseMoney(prev[field]), getSplitCategories(field, tipsEnabledRef.current), checked ? category : undefined);
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
            }, total, getSplitCategories(field, tipsEnabledRef.current), category);
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
        const splitCategories = getSplitCategories(field, tipsEnabled);
        const total = parseMoney(form[field]);
        const draft = form.paymentBreakdowns[field];
        if (total <= 0)
            return null;
        if (openBreakdownField !== field) {
            const summary = draft.selected
                .map((category) => `${categoryLabels[category]} ${formatCurrency(parseMoney(draft[category]))}`)
                .join(" · ");
            return (<button type="button" onClick={() => setOpenBreakdownField(field)} className="mt-2 flex w-full items-center justify-between gap-2 text-left text-xs text-muted-foreground">
          <span className="truncate">{summary || "No categories selected"}</span>
          <span className="shrink-0 font-medium text-primary">Edit split</span>
        </button>);
        }
        const splitMatches = Math.abs(draftSum(draft) - total) <= 0.009;
        return (<div className="mt-3 space-y-3 border-t border-border/70 pt-3">
        <div className="text-xs font-medium text-muted-foreground">
          What was the {config.entryStyle === "salesPlusTips" ? `${config.label.replace(/ Sales$/, "").toLowerCase()} sales` : config.label} for?
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label={`${config.label} categories`}>
          {splitCategories.map((category) => {
                const selected = draft.selected.includes(category);
                return (<button key={`${field}-${category}`} type="button" aria-pressed={selected} onClick={() => toggleBreakdownCategory(field, category, !selected)} className={`rounded-full px-3 py-1.5 text-sm transition-colors ${selected ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-secondary"}`}>
                {categoryLabels[category]}
              </button>);
            })}
        </div>

        {draft.selected.length > 1 && (<div className="space-y-1.5">
            {splitCategories
                    .filter((category) => draft.selected.includes(category))
                    .map((category) => (<div key={`${field}-${category}-amount`} className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-1.5">
                  <Label htmlFor={`${field}-${category}`} className="text-sm font-normal">
                    {categoryLabels[category]}
                  </Label>
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-sm text-muted-foreground">$</span>
                    <input id={`${field}-${category}`} type="number" step="0.01" inputMode="decimal" placeholder="0.00" style={{ width: amountWidth(draft[category]) }} value={draft[category]} onChange={(e) => updateBreakdownAmount(field, category, e.target.value)} className="max-w-28 bg-transparent text-right text-base tabular-nums outline-none placeholder:text-muted-foreground/50"/>
                  </div>
                </div>))}
          </div>)}

        {draft.selected.length > 1 ? (<p className={`text-xs tabular-nums ${splitMatches ? "text-muted-foreground" : "text-amber-500"}`}>
            Split {formatCurrency(draftSum(draft))} of {formatCurrency(total)}
          </p>) : null}
      </div>);
    };
    /** POS and Cash ("salesPlusTips"): tips entered on top of sales, with the
     * source total shown so it can be checked against the POS report or
     * drawer count. $1,200 sales + $300 tips = $1,500, sales untouched. */
    const renderSalesTipsField = (field: "posSales" | "cashSales") => {
        if (!tipsEnabled || !showNonSourceIncomeField)
            return null;
        const tipsKey = field === "posSales" ? "posTips" : "cashTips";
        const sales = parseMoney(form[field]);
        const tips = parseMoney(form[tipsKey]);
        return (<div className="mt-3 space-y-1 border-t border-border/70 pt-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${field}-tips`} className="text-sm font-normal text-muted-foreground">
            + Tips <span className="text-xs">(on top of sales)</span>
          </Label>
          <div className="flex items-baseline gap-0.5">
            <span className="text-sm text-muted-foreground">$</span>
            <input id={`${field}-tips`} type="number" step="0.01" inputMode="decimal" placeholder="0.00" style={{ width: amountWidth(form[tipsKey]) }} value={form[tipsKey]} onChange={(e) => setForm((prev) => ({ ...prev, [tipsKey]: e.target.value }))} className="max-w-28 bg-transparent text-right text-base tabular-nums outline-none placeholder:text-muted-foreground/50"/>
          </div>
        </div>
        {sales > 0 && tips > 0 ? (<p className="text-right text-xs text-muted-foreground">
            {paymentCategoryConfig[field].label} total{" "}
            <span className="font-medium text-foreground tabular-nums">{formatCurrency(sales + tips)}</span>
          </p>) : null}
      </div>);
    };
    /** A recurring rule can only carry one number with one category. `field`
     * is eligible only when: it (or, for "custom", the single custom income
     * row) has a positive amount; a payment field has at most one category
     * selected in its breakdown draft (a multi-category split can't collapse
     * into one recurring template); and every OTHER income-affecting field
     * — the other payment fields, custom income, hours, tips, reported/
     * unreported cash — is empty. A recurring submission carries only that
     * one number forward; anything else typed today would otherwise be
     * silently dropped from future occurrences.
     *
     * Returns the specific reason a field isn't eligible (or null when it
     * is) so the UI can tell "you haven't entered an amount yet" apart from
     * "clear the other fields first" — those call for different messages,
     * and showing the wrong one before the user has typed anything is
     * confusing. */
    const getRecurringIneligibilityReason = useCallback((f: typeof form, field: RecurringIncomeSource): "no_amount" | "multi_category" | "has_tips" | "other_fields_populated" | null => {
        if (field === "custom") {
            const item = (f.customIncome ?? [])[0];
            if ((f.customIncome ?? []).length !== 1 || !item || !(Number(item.amount ?? 0) > 0) || !item.label?.trim()) {
                return "no_amount";
            }
        } else {
            const amount = parseMoney(f[field]);
            if (amount <= 0) return "no_amount";
            const draft = f.paymentBreakdowns[field];
            if (draft.selected.length > 1) return "multi_category";
            // Tips on top belong to this same source, so "clear the other
            // income fields" would point at the wrong thing.
            if ((field === "posSales" && parseMoney(f.posTips)) || (field === "cashSales" && parseMoney(f.cashTips))) {
                return "has_tips";
            }
        }
        if (parseMoney(f.tips) || parseMoney(f.reportedCash) || parseMoney(f.unreportedCash) || parseMoney(f.independentHours) ||
            parseMoney(f.posTips) || parseMoney(f.cashTips)) {
            return "other_fields_populated";
        }
        if (field === "custom") {
            if (!PAYMENT_REPEAT_FIELDS.every((pf) => !parseMoney(f[pf]))) return "other_fields_populated";
        } else {
            const otherPaymentFieldsEmpty = PAYMENT_REPEAT_FIELDS
                .filter((pf) => pf !== field)
                .every((pf) => !parseMoney(f[pf]));
            if (!otherPaymentFieldsEmpty || (f.customIncome ?? []).length > 0) return "other_fields_populated";
        }
        return null;
    }, []);
    const recurringIneligibilityMessage = (reason: "no_amount" | "multi_category" | "has_tips" | "other_fields_populated") => {
        switch (reason) {
            case "no_amount":
                return "Please enter an amount for this field before turning on Repeats.";
            case "multi_category":
                return "This field is split across multiple categories — Repeats needs a single category. Uncheck the extra categories first.";
            case "has_tips":
                return "Repeats can only carry the sales amount — clear the tips for this entry first.";
            case "other_fields_populated":
                return "Recurring income can only apply to one income source per entry — clear the other income fields first.";
        }
    };
    const isFieldRecurringEligible = useCallback((f: typeof form, field: RecurringIncomeSource): boolean => {
        return getRecurringIneligibilityReason(f, field) === null;
    }, [getRecurringIneligibilityReason]);
    useEffect(() => {
        if (repeatSourceField && !isFieldRecurringEligible(form, repeatSourceField)) {
            setRepeatSourceField(null);
        }
    }, [form, repeatSourceField, isFieldRecurringEligible]);
    const handleRepeatSwitchChange = useCallback((field: RecurringIncomeSource, checked: boolean) => {
        if (!checked) {
            setRepeatSourceField((current) => (current === field ? null : current));
            return;
        }
        const reason = getRecurringIneligibilityReason(form, field);
        if (reason) {
            alert(recurringIneligibilityMessage(reason));
            return;
        }
        setRepeatSourceField(field);
    }, [form, getRecurringIneligibilityReason]);
    function renderRepeatSwitch(field: RecurringIncomeSource) {
        return (<div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
        <Label htmlFor={`${field}-repeat`} className="text-sm font-normal text-muted-foreground">Repeats</Label>
        <Switch id={`${field}-repeat`} checked={repeatSourceField === field} onCheckedChange={(checked) => handleRepeatSwitchChange(field, checked)}/>
      </div>);
    }
    /** Once a field is marked recurring, every other income-affecting field is
     * hidden rather than just blocked — a recurring rule can only carry one
     * number with one category (see getRecurringIneligibilityReason above),
     * so leaving fields visible that the user can't actually use is confusing.
     * `source` fields (payment methods + custom) stay visible only when they
     * ARE the active recurring field; non-source fields (hours/tips/cash) hide
     * unconditionally once any field is recurring, since they block
     * eligibility no matter which source is selected. */
    const showIncomeSource = useCallback((source: RecurringIncomeSource) => !repeatSourceField || repeatSourceField === source, [repeatSourceField]);
    const showNonSourceIncomeField = !repeatSourceField;
    const addCustomIncomeRow = useCallback((label: string = "") => {
        setForm((prev) => ({
            ...prev,
            customIncome: [...(prev.customIncome ?? []), { label, amount: "", category: "other" as IncomeCategory }],
        }));
    }, []);
    /** Shared by the post-submit reset and the manual "Clear Form" button —
     * clears every entered field back to its default, but preserves the
     * settings-derived defaults (rate, custom deduction toggles) and the
     * in/out AM/PM period selectors the same way a successful submit does. */
    const buildClearedFormState = useCallback((prev: typeof form) => {
        const nowIso = new Date().toISOString();
        return {
            ...prev,
            date: getLocalDateInputValue(),
            tips: "",
            reportedCash: "",
            unreportedCash: "",
            hours: "",
            inTime: "",
            inPeriod: prev.inPeriod,
            outTime: "",
            outPeriod: prev.outPeriod,
            rate: settings?.w2?.defaultHourlyRate?.toString() ?? "",
            positionId: null,
            notes: "",
            appliedCustomDeductions: settings?.w2?.customDeductions
                ? settings.w2?.customDeductions.map((d: { label: string; amount: number }) => d.label)
                : [],
            independentHours: "",
            venmo: "",
            appleCash: "",
            zelle: "",
            posSales: "",
            cashSales: "",
            posTips: "",
            cashTips: "",
            paymentBreakdowns: {
                venmo: emptyBreakdownDraft(),
                appleCash: emptyBreakdownDraft(),
                zelle: emptyBreakdownDraft(),
                posSales: emptyBreakdownDraft(),
                cashSales: emptyBreakdownDraft(),
            },
            customIncome: [],
            createdAtLocal: nowIso,
            updatedAtLocal: nowIso,
        };
    }, [settings]);
    const handleClearForm = useCallback(() => {
        setForm((prev) => buildClearedFormState(prev));
        setOpenSources(new Set());
        setRepeatSourceField(null);
        setRepeatCadence({ freq: "monthly" });
        setRepeatEndDate("");
    }, [buildClearedFormState]);
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
                    ...(visibility.mode === "w2" && visibility.showRate && form.positionId && {
                        positionId: form.positionId,
                        positionTitle: form.positionId === CUSTOM_POSITION_ID
                            ? CUSTOM_POSITION_TITLE
                            : rateOptions.find((o) => o.id === form.positionId)?.title ?? CUSTOM_POSITION_TITLE,
                    }),
                    ...(visibility.mode === "w2" && visibility.showInOutTimes && {
                        inTime: `${form.inTime} ${form.inPeriod}`,
                        outTime: `${form.outTime} ${form.outPeriod}`,
                    }),
                };
            }
            const repeatIneligibilityReason = activeWorkspace.type === "independent" && repeatSourceField
                ? getRecurringIneligibilityReason(form, repeatSourceField)
                : null;
            if (repeatIneligibilityReason) {
                alert(recurringIneligibilityMessage(repeatIneligibilityReason));
                setSubmitting(false);
                return;
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
                // tipsOnTop: POS / Cash tips, added to the same breakdown on
                // top of the sales split (which must still add up to sales).
                const buildCategorizedBreakdown = (field: "venmo" | "appleCash" | "zelle" | "posSales" | "cashSales", tipsOnTop = 0) => {
                    const total = parseNum(form[field]) ?? 0;
                    const config = paymentCategoryConfig[field];
                    if (total <= 0) {
                        if (tipsOnTop > 0)
                            incomeBreakdowns.push({ paymentMethod: config.paymentMethod, tips: tipsOnTop });
                        return;
                    }
                    const draft = form.paymentBreakdowns[field];
                    const splitCategories = getSplitCategories(field, tipsEnabled);
                    const selectedCategories = draft.selected.filter((category) => splitCategories.includes(category));
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
                    incomeBreakdowns.push(tipsOnTop > 0 ? { ...parsedBreakdown.data, tips: tipsOnTop } : parsedBreakdown.data);
                };
                buildCategorizedBreakdown("venmo");
                buildCategorizedBreakdown("appleCash");
                buildCategorizedBreakdown("zelle");
                // Card tips are stored under POS now (no separate "card" tips
                // line), cash tips under Cash — as before, just entered here.
                buildCategorizedBreakdown("posSales", tipsEnabled ? parseNum(form.posTips) ?? 0 : 0);
                buildCategorizedBreakdown("cashSales", tipsEnabled ? parseNum(form.cashTips) ?? 0 : 0);
                const unreportedCashTips = parseNum(form.unreportedCash) ?? 0;
                // Other income needs a name (who paid you) — that's what makes
                // per-payer totals checkable against 1099s. Names are snapped
                // to the saved spelling when they only differ by case.
                const savedIncomeNames = getSavedIncomeNames(settings);
                const namedCustomIncome = (form.customIncome ?? [])
                    .filter((item) => item && Number(item.amount ?? 0) > 0)
                    .map((item) => ({ ...item, label: canonicalIncomeName(item.label ?? "", savedIncomeNames) }));
                if (namedCustomIncome.some((item) => !item.label)) {
                    throw new Error("Add who paid you for each Other income line.");
                }
                for (const item of namedCustomIncome) {
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
                    customIncome: namedCustomIncome,
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
            if (activeWorkspace.type === "independent" && repeatSourceField) {
                const incomeTemplate = repeatSourceField === "custom"
                    ? {
                        source: "custom" as const,
                        amount: Number(form.customIncome[0].amount),
                        category: form.customIncome[0].category,
                        label: canonicalIncomeName(form.customIncome[0].label, getSavedIncomeNames(settings)),
                    }
                    : (() => {
                        const draft = form.paymentBreakdowns[repeatSourceField];
                        const category = draft.selected[0] ?? paymentCategoryConfig[repeatSourceField].defaultCategory;
                        return {
                            source: repeatSourceField,
                            amount: parseMoney(form[repeatSourceField]),
                            category,
                        };
                    })();
                await recurringRulesService.createRecurringRule(activeWorkspaceId, {
                    type: "income" as const,
                    cadence: repeatCadence,
                    anchorDate: form.date,
                    endDate: repeatEndDate || null,
                    notes: form.notes.trim(),
                    incomeTemplate,
                });
            } else {
                await entriesService.createEntry(activeWorkspaceId, parseResult.data, {
                    trace: submitTraceRef.current
                        ? {
                            traceId: submitTraceRef.current.traceId,
                            flow: submitTraceRef.current.flow,
                        }
                        : null,
                });
            }
            setSuccess(true);
            submitTraceRef.current.mark("entry_create.ui_success");
            // New names join the shared list (Settings → Other income names)
            // so they're suggested next time, here and in the bank review.
            if (activeWorkspace.type === "independent") {
                const usedNames = (form.customIncome ?? [])
                    .filter((item) => Number(item.amount ?? 0) > 0 && item.label?.trim())
                    .map((item) => item.label);
                if (usedNames.length > 0)
                    void saveNewIncomeNames(activeWorkspaceId, usedNames);
            }
            /** Reset raw form fields */
            setForm((prev) => buildClearedFormState(prev));
            setOpenSources(new Set());
            setExpanded(false);
            setRepeatSourceField(null);
            setRepeatCadence({ freq: "monthly" });
            setRepeatEndDate("");
            submitTraceRef.current.mark("entry_create.form_reset");
        }
        catch (error) {
            submitTraceRef.current?.error("entry_create.failed", error);
            // Offline already surfaced its own toast — avoid a redundant alert.
            const isOfflineRecurringError = error instanceof Error && error.message.startsWith("Offline —");
            if (!isOfflineRecurringError) {
                alert(error instanceof Error
                    ? error.message
                    : "Failed to save entry. Please try again.");
            }
        }
        finally {
            submitTraceRef.current?.mark("entry_create.complete");
            setSubmitting(false);
        }
    }, [form, submitting, visibility, settings, activeWorkspace, activeWorkspaceId, repeatSourceField, repeatCadence, repeatEndDate, getRecurringIneligibilityReason, buildClearedFormState, rateOptions]);
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
    // Display only: what this entry adds up to across every source.
    const independentEntryTotal = visibility.mode === "independent"
        ? PAYMENT_REPEAT_FIELDS.reduce((sum, field) => sum + parseMoney(form[field]), 0)
            + (tipsEnabled ? parseMoney(form.posTips) + parseMoney(form.cashTips) : 0)
            + (form.customIncome ?? []).reduce((sum, item) => sum + parseMoney(item.amount ?? ""), 0)
        : 0;
    const independentPersonalCash = visibility.mode === "independent" ? parseMoney(form.unreportedCash) : 0;
    return (<Card className={`relative overflow-hidden rounded-[22px] border-0 shadow-none ${expanded ? "gap-5 py-5" : "gap-0 py-4"}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5">
        <button type="button" onClick={() => setExpanded((current) => !current)} disabled={submitting} className="flex min-w-0 flex-col items-start gap-0.5 text-left" aria-hidden="true" tabIndex={-1}>
          <CardTitle className="text-lg">Add entry</CardTitle>
          {!expanded ? (<span className="text-sm text-muted-foreground">Log income for any day</span>) : null}
        </button>

        <Button type="button" variant={expanded ? "ghost" : "default"} size="icon" className="size-10 shrink-0 rounded-full" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Collapse entry form" : "Expand entry form"} disabled={submitting}>
          {expanded ? <Minus /> : <Plus />}
        </Button>
      </CardHeader>

      {!expanded ? (<CardContent className="px-5 pt-0 pb-0"/>) : (<CardContent className="px-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitting ? (<p className="text-sm text-muted-foreground">
              Adding your entry and syncing in the background...
            </p>) : null}

          {/* Date */}
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-1.5">
            <Label htmlFor="date" className="shrink-0 text-sm font-normal text-muted-foreground">Date</Label>
            <Input
              id="date"
              type="date"
              data-stackin-date-input="true"
              className="h-9 w-auto min-w-0 border-0 bg-transparent px-0 text-right font-medium shadow-none focus-visible:ring-0"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              min={dateInputBounds?.start}
              max={dateInputBounds?.end}
              required
            />
          </div>

          {/* W-2 Tips */}
          {/* W-2 UI continues to use legacy visibility flags */}
          {visibility?.mode === "w2" && (<>
          {visibility?.showTips && (<div className={W2_ROW}>
              <Label htmlFor="tips" className={W2_LABEL}>Credit card tips</Label>
              <Input id="tips" type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={form.tips} onChange={(e) => setForm({ ...form, tips: e.target.value })} className={W2_INPUT}/>
            </div>)}

          {/* W-2 Hours Section */}
          {visibility?.showHoursSection && (<>
              {visibility.showHoursManual && (<div className={W2_ROW}>
                  <Label htmlFor="hours" className={W2_LABEL}>Hours worked</Label>
                  <Input id="hours" type="number" step="0.01" inputMode="decimal" placeholder="0" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} required className={W2_INPUT}/>
                </div>)}

              {visibility.showInOutTimes && (<div className="space-y-2 rounded-2xl bg-muted px-4 py-3">
                  <Label className={W2_LABEL}>In / out times</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5 rounded-xl bg-card px-2 py-1">
                      <Input placeholder="HH:MM" inputMode="numeric" aria-label="In time" value={form.inTime} onChange={(e) => setForm({
                            ...form,
                            inTime: enforceHHMM(e.target.value),
                        })} className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-center shadow-none focus-visible:ring-0" required/>
                      <select aria-label="In AM or PM" value={form.inPeriod} onChange={(e) => {
                            setForm({ ...form, inPeriod: e.target.value });
                            writeStoredTimePeriods(e.target.value, form.outPeriod);
                        }} className="rounded-full bg-muted px-2 py-1 text-sm">
                        <option>AM</option>
                        <option>PM</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 rounded-xl bg-card px-2 py-1">
                      <Input placeholder="HH:MM" inputMode="numeric" aria-label="Out time" value={form.outTime} onChange={(e) => setForm({
                            ...form,
                            outTime: enforceHHMM(e.target.value),
                        })} className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-center shadow-none focus-visible:ring-0" required/>
                      <select aria-label="Out AM or PM" value={form.outPeriod} onChange={(e) => {
                            setForm({ ...form, outPeriod: e.target.value });
                            writeStoredTimePeriods(form.inPeriod, e.target.value);
                        }} className="rounded-full bg-muted px-2 py-1 text-sm">
                        <option>AM</option>
                        <option>PM</option>
                      </select>
                    </div>
                  </div>
                </div>)}

              {visibility.showRate && rateOptions.length > 1 && (<div className={W2_ROW}>
                  <Label htmlFor="position" className={W2_LABEL}>Position</Label>
                  <select id="position" value={form.positionId ?? ""} onChange={(e) => setForm({
                        ...form,
                        ...resolvePositionRate(settings, e.target.value === "" ? null : e.target.value, form.rate),
                    })} className="min-w-0 max-w-[65%] truncate rounded-full bg-card px-3 py-1.5 text-sm">
                    {rateOptions.map((o) => (<option key={o.id ?? ""} value={o.id ?? ""}>
                        {o.title} – ${o.rate.toFixed(2)}/hr
                      </option>))}
                    {form.positionId === CUSTOM_POSITION_ID && (<option value={CUSTOM_POSITION_ID}>{CUSTOM_POSITION_TITLE}</option>)}
                  </select>
                </div>)}

              {visibility.showRate && (<div className={W2_ROW}>
                  <Label htmlFor="rate" className={W2_LABEL}>Hourly rate</Label>
                  {/* Typing a rate by hand marks the entry Custom */}
                  <Input id="rate" type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value, positionId: CUSTOM_POSITION_ID })} required className={W2_INPUT}/>
                </div>)}
            </>)}

          {/* W-2 Cash + Deductions */}
          {visibility?.showReportedCash && (<div className={W2_ROW}>
              <Label htmlFor="reportedCash" className={W2_LABEL}>Reported cash</Label>
              <Input id="reportedCash" type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={form.reportedCash} onChange={(e) => setForm({ ...form, reportedCash: e.target.value })} className={W2_INPUT}/>
            </div>)}

          {visibility?.showUnreportedCash && (<div className={W2_ROW}>
              <Label htmlFor="unreportedCash" className={W2_LABEL}>Personal cash</Label>
              <Input id="unreportedCash" type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={form.unreportedCash} onChange={(e) => setForm({ ...form, unreportedCash: e.target.value })} className={W2_INPUT}/>
            </div>)}

          {visibility?.showBreakDeduction && settings.w2?.autoBreakDeduction && (<>
              <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                <Checkbox id="breakDeduction" checked={form.breakDeduction} onCheckedChange={(checked) => setForm({
                        ...form,
                        breakDeduction: checked as boolean,
                        breakMinutes: checked
                            ? settings.w2?.breakMinutesDefault ?? 30
                            : 0,
                    })}/>
                <Label htmlFor="breakDeduction" className="text-sm font-normal">
                  Break deduction ({settings.w2?.breakMinutesDefault ?? 30} min)
                </Label>
              </div>
            </>)}

          {visibility?.showCustomDeductions && (settings.w2?.customDeductions ?? []).length > 0 && (<div className="space-y-2.5 rounded-2xl bg-muted px-4 py-3">
              {(settings.w2?.customDeductions ?? []).map((d: {
                        label: string;
                        amount: number;
                    }) => {
                        const checked = form.appliedCustomDeductions.includes(d.label);
                        return (<div key={d.label} className="flex items-center gap-3">
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
                    <Label htmlFor={`custom-${d.label}`} className="text-sm font-normal">{d.label}</Label>
                  </div>);
                    })}
            </div>)}  </>)}


          {/* Independent Section */}
          {/* CHANGE: Independent UI is now driven by visibility.mode === "independent"
                and uses the new independent visibility flags. */}
          {visibility?.mode === "independent" && (<>
              {/* Independent Hours */}
              {visibility.showHours && showNonSourceIncomeField && (<div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-1.5">
                  <Label htmlFor="independentHours" className="text-sm font-normal text-muted-foreground">Hours worked</Label>
                  <input id="independentHours" type="number" step="0.1" inputMode="decimal" placeholder="0" value={form.independentHours} onChange={(e) => setForm({ ...form, independentHours: e.target.value })} className="h-9 w-24 bg-transparent text-right text-base font-medium tabular-nums outline-none placeholder:text-muted-foreground/50"/>
                </div>)}

              {(() => {
                    // Settings decide which sources exist; the chips only decide
                    // which of those are open. Anything with an amount stays open.
                    const paymentSources = ([
                        { field: "venmo", enabled: visibility.showVenmo, label: "Venmo", chip: "Venmo" },
                        { field: "appleCash", enabled: visibility.showAppleCash, label: "Apple Pay", chip: "Apple Pay" },
                        { field: "zelle", enabled: visibility.showZelle, label: "Zelle", chip: "Zelle" },
                        { field: "posSales", enabled: visibility.showPosSales, label: paymentCategoryConfig.posSales.label, chip: "Card / POS" },
                        { field: "cashSales", enabled: visibility.showCashSales, label: `${paymentCategoryConfig.cashSales.label} sales`, chip: paymentCategoryConfig.cashSales.label },
                    ] as const).filter((source) => source.enabled && showIncomeSource(source.field));
                    const showPersonalCash = visibility.showIndependentUnreportedCash && showNonSourceIncomeField;
                    const showCustom = visibility.showCustomIncome && showIncomeSource("custom");
                    const onlyOneSource = paymentSources.length + (showPersonalCash ? 1 : 0) === 1 && !showCustom;
                    const isPaymentShown = (field: PaymentField) => onlyOneSource || openSources.has(field) || repeatSourceField === field ||
                        parseMoney(form[field]) > 0 || (field === "posSales" && parseMoney(form.posTips) > 0) || (field === "cashSales" && parseMoney(form.cashTips) > 0);
                    const isPersonalCashShown = onlyOneSource || openSources.has("personalCash") || parseMoney(form.unreportedCash) > 0;
                    const chipClass = (on: boolean) => `rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${on ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-secondary"}`;
                    const amountInputClass = "min-w-[1ch] max-w-36 bg-transparent text-right text-2xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40";
                    const removeButton = (label: string, onRemove: () => void) => (<button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground">
                      <X className="size-4"/>
                    </button>);
                    return (<>
                  {!onlyOneSource && (paymentSources.length > 0 || showPersonalCash || showCustom) && (<div className="space-y-2">
                      <p className="text-sm font-medium">How were you paid?</p>
                      <div className="flex flex-wrap gap-2">
                        {paymentSources.map(({ field, chip }) => {
                                const shown = isPaymentShown(field);
                                return (<button key={field} type="button" aria-pressed={shown} className={chipClass(shown)} onClick={() => shown ? document.getElementById(field)?.focus() : openSource(field)}>
                              {chip}
                            </button>);
                            })}
                        {showPersonalCash && (<button type="button" aria-pressed={isPersonalCashShown} className={chipClass(isPersonalCashShown)} onClick={() => isPersonalCashShown ? document.getElementById("independentUnreportedCash")?.focus() : openSource("personalCash")}>
                            Personal Cash
                          </button>)}
                        {showCustom && (settings.independent?.customIncomeFields ?? []).map((field, idx) => (<button key={`${field.label}-${idx}`} type="button" className={chipClass(false)} onClick={() => addCustomIncomeRow(field.label)}>
                            + {field.label}
                          </button>))}
                        {showCustom && (<button type="button" className={chipClass(false)} onClick={() => addCustomIncomeRow()}>
                            + Other income
                          </button>)}
                      </div>
                    </div>)}

                  {paymentSources.filter(({ field }) => isPaymentShown(field)).map(({ field, label }) => (<div key={field} data-breakdown-field={field} className="rounded-2xl bg-muted px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={field} className="text-base font-medium">{label}</Label>
                        <div className="flex items-center gap-1">
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-lg text-muted-foreground">$</span>
                            <input id={field} type="number" step="0.01" inputMode="decimal" placeholder="0.00" style={{ width: amountWidth(form[field]) }} value={form[field]} onFocus={() => setOpenBreakdownField(field)} onChange={(e) => updateCategorizedPaymentAmount(field, e.target.value)} className={amountInputClass}/>
                          </div>
                          {!onlyOneSource && removeButton(label, () => {
                                    updateCategorizedPaymentAmount(field, "");
                                    if (field === "posSales" || field === "cashSales") {
                                        const tipsKey = field === "posSales" ? "posTips" : "cashTips";
                                        setForm((prev) => ({ ...prev, [tipsKey]: "" }));
                                    }
                                    if (repeatSourceField === field)
                                        setRepeatSourceField(null);
                                    closeSource(field);
                                })}
                        </div>
                      </div>
                      {renderPaymentBreakdownFields(field)}
                      {(field === "posSales" || field === "cashSales") && renderSalesTipsField(field)}
                      {renderRepeatSwitch(field)}
                    </div>))}

                  {/* Personal Cash — its own option, no longer a kind of tip */}
                  {showPersonalCash && isPersonalCashShown && (<div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
                      <Label htmlFor="independentUnreportedCash" className="text-base font-medium">Personal Cash</Label>
                      <div className="flex items-center gap-1">
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-lg text-muted-foreground">$</span>
                          <input id="independentUnreportedCash" type="number" step="0.01" inputMode="decimal" placeholder="0.00" style={{ width: amountWidth(form.unreportedCash) }} value={form.unreportedCash} onChange={(e) => setForm({ ...form, unreportedCash: e.target.value })} className={amountInputClass}/>
                        </div>
                        {!onlyOneSource && removeButton("Personal Cash", () => {
                                setForm((prev) => ({ ...prev, unreportedCash: "" }));
                                closeSource("personalCash");
                            })}
                      </div>
                    </div>)}

                  {/* Independent Custom Income Repeater */}
                  {showCustom && (form.customIncome ?? []).map((item, idx) => (<div key={idx} className="space-y-2 rounded-2xl bg-muted px-4 py-3">
                      {/* Name on its own line — it's the part that matters for
                          matching 1099s, so it shouldn't be squeezed. */}
                      <IncomeNameInput className="h-10 rounded-xl border-0 bg-card shadow-none" value={item.label} savedNames={getSavedIncomeNames(settings)} aria-label="Who paid you?" onChange={(label) => {
                                const next = [...form.customIncome];
                                next[idx] = { ...next[idx], label };
                                setForm({ ...form, customIncome: next });
                            }}/>
                      <div className="flex items-center justify-between gap-3">
                        <select value={item.category} aria-label="Income category" onChange={(e) => {
                                const next = [...form.customIncome];
                                next[idx] = {
                                    ...next[idx],
                                    category: e.target.value as IncomeCategory,
                                };
                                setForm({ ...form, customIncome: next });
                            }} className="rounded-full border-0 bg-card px-3 py-1.5 text-sm">
                          <option value="services">Services</option>
                          {tipsEnabled || item.category === "tips" ? <option value="tips">Tips</option> : null}
                          <option value="products">Products</option>
                          <option value="other">Other</option>
                        </select>
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-lg text-muted-foreground">$</span>
                          <input type="number" step="0.01" inputMode="decimal" placeholder="0.00" aria-label="Amount" style={{ width: amountWidth(item.amount) }} value={item.amount} onChange={(e) => {
                                const next = [...form.customIncome];
                                next[idx] = {
                                    ...next[idx],
                                    amount: e.target.value,
                                };
                                setForm({ ...form, customIncome: next });
                            }} className={amountInputClass}/>
                        </div>
                      </div>
                      {(form.customIncome ?? []).length === 1 ? renderRepeatSwitch("custom") : null}
                    </div>))}
                </>);
                })()}

              {repeatSourceField ? (<div className="space-y-3 rounded-2xl bg-accent px-4 py-3">
                  <div className="text-sm font-medium">
                    Repeats: {repeatSourceField === "custom"
                        ? (form.customIncome[0]?.label || "Custom Income")
                        : paymentCategoryConfig[repeatSourceField].label}
                  </div>
                  <RecurringCadenceFields idPrefix="income" cadence={repeatCadence} onCadenceChange={setRepeatCadence} endDate={repeatEndDate} onEndDateChange={setRepeatEndDate} minEndDate={form.date}/>
                </div>) : null}

              {independentEntryTotal > 0 || independentPersonalCash > 0 ? (<div className="flex items-baseline justify-between gap-3 px-1 pt-1">
                  <span className="text-sm text-muted-foreground">Entry total</span>
                  <span className="text-right">
                    <span className="text-2xl font-semibold tabular-nums">{formatCurrency(independentEntryTotal)}</span>
                    {independentPersonalCash > 0 ? (<span className="block text-xs text-muted-foreground tabular-nums">
                        + {formatCurrency(independentPersonalCash)} personal cash
                      </span>) : null}
                  </span>
                </div>) : null}
            </>)}

          {visibility?.showNotes && (<div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-1.5">
              <Label htmlFor="notes" className="shrink-0 text-sm font-normal text-muted-foreground">Notes</Label>
              <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" type="text" className="h-9 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"/>
            </div>)}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="ghost" className="h-12 rounded-2xl px-5 text-muted-foreground" onClick={handleClearForm} disabled={submitting}>
              Clear
            </Button>
            <Button type="submit" disabled={submitting} className="h-12 flex-1 rounded-2xl text-base font-semibold">
              {submitting ? "Saving..." : repeatSourceField ? "Add recurring income" : "Add entry"}
            </Button>
          </div>
        </form>
      </CardContent>)}
    </Card>);
}
