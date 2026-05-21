// /components/entries-grid.tsx
"use client";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { MessageCircle, Pencil, MoreVertical } from "lucide-react";
import { formatCurrency, parseLocalDate } from "@/lib/helpers";
import { EntryType, FieldSchemas, IncomeBreakdownSchema, type IncomeCategory, } from "@shared/schemas/entry";
import { resolveEntryGridVisibility } from "@shared/entryVisibility";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GridEditorPopoverContent } from "@/components/grid-editor-popover-content";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { thBase, tdBase } from "@/lib/tableStyles";
import { cn } from "@/lib/utils";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import * as entriesService from "@/lib/domain/entriesService";
import { computeIncomeGaugeForEntry } from "@shared/computeIncomeGauge";
import { debugRender } from "@/lib/debugLoop";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { aggregateIncomeBreakdowns, getIncomeBreakdownTotalForPaymentMethod, getIncomeBreakdownTotalForPaymentMethodAndCategory, getIndependentCashSalesTotal, } from "@shared/independentIncome";
// Short date formatter
const formatShortDate = (iso: string) => parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const paymentFieldConfig = {
    venmo: {
        label: "Venmo",
        paymentMethod: "venmo",
        categories: ["services", "tips", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    appleCash: {
        label: "Apple Cash",
        paymentMethod: "apple_cash",
        categories: ["services", "tips", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    zelle: {
        label: "Zelle",
        paymentMethod: "zelle",
        categories: ["services", "tips", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    posSales: {
        label: "POS Sales",
        paymentMethod: "pos",
        categories: ["services", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    cashSales: {
        label: "Cash Sales",
        paymentMethod: "cash",
        categories: ["services", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
} as const;
function displayMoneyValue(value: number | undefined, prefix = "", decimals = 2) {
    if (typeof value !== "number" || Math.abs(value) < 0.0001) {
        return "--";
    }
    return prefix + value.toFixed(decimals);
}
function displayNumberValue(value: number | undefined, decimals = 2) {
    if (typeof value !== "number" || Math.abs(value) < 0.0001) {
        return "--";
    }
    return value.toFixed(decimals);
}
function getIndependentColumnTotal(entry: EntryType, field: keyof typeof paymentFieldConfig) {
    const independent = entry.independent;
    if (!independent)
        return 0;
    if (field === "cashSales") {
        return getIndependentCashSalesTotal(independent);
    }
    return getIncomeBreakdownTotalForPaymentMethod(independent, paymentFieldConfig[field].paymentMethod);
}
function ResponsiveHeader({ desktopLabel, mobileLines }: {
    desktopLabel: string;
    mobileLines?: string[];
}) {
    if (!mobileLines || mobileLines.length === 0) {
        return <>{desktopLabel}</>;
    }
    return (<>
      <span className="flex flex-col items-center leading-tight sm:hidden">
        {mobileLines.map((line) => (<span key={`${desktopLabel}-${line}`}>{line}</span>))}
      </span>
      <span className="hidden sm:inline">{desktopLabel}</span>
    </>);
}
function getEditableCellButtonClass(armed: boolean) {
    return cn("w-full rounded-md transition-colors focus:outline-none", "text-center sm:text-right", armed
        ? "bg-emerald-100 text-foreground ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:ring-emerald-400/50"
        : "hover:bg-accent");
}
export default function EntriesGrid() {
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const entriesEntry = useEntriesStore((s) => activeWorkspaceId ? s.byWorkspaceId?.[activeWorkspaceId] : undefined);
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const entries = entriesEntry?.entries ?? [];
    const entriesLoading = activeWorkspaceId != null
        ? (entriesEntry?.status ?? "idle") === "loading"
        : true;
    const settings = settingsEntry?.data ?? null;
    const settingsLoading = activeWorkspaceId != null
        ? (settingsEntry?.status ?? "idle") === "loading"
        : true;
    const isWorkspaceReady = workspaceState.status === "ready" && !!activeWorkspaceId && !!activeWorkspace;
    const hasRenderableEntries = entries.length > 0 || (entriesEntry?.lastBackendSync ?? null) !== null;
    const hasRenderableSettings = settings !== null;
    debugRender("entries-grid", {
        workspaceId: activeWorkspaceId,
        workspaceType: activeWorkspace?.type ?? null,
        entriesStatus: entriesEntry?.status ?? "idle",
        settingsStatus: settingsEntry?.status ?? "idle",
        entriesCount: entries.length,
        hasSettings: settings !== null,
    });
    const gridRootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [armedCell, setArmedCell] = useState<{
        id: string;
        field: string;
    } | null>(null);
    const [openEditorCell, setOpenEditorCell] = useState<{
        id: string;
        field: string;
    } | null>(null);
    const resolvedSettings = settings ?? {
        common: {},
        w2: {},
        independent: {},
    };
    const armOrOpenCell = useCallback((id: string, field: string) => {
        if (armedCell?.id === id && armedCell.field === field) {
            setArmedCell(null);
            setOpenEditorCell({ id, field });
            return;
        }
        setOpenEditorCell(null);
        setArmedCell({ id, field });
    }, [armedCell]);
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }
            if (target.closest('[data-entries-grid-root="true"]') ||
                target.closest('[data-grid-popover="entries"]')) {
                return;
            }
            setArmedCell(null);
            setOpenEditorCell(null);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }
            setArmedCell(null);
            setOpenEditorCell(null);
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);
    const gridMode = entries.find((entry) => entry.workspace === "w2" || entry.workspace === "independent")?.workspace ??
        activeWorkspace?.type ??
        "w2";
    // Prefer the loaded entry mode when present so legacy/stale workspace metadata
    // doesn't hide rows that were successfully fetched.
    const visibility = useMemo(() => resolveEntryGridVisibility(entries, gridMode), [entries, gridMode]);
    // Sort entries by date
    const sortedEntries = useMemo(() => [...entries].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")), [entries]);
    const usingHours = visibility.showHours;
    const showNotesColumn = resolvedSettings.common?.useNotes === true &&
        sortedEntries.some((entry) => (entry.notes?.trim()?.length ?? 0) > 0);
    const independentColumns = useMemo(() => {
        if (visibility.mode !== "independent")
            return null;
        return {
            showHours: visibility.showHours,
            showTips: visibility.showTips,
            showReportedCash: visibility.showReportedCash,
            showUnreportedCash: visibility.showUnreportedCash,
            showVenmo: visibility.showVenmo,
            showAppleCash: visibility.showAppleCash,
            showZelle: visibility.showZelle,
            showPosSales: visibility.showPosSales,
            showCashSales: visibility.showCashSales,
            showCustomIncome: visibility.showCustomIncome,
        };
    }, [visibility]);
    const totals = useMemo(() => {
        return sortedEntries.reduce((acc: {
            tips: number;
            reportedCash: number;
            unreportedCash: number;
            paidHours: number;
            venmo: number;
            appleCash: number;
            zelle: number;
            posSales: number;
            cashSales: number;
            customIncome: number;
            dayTotal: number;
        }, e) => {
            if (e.workspace === "w2") {
                acc.tips += e.w2?.tips ?? 0;
                acc.reportedCash += e.w2?.reportedCash ?? 0;
                acc.unreportedCash += e.w2?.unreportedCash ?? 0;
                // W2 paid hours come from totals.paidHours
                acc.paidHours += e.totals?.paidHours ?? 0;
            }
            if (e.workspace === "independent") {
                acc.tips += getIncomeBreakdownTotalForPaymentMethodAndCategory(e.independent, "card", "tips");
                acc.reportedCash += getIncomeBreakdownTotalForPaymentMethodAndCategory(e.independent, "cash", "tips");
                acc.unreportedCash += e.independent?.unreportedCashTips ?? e.independent?.unreportedCash ?? 0;
                acc.venmo += getIndependentColumnTotal(e, "venmo");
                acc.appleCash += getIndependentColumnTotal(e, "appleCash");
                acc.zelle += getIndependentColumnTotal(e, "zelle");
                acc.posSales += getIndependentColumnTotal(e, "posSales");
                acc.cashSales += getIndependentColumnTotal(e, "cashSales");
                acc.customIncome += (e.independent?.customIncome ?? []).reduce((sum: number, ci: {
                    amount?: number;
                }) => sum + (ci.amount ?? 0), 0);
                // Independent hours are stored separately
                acc.paidHours += e.independent?.hours ?? 0;
            }
            // Combined day total
            acc.dayTotal += computeIncomeGaugeForEntry(e, {
                includeUnreportedInUI: e.workspace === "w2"
                    ? resolvedSettings.w2?.includeUnreportedInUI ?? false
                    : resolvedSettings.independent?.includeUnreportedInUI ?? false,
            });
            return acc;
        }, {
            tips: 0,
            reportedCash: 0,
            unreportedCash: 0,
            paidHours: 0,
            venmo: 0,
            appleCash: 0,
            zelle: 0,
            posSales: 0,
            cashSales: 0,
            customIncome: 0,
            dayTotal: 0,
        });
    }, [sortedEntries, resolvedSettings]);
    const totalColumnCount = useMemo(() => {
        let count = 2;
        if (showNotesColumn)
            count += 1;
        if (visibility.mode === "w2") {
            if (visibility.showTips)
                count += 1;
            if (visibility.showHours)
                count += 1;
            if (visibility.showRate)
                count += 1;
            if (visibility.showReportedCash)
                count += 1;
            if (visibility.showUnreportedCash)
                count += 1;
            return count;
        }
        if (independentColumns?.showHours)
            count += 1;
        if (independentColumns?.showTips)
            count += 1;
        if (independentColumns?.showReportedCash)
            count += 1;
        if (independentColumns?.showUnreportedCash)
            count += 1;
        if (independentColumns?.showVenmo)
            count += 1;
        if (independentColumns?.showAppleCash)
            count += 1;
        if (independentColumns?.showZelle)
            count += 1;
        if (independentColumns?.showPosSales)
            count += 1;
        if (independentColumns?.showCashSales)
            count += 1;
        if (independentColumns?.showCustomIncome)
            count += 1;
        return count;
    }, [showNotesColumn, visibility, independentColumns]);
    const handleDelete = useCallback(async (entryId: string) => {
        if (!confirm("Delete this entry?"))
            return;
        if (!activeWorkspaceId)
            return;
        await entriesService.removeEntry(activeWorkspaceId, entryId);
    }, [activeWorkspaceId]);
    if (!isWorkspaceReady) {
        return <div className="p-4 text-gray-400 text-sm">Loading workspace…</div>;
    }
    if ((entriesLoading && !hasRenderableEntries) || (settingsLoading && !hasRenderableSettings)) {
        return <div className="p-4 text-gray-400 text-sm">Loading your entries…</div>;
    }
    if (!settings) {
        return (<div className="p-4 text-gray-400 text-sm">
        Loading settings…
      </div>);
    }
    /** Generic numeric editor for inline cells (tips, rate, cash, etc.) */
    const NumericCell = ({ entry, field, prefix = "", decimals = 2, }: {
        entry: EntryType;
        field: string;
        prefix?: string;
        decimals?: number;
    }) => {
        const cellId = entry.id ?? `${entry.date ?? "entry"}-${field}`;
        const isOpen = openEditorCell?.id === cellId && openEditorCell.field === field;
        const isArmed = armedCell?.id === cellId && armedCell.field === field;
        // ------------------------------------------------------------
        // Resolve nested fields like "w2.tips" or "independent.venmo"
        // ------------------------------------------------------------
        const resolvedValue: any = field.includes(".")
            ? field.split(".").reduce((acc: any, key) => (acc == null ? undefined : acc[key]), entry)
            : (entry as any)[field];
        // Initial value for editing
        const initial = typeof resolvedValue === "number"
            ? resolvedValue.toFixed(decimals)
            : "";
        const [val, setVal] = useState(initial);
        const [saving, setSaving] = useState(false);
        // ------------------------------------------------------------
        // Save handler (supports nested and flat fields)
        // ------------------------------------------------------------
        const save = async () => {
            if (!entry.id)
                return;
            const schema = FieldSchemas[field as keyof typeof FieldSchemas];
            const parsed = schema.safeParse(val);
            if (!parsed.success) {
                alert(parsed.error.issues[0]?.message ?? "Invalid value");
                return;
            }
            setSaving(true);
            try {
                // Nested update: e.g. w2.tips or independent.venmo
                if (field.includes(".")) {
                    const [root, key] = field.split(".");
                    await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                        [root]: {
                            ...(entry as any)[root],
                            [key]: parsed.data,
                        },
                    });
                }
                else {
                    // Flat update
                    await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                        [field]: parsed.data,
                    });
                }
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            finally {
                setSaving(false);
            }
        };
        // ------------------------------------------------------------
        // Display inside button (ALWAYS use resolvedValue, not entry[field])
        // ------------------------------------------------------------
        const display = displayMoneyValue(typeof resolvedValue === "number" ? resolvedValue : undefined, prefix, decimals);
        // ------------------------------------------------------------
        // UI RENDER
        // ------------------------------------------------------------
        return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    setOpenEditorCell((current) => current?.id === cellId && current.field === field ? null : current);
                }
            }}>
      <PopoverTrigger asChild>
        <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, field)}>
          {display}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-3 w-full">
          <div className="relative flex-1">
            <input ref={inputRef} type="text" value={val} onChange={(e) => setVal(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
          </div>

          <button onClick={save} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </GridEditorPopoverContent>
    </Popover>);
    };
    const BreakdownCell = ({ entry, field, }: {
        entry: EntryType;
        field: keyof typeof paymentFieldConfig;
    }) => {
        const cellField = `breakdown.${field}`;
        const cellId = entry.id ?? `${entry.date ?? "entry"}-${cellField}`;
        const isOpen = openEditorCell?.id === cellId && openEditorCell.field === cellField;
        const isArmed = armedCell?.id === cellId && armedCell.field === cellField;
        const config = paymentFieldConfig[field];
        const independent = entry.independent;
        const existingBreakdowns = independent?.incomeBreakdowns ?? [];
        const matching = existingBreakdowns.filter((item) => {
            if (item.paymentMethod !== config.paymentMethod)
                return false;
            if (field === "cashSales") {
                return (Number(item.services ?? 0) > 0 ||
                    Number(item.products ?? 0) > 0 ||
                    Number(item.other ?? 0) > 0);
            }
            return true;
        });
        const aggregated = aggregateIncomeBreakdowns(matching);
        const [services, setServices] = useState(aggregated.services > 0
            ? aggregated.services.toFixed(2)
            : "");
        const [tips, setTips] = useState(aggregated.tips > 0
            ? aggregated.tips.toFixed(2)
            : "");
        const [products, setProducts] = useState(aggregated.products > 0
            ? aggregated.products.toFixed(2)
            : "");
        const [other, setOther] = useState(aggregated.other > 0
            ? aggregated.other.toFixed(2)
            : "");
        const [saving, setSaving] = useState(false);
        const total = Number(services || 0) +
            Number(tips || 0) +
            Number(products || 0) +
            Number(other || 0);
        const save = async () => {
            if (!entry.id || !independent)
                return;
            const breakdownCandidate = {
                paymentMethod: config.paymentMethod,
                services: config.categories.includes("services") && Number(services || 0) > 0
                    ? Number(services || 0)
                    : undefined,
                tips: config.categories.includes("tips") && Number(tips || 0) > 0
                    ? Number(tips || 0)
                    : undefined,
                products: config.categories.includes("products") && Number(products || 0) > 0
                    ? Number(products || 0)
                    : undefined,
                other: config.categories.includes("other") && Number(other || 0) > 0
                    ? Number(other || 0)
                    : undefined,
            };
            const parsed = total > 0
                ? IncomeBreakdownSchema.safeParse(breakdownCandidate)
                : { success: true as const, data: null };
            if (!parsed.success) {
                alert(parsed.error.issues[0]?.message ?? `Invalid ${config.label} breakdown`);
                return;
            }
            setSaving(true);
            try {
                const nextBreakdowns = existingBreakdowns.filter((item) => {
                    if (item.paymentMethod !== config.paymentMethod)
                        return true;
                    if (field === "cashSales") {
                        const isCashSalesBreakdown = Number(item.services ?? 0) > 0 ||
                            Number(item.products ?? 0) > 0 ||
                            Number(item.other ?? 0) > 0;
                        return !isCashSalesBreakdown;
                    }
                    return false;
                });
                if (parsed.data) {
                    nextBreakdowns.push(parsed.data);
                }
                await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                    independent: {
                        ...independent,
                        incomeBreakdowns: nextBreakdowns,
                    },
                });
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            finally {
                setSaving(false);
            }
        };
        return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    setOpenEditorCell((current) => current?.id === cellId && current.field === cellField ? null : current);
                }
            }}>
      <PopoverTrigger asChild>
        <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, cellField)}>
          {displayMoneyValue(getIndependentColumnTotal(entry, field))}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-72 space-y-3 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-sm font-medium">{config.label} Breakdown</div>

        {config.categories.includes("services") && (<div>
            <label className="text-xs text-muted-foreground">Services</label>
            <Input value={services} onChange={(e) => setServices(e.target.value)}/>
          </div>)}
        {config.categories.includes("tips") && (<div>
            <label className="text-xs text-muted-foreground">Tips</label>
            <Input value={tips} onChange={(e) => setTips(e.target.value)}/>
          </div>)}
        {config.categories.includes("products") && (<div>
            <label className="text-xs text-muted-foreground">Products</label>
            <Input value={products} onChange={(e) => setProducts(e.target.value)}/>
          </div>)}
        {config.categories.includes("other") && (<div>
            <label className="text-xs text-muted-foreground">Other</label>
            <Input value={other} onChange={(e) => setOther(e.target.value)}/>
          </div>)}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-sm font-medium">{formatCurrency(total)}</span>
        </div>

        <Button size="sm" className="w-full" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Breakdown"}
        </Button>
      </GridEditorPopoverContent>
    </Popover>);
    };
    const TipBreakdownCell = ({ entry, paymentMethod, label, }: {
        entry: EntryType;
        paymentMethod: "card" | "cash";
        label: string;
    }) => {
        const cellField = `tips.${paymentMethod}`;
        const cellId = entry.id ?? `${entry.date ?? "entry"}-${cellField}`;
        const isOpen = openEditorCell?.id === cellId && openEditorCell.field === cellField;
        const isArmed = armedCell?.id === cellId && armedCell.field === cellField;
        const independent = entry.independent;
        const existingBreakdowns = independent?.incomeBreakdowns ?? [];
        const currentValue = getIncomeBreakdownTotalForPaymentMethodAndCategory(independent, paymentMethod, "tips");
        const [value, setValue] = useState(currentValue > 0 ? currentValue.toFixed(2) : "");
        const [saving, setSaving] = useState(false);
        const save = async () => {
            if (!entry.id || !independent)
                return;
            const numericValue = Number(value || 0);
            if (Number.isNaN(numericValue) || numericValue < 0) {
                alert(`Invalid ${label.toLowerCase()} amount`);
                return;
            }
            setSaving(true);
            try {
                const nextBreakdowns = existingBreakdowns.filter((item) => !(item.paymentMethod === paymentMethod && Number(item.tips ?? 0) > 0));
                if (numericValue > 0) {
                    nextBreakdowns.push({
                        paymentMethod,
                        tips: numericValue,
                    });
                }
                await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                    independent: {
                        ...independent,
                        incomeBreakdowns: nextBreakdowns,
                    },
                });
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            finally {
                setSaving(false);
            }
        };
        return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    setOpenEditorCell((current) => current?.id === cellId && current.field === cellField ? null : current);
                }
            }}>
      <PopoverTrigger asChild>
        <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, cellField)}>
          {displayMoneyValue(currentValue)}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="space-y-3">
          <div className="text-sm font-medium">{label}</div>
          <Input value={value} onChange={(e) => setValue(e.target.value)}/>
          <Button size="sm" className="w-full" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </GridEditorPopoverContent>
    </Popover>);
    };
    /** Hours cell — fully corrected for W2 + Independent modes */
    const HoursCell = ({ entry }: {
        entry: EntryType;
    }) => {
        const isW2 = entry.workspace === "w2";
        const isInd = entry.workspace === "independent";
        const cellField = isW2 ? "w2.hours" : "independent.hours";
        const cellId = entry.id ?? `${entry.date ?? "entry"}-${cellField}`;
        const isOpen = openEditorCell?.id === cellId && openEditorCell.field === cellField;
        const isArmed = armedCell?.id === cellId && armedCell.field === cellField;
        // ----- W2 STATE -----
        const [hoursW2, setHoursW2] = useState(entry.totals?.paidHours != null ? entry.totals.paidHours.toFixed(2) : "");
        const [inVal, setInVal] = useState(entry.w2?.inTime ?? "");
        const [outVal, setOutVal] = useState(entry.w2?.outTime ?? "");
        // ----- Independent STATE -----
        const [hoursInd, setHoursInd] = useState(entry.independent?.hours != null
            ? entry.independent.hours.toFixed(2)
            : "");
        const [saving, setSaving] = useState(false);
        /* ============================================================
         *  W2 — SAVE MANUAL HOURS
         * ============================================================ */
        const saveManualW2 = async () => {
            if (!entry.id)
                return;
            const parsed = Number(hoursW2);
            const result = FieldSchemas["w2.hours"].safeParse(parsed);
            if (!result.success) {
                alert(result.error.issues[0]?.message ?? "Invalid hours");
                return;
            }
            setSaving(true);
            try {
                await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                    w2: { hours: result.data }
                });
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            catch (err) {
            }
            finally {
                setSaving(false);
            }
        };
        /* ============================================================
         *  W2 — SAVE IN/OUT TIMES
         * ============================================================ */
        const saveTimesW2 = async () => {
            if (!entry.id)
                return;
            setSaving(true);
            try {
                await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                    w2: {
                        inTime: inVal,
                        outTime: outVal
                    }
                });
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            catch (err) {
            }
            finally {
                setSaving(false);
            }
        };
        /* ============================================================
         *  INDEPENDENT — SAVE MANUAL HOURS
         * ============================================================ */
        const saveManualInd = async () => {
            if (!entry.id)
                return;
            const parsed = Number(hoursInd);
            const result = FieldSchemas["independent.hours"].safeParse(parsed);
            if (!result.success) {
                alert(result.error.issues[0]?.message ?? "Invalid hours");
                return;
            }
            setSaving(true);
            try {
                await entriesService.updateEntry(activeWorkspaceId, entry.id, {
                    independent: { hours: result.data }
                });
                setOpenEditorCell(null);
                setArmedCell(null);
            }
            catch (err) {
            }
            finally {
                setSaving(false);
            }
        };
        /* ============================================================
         *  RENDER — INDEPENDENT MODE (ONLY MANUAL HOURS)
         * ============================================================ */
        if (isInd) {
            return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setOpenEditorCell((current) => current?.id === cellId && current.field === cellField ? null : current);
                    }
                }}>
        <PopoverTrigger asChild>
          <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, cellField)}>
            {displayNumberValue(Number(hoursInd))}
          </button>
        </PopoverTrigger>

        <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex items-center gap-3 w-full">
            <div className="relative flex-1">
              <input type="text" value={hoursInd} onChange={(e) => setHoursInd(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
            </div>

            <button onClick={saveManualInd} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </GridEditorPopoverContent>
      </Popover>);
        }
        /* ============================================================
         *  RENDER — W2 MODE (TIMES POPUP or MANUAL HOURS)
         * ============================================================ */
        const hasTimes = !!entry.w2?.inTime && !!entry.w2?.outTime;
        const paid = entry.totals?.paidHours ?? 0;
        const breakApplied = entry.w2?.breakDeduction === true;
        const breakMinutes = entry.w2?.breakMinutes ?? settings.w2?.breakMinutesDefault ?? 0;
        if (hasTimes) {
            return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setOpenEditorCell((current) => current?.id === cellId && current.field === cellField ? null : current);
                    }
                }}>
        <PopoverTrigger asChild>
          <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, cellField)}>
            {displayNumberValue(paid)}{paid > 0 ? " ⏰" : ""}
          </button>
        </PopoverTrigger>

        <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-64 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground">In</label>
              <Input value={inVal} onChange={(e) => setInVal(e.target.value)} placeholder="e.g. 4:00 PM"/>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Out</label>
              <Input value={outVal} onChange={(e) => setOutVal(e.target.value)} placeholder="e.g. 11:30 PM"/>
            </div>
            <div className="rounded-md border border-border bg-secondary/70 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={breakApplied} readOnly disabled className="h-4 w-4 accent-emerald-600"/>
                <span>
                  Break deduction {breakApplied ? "applied" : "not applied"}
                  {breakMinutes > 0 ? ` (${breakMinutes} min)` : ""}
                </span>
              </label>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveTimesW2} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </GridEditorPopoverContent>
      </Popover>);
        }
        /* ------- W2 MANUAL HOURS EDITOR ------- */
        return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    setOpenEditorCell((current) => current?.id === cellId && current.field === cellField ? null : current);
                }
            }}>
      <PopoverTrigger asChild>
        <button type="button" className={getEditableCellButtonClass(isArmed)} onClick={() => armOrOpenCell(cellId, cellField)}>
          {displayNumberValue(paid)}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-3 w-full">
          <div className="relative flex-1">
            <input type="text" value={hoursW2} onChange={(e) => setHoursW2(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
          </div>

          <button onClick={saveManualW2} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </GridEditorPopoverContent>
    </Popover>);
    };
    const ActionsMenu = ({ id }: {
        id: string;
    }) => (<Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground">
          <MoreVertical size={16}/>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-32 p-2 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Button variant="destructive" className="w-full" onClick={() => handleDelete(id)}>
          Delete Entry
        </Button>
      </PopoverContent>
    </Popover>);
    return (<div ref={gridRootRef} data-entries-grid-root="true" className="overflow-hidden rounded-lg border bg-card shadow-sm">
      {entriesLoading ? (<div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Refreshing entries…
        </div>) : null}

      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* border-separate for true column dividers */}
        <table className="min-w-[31rem] w-full border-separate border-spacing-0 border border-border divide-y divide-border sm:min-w-full">
          <thead className="sticky top-0 bg-muted border-b border-border">
            <tr className="divide-x divide-gray-300">
  {/* Notes column (if enabled) */}
  {showNotesColumn && (<th className={`${thBase} w-8 text-center`}></th>)}

  {/* Date (always shown) */}
  <th className={`${thBase} sticky left-0 z-10 bg-muted text-center whitespace-nowrap sm:text-left`}>Date</th>

    {/* ---------------------------- */}
    {/* W-2 HEADER LAYOUT           */}
    {/* ---------------------------- */}
        {visibility.mode === "w2" && (<>
    {/* TIPS */}
    {visibility.showTips && (<th className={`${thBase} text-center sm:text-right`}>
        <ResponsiveHeader desktopLabel="Tips"/>
      </th>)}

    {/* HOURS + RATE */}
    {visibility.showHours && (<>
        <th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Paid Hours" mobileLines={["Paid", "Hours"]}/>
        </th>

        {visibility.showRate && (<th className={`${thBase} text-center sm:text-right`}>
            <ResponsiveHeader desktopLabel="Rate"/>
          </th>)}
      </>)}

    {/* CASH FIELDS */}
    {visibility.showReportedCash && (<th className={`${thBase} text-center sm:text-right`}>
        <ResponsiveHeader desktopLabel="Reported Cash" mobileLines={["Reported", "Cash"]}/>
      </th>)}

    {visibility.showUnreportedCash && (<th className={`${thBase} text-center sm:text-right`}>
        <ResponsiveHeader desktopLabel="Unreported Cash" mobileLines={["Unreported", "Cash"]}/>
      </th>)}

    {/* Day Total appears outside this block */}
  </>)}

  {/* ---------------------------- */}
  {/* INDEPENDENT HEADER LAYOUT   */}
  {/* ---------------------------- */}
  {visibility.mode === "independent" && (<>
      {independentColumns?.showHours && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Hours"/>
        </th>)}
      {independentColumns?.showTips && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Card Tips" mobileLines={["Card", "Tips"]}/>
        </th>)}
      {independentColumns?.showReportedCash && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Reported Cash" mobileLines={["Reported", "Cash"]}/>
        </th>)}
      {independentColumns?.showUnreportedCash && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Unreported Cash" mobileLines={["Unreported", "Cash"]}/>
        </th>)}
      {independentColumns?.showVenmo && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Venmo"/>
        </th>)}
      {independentColumns?.showAppleCash && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Apple Cash" mobileLines={["Apple", "Cash"]}/>
        </th>)}
      {independentColumns?.showZelle && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Zelle"/>
        </th>)}
      {independentColumns?.showPosSales && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="POS Sales" mobileLines={["POS", "Sales"]}/>
        </th>)}
      {independentColumns?.showCashSales && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Cash Sales" mobileLines={["Cash", "Sales"]}/>
        </th>)}
      {independentColumns?.showCustomIncome && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Custom"/>
        </th>)}
    </>)}

  {/* Total (always shown) */}
  <th className={`${thBase} text-center sm:text-right`}>
    <ResponsiveHeader desktopLabel="Day Total" mobileLines={["Day", "Total"]}/>
  </th>
    </tr>
    </thead>

          <tbody className="divide-y divide-gray-300">
            {sortedEntries.length === 0 ? (<tr>
                <td colSpan={totalColumnCount} className="text-center text-muted-foreground py-8 border border-border">
                  No entries yet. Add your first entry above.
                </td>
              </tr>) : (<>
        {/* W2 ROWS */}
            {visibility.mode === "w2" &&
                sortedEntries.map((e) => {
                    if (e.workspace !== "w2")
                        return null;
                    const fullDay = computeIncomeGaugeForEntry(e, {
                        includeUnreportedInUI: e.workspace === "w2"
                            ? settings.w2?.includeUnreportedInUI ?? false
                            : settings.independent?.includeUnreportedInUI ?? false
                    });
                    return (<tr key={e.id} className="bg-card even:bg-secondary/55 divide-x divide-border">
        {showNotesColumn && (<td className="text-center w-8">
            {e.notes ? (<Popover>
                <PopoverTrigger asChild>
                  <button className="text-blue-500 hover:text-blue-600" title="View note">
                    <MessageCircle className="h-5 w-5" aria-hidden="true"/>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="rounded-2xl border border-border bg-popover text-popover-foreground shadow-md p-3 max-w-xs">
                  <p className="whitespace-pre-wrap">{e.notes}</p>
                </PopoverContent>
              </Popover>) : (<span className="inline-flex text-muted-foreground opacity-30" title="No note">
                <MessageCircle className="h-5 w-5" aria-hidden="true"/>
              </span>)}
          </td>)}

        {/* Date */}
        <td className={`${tdBase} sticky left-0 z-[1] bg-card text-center leading-tight py-1 whitespace-nowrap sm:text-left`}>
          {formatShortDate(e.date)}
        </td>

        {/* Tips */}
        {visibility.showTips && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
            <NumericCell entry={e} field="w2.tips" prefix="$"/>
          </td>)}

        {/* Hours + Rate */}
        {usingHours && (<>
            <td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
              <HoursCell entry={e}/>
            </td>
            {visibility.showRate && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
                <NumericCell entry={e} field="w2.rate" prefix="$"/>
              </td>)}
          </>)}

        {/* Reported Cash */}
        {visibility.showReportedCash && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
            <NumericCell entry={e} field="w2.reportedCash" prefix="$"/>
          </td>)}

        {/* Unreported Cash */}
        {visibility.showUnreportedCash && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
            <NumericCell entry={e} field="w2.unreportedCash" prefix="$"/>
          </td>)}

        {/* Day Total + Actions */}
        <td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right text-emerald-600 font-semibold leading-tight py-1`}>
          <div className="relative min-h-6 pr-5 sm:pr-6">
            <span className="block w-full text-center sm:text-right">{formatCurrency(fullDay)}</span>
            {e.id && <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <ActionsMenu id={e.id}/>
              </div>}
          </div>
        </td>
      </tr>);
                })}
    {/* INDEPENDENT ROWS */}
            {visibility.mode === "independent" &&
                sortedEntries.map((e) => {
                    if (e.workspace !== "independent")
                        return null;
                    return (<tr key={e.id} className="bg-card even:bg-secondary/55 divide-x divide-border">
    {/* Notes */}
    {showNotesColumn && (<td className="text-center w-8">
        {e.notes ? (<Popover>
            <PopoverTrigger asChild>
              <button className="text-blue-500 hover:text-blue-600" title="View note">
                <MessageCircle className="h-5 w-5" aria-hidden="true"/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="rounded-2xl border border-border bg-popover text-popover-foreground shadow-md p-3 max-w-xs">
              <p className="whitespace-pre-wrap">{e.notes}</p>
            </PopoverContent>
          </Popover>) : (<span className="inline-flex text-muted-foreground opacity-30" title="No note">
            <MessageCircle className="h-5 w-5" aria-hidden="true"/>
          </span>)}
      </td>)}

    {/* Date */}
    <td className={`${tdBase} sticky left-0 z-[1] bg-card text-center leading-tight py-1 whitespace-nowrap sm:text-left`}>
      {formatShortDate(e.date)}
    </td>

    {/* Hours */}
    {independentColumns?.showHours && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <HoursCell entry={e}/>
      </td>)}

    {independentColumns?.showTips && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <TipBreakdownCell entry={e} paymentMethod="card" label="Credit Card Tips"/>
      </td>)}

    {independentColumns?.showReportedCash && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <TipBreakdownCell entry={e} paymentMethod="cash" label="Reported Cash"/>
      </td>)}

    {independentColumns?.showUnreportedCash && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <NumericCell entry={e} field="independent.unreportedCash" prefix="$"/>
      </td>)}

    {/* Venmo */}
    {independentColumns?.showVenmo && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="venmo"/>
      </td>)}

    {/* Apple Cash */}
    {independentColumns?.showAppleCash && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="appleCash"/>
      </td>)}

    {independentColumns?.showZelle && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="zelle"/>
      </td>)}

    {/* POS Sales */}
    {independentColumns?.showPosSales && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="posSales"/>
      </td>)}

    {/* Cash Sales */}
    {independentColumns?.showCashSales && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="cashSales"/>
      </td>)}

    {/* Custom Income Total */}
    {independentColumns?.showCustomIncome && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        {formatCurrency((e.independent?.customIncome || []).reduce((sum: number, ci: {
                                amount?: number;
                            }) => sum + (ci.amount ?? 0), 0))}
      </td>)}

                    {/* Day Total + Actions */}
                    <td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right text-emerald-600 font-semibold leading-tight py-1`}>
  <div className="relative min-h-6 pr-5 sm:pr-6">
  <span className="block w-full text-center sm:text-right">
    {formatCurrency(computeIncomeGaugeForEntry(e, {
                            includeUnreportedInUI: settings.independent?.includeUnreportedInUI ?? false,
                        }))}
  </span>
  {e.id && <div className="absolute right-0 top-1/2 -translate-y-1/2">
      <ActionsMenu id={e.id}/>
    </div>}
  </div>
                    </td>
  </tr>);
                })}
  </>)}
    </tbody>
    <tfoot className="border-t border-border bg-secondary/70">
  <tr className="divide-x divide-border text-[13px] font-medium text-foreground sm:text-sm">

    {/* NOTES SPACER (if used) */}
    {showNotesColumn && <td className="px-2 py-2 text-center"></td>}

    {/* LABEL */}
    <td className="sticky left-0 z-[1] bg-secondary/70 px-2 py-1.5 font-semibold whitespace-nowrap text-center sm:text-left">Totals</td>

    {/* =========================== */}
    {/* W2 TOTALS SECTION           */}
    {/* =========================== */}
    {visibility.mode === "w2" && (<>
        {visibility.showTips && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.tips)}
          </td>)}

        {visibility.showHours && (<>
            <td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
              {totals.paidHours.toFixed(2)}
            </td>
            {visibility.showRate && <td className="px-2 py-1.5"></td>}
          </>)}

        {visibility.showReportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.reportedCash)}
          </td>)}

        {visibility.showUnreportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.unreportedCash)}
          </td>)}
      </>)}

    {/* =========================== */}
    {/* INDEPENDENT TOTALS SECTION  */}
    {/* =========================== */}
    {visibility.mode === "independent" && (<>
        {/* Hours */}
        {independentColumns?.showHours && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {totals.paidHours.toFixed(2)}
          </td>)}

        {independentColumns?.showTips && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.tips)}
          </td>)}

        {independentColumns?.showReportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.reportedCash)}
          </td>)}

        {independentColumns?.showUnreportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.unreportedCash)}
          </td>)}

        {/* Venmo */}
        {independentColumns?.showVenmo && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.venmo)}
          </td>)}

        {/* Apple Cash */}
        {independentColumns?.showAppleCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.appleCash)}
          </td>)}

        {independentColumns?.showZelle && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.zelle)}
          </td>)}

        {/* POS */}
        {independentColumns?.showPosSales && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.posSales)}
          </td>)}

        {/* Cash Sales */}
        {independentColumns?.showCashSales && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.cashSales)}
          </td>)}

        {/* Custom Income */}
        {independentColumns?.showCustomIncome && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white">
            {formatCurrency(totals.customIncome)}
          </td>)}
      </>)}

    {/* =========================== */}
    {/* ALWAYS SHOWN — COMBINED DAY TOTAL */}
    {/* =========================== */}
    <td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-emerald-700 font-semibold">
      {formatCurrency(totals.dayTotal)}
    </td>
  </tr>
    </tfoot>

        </table>
      </div>
    </div>);
}
