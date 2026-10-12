"use client";
// The entries grid's tap-to-edit pop-ups, shared with the home page's income
// streams (income-streams-overview.tsx) so a day under a stream edits the
// same way its grid cell does. Each editor saves one field (or one income
// source's lines) of one entry. Opening/closing is controlled by the caller:
// the grid arms a cell on the first tap and opens it on the second, a stream
// row opens on the first tap.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { formatCurrency } from "@/lib/helpers";
import { EntryType, FieldSchemas, IncomeBreakdownSchema, type IncomeCategory, } from "@shared/schemas/entry";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { GridEditorPopoverContent } from "@/components/grid-editor-popover-content";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import * as entriesService from "@/lib/domain/entriesService";
import { CUSTOM_POSITION_ID, CUSTOM_POSITION_TITLE } from "@shared/hourlyRates";
import { aggregateIncomeBreakdowns, getCustomIncomeMirrors, getNonCustomOtherIncome, } from "@shared/independentIncome";
import { toast } from "@/hooks/use-toast";

export const paymentFieldConfig = {
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
        label: "Card / POS Sales",
        paymentMethod: "pos",
        categories: ["services", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    cashSales: {
        label: "Cash",
        paymentMethod: "cash",
        categories: ["services", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
    // "Other" money with no name — bank deposits confirmed as "Paid via:
    // Other" without a "Who paid you?" (or before that existed). Named other
    // income is custom income, shown in the Other income column.
    otherIncome: {
        label: "Unnamed deposits",
        paymentMethod: "other",
        categories: ["services", "tips", "products", "other"] as IncomeCategory[],
        defaultCategory: "services" as IncomeCategory,
    },
} as const;
export type PaymentField = keyof typeof paymentFieldConfig;

export function displayMoneyValue(value: number | undefined, prefix = "", decimals = 2) {
    if (typeof value !== "number" || Math.abs(value) < 0.0001) {
        return "--";
    }
    return prefix + value.toFixed(decimals);
}
export function displayNumberValue(value: number | undefined, decimals = 2) {
    if (typeof value !== "number" || Math.abs(value) < 0.0001) {
        return "--";
    }
    return value.toFixed(decimals);
}
// Which stored breakdown lines each column covers. Tips are a category of
// every source (see paymentCategoryConfig in lib/incomeBreakdown.ts), so the
// Card / POS column includes card tips and the Cash column cash tips. Any
// "card" line — old card tips, or a deposit marked "Card" — is card money
// and belongs to Card / POS. The Other / Bank column is special: its lines
// are shared with custom income's mirrors, handled in BreakdownCellEditor.
export function belongsToColumn(item: { paymentMethod: string }, field: PaymentField) {
    if (field === "posSales")
        return item.paymentMethod === "pos" || item.paymentMethod === "card";
    return item.paymentMethod === paymentFieldConfig[field].paymentMethod;
}
export function getColumnBreakdown(independent: EntryType["independent"] | undefined, field: PaymentField) {
    if (field === "otherIncome")
        return getNonCustomOtherIncome(independent);
    return aggregateIncomeBreakdowns((independent?.incomeBreakdowns ?? []).filter((item) => belongsToColumn(item, field)));
}
export function getIndependentColumnTotal(entry: EntryType, field: PaymentField) {
    return entry.independent ? getColumnBreakdown(entry.independent, field).total : 0;
}

type WorkspaceIdArg = Parameters<typeof entriesService.updateEntry>[0];

/** Open/close wiring every editor takes from its caller. */
export type CellEditorControl = {
    workspaceId: WorkspaceIdArg;
    isOpen: boolean;
    /** The pop-up asked to close (tap outside, Escape). */
    onClose: () => void;
    /** The trigger was tapped. */
    onTriggerClick: () => void;
    /** A save finished — the caller closes the pop-up (and disarms). */
    onSaved: () => void;
    triggerClassName: string;
    /** Trigger content; defaults to the grid's plain value. */
    trigger?: ReactNode;
};

function savedFailedToast(description = "We could not save this change. Please try again.") {
    toast({
        title: "Save failed",
        description,
        variant: "destructive",
    });
}

/** Generic numeric editor for inline cells (tips, rate, cash, etc.) */
export function NumericCellEditor({ entry, field, prefix = "", decimals = 2, workspaceId, isOpen, onClose, onTriggerClick, onSaved, triggerClassName, trigger, }: CellEditorControl & {
    entry: EntryType;
    field: string;
    prefix?: string;
    decimals?: number;
}) {
    // Always track the latest entry so save closures never use stale data.
    const entryRef = useRef(entry);
    useEffect(() => { entryRef.current = entry; }, [entry]);
    // ------------------------------------------------------------
    // Resolve nested fields like "w2.tips" or "independent.venmo"
    // ------------------------------------------------------------
    const resolvedValue: any = field.includes(".")
        ? field.split(".").reduce((acc: any, key) => (acc == null ? undefined : acc[key]), entry)
        : (entry as any)[field];
    const initial = typeof resolvedValue === "number"
        ? resolvedValue.toFixed(decimals)
        : "";
    const [val, setVal] = useState(initial);
    const [saving, setSaving] = useState(false);
    // Reset input when the entry changes while the editor is closed.
    useEffect(() => {
        if (isOpen) return;
        const live: any = field.includes(".")
            ? field.split(".").reduce((acc: any, k) => (acc == null ? undefined : acc[k]), entryRef.current)
            : (entryRef.current as any)[field];
        setVal(typeof live === "number" ? live.toFixed(decimals) : "");
    }, [entry]);
    // ------------------------------------------------------------
    // Save handler — sends only the changed field; updateEntry merges
    // the patch against live store state internally (HR-2).
    // ------------------------------------------------------------
    const save = async () => {
        if (!entryRef.current.id)
            return;
        const schema = FieldSchemas[field as keyof typeof FieldSchemas];
        const parsed = schema.safeParse(val);
        if (!parsed.success) {
            alert(parsed.error.issues[0]?.message ?? "Invalid value");
            return;
        }
        setSaving(true);
        try {
            if (field.includes(".")) {
                const [root, key] = field.split(".");
                // A hand-edited rate no longer matches the position it was
                // entered under, so the entry becomes Custom.
                const rateChanged = field === "w2.rate" &&
                    Number(parsed.data) !== Number(entryRef.current.w2?.rate ?? NaN);
                await entriesService.updateEntry(workspaceId, entryRef.current.id, {
                    [root]: {
                        [key]: parsed.data,
                        ...(rateChanged && { positionId: CUSTOM_POSITION_ID, positionTitle: CUSTOM_POSITION_TITLE }),
                    },
                });
            } else {
                await entriesService.updateEntry(workspaceId, entryRef.current.id, {
                    [field]: parsed.data,
                });
            }
            onSaved();
        } catch (err) {
            savedFailedToast();
        } finally {
            setSaving(false);
        }
    };
    // ------------------------------------------------------------
    // Display inside button (ALWAYS use resolvedValue, not entry[field])
    // ------------------------------------------------------------
    const display = displayMoneyValue(typeof resolvedValue === "number" ? resolvedValue : undefined, prefix, decimals);
    return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
            if (!nextOpen)
                onClose();
        }}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName} onClick={onTriggerClick}>
          {trigger ?? display}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-3 w-full">
          <div className="relative flex-1">
            <input type="text" value={val} onChange={(e) => setVal(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
          </div>

          <button onClick={save} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </GridEditorPopoverContent>
    </Popover>);
}

/** One income source (a grid column) of one entry, split into categories. */
export function BreakdownCellEditor({ entry, field, tipsEnabled, workspaceId, isOpen, onClose, onTriggerClick, onSaved, triggerClassName, trigger, }: CellEditorControl & {
    entry: EntryType;
    field: PaymentField;
    /** "Receives Tips" — offers a Tips box in every income source's editor. */
    tipsEnabled: boolean;
}) {
    const config = paymentFieldConfig[field];
    // Always track the latest entry so the save closure reads live breakdowns.
    const entryRef = useRef(entry);
    useEffect(() => { entryRef.current = entry; }, [entry]);
    const independent = entry.independent;
    const aggregated = getColumnBreakdown(independent, field);
    // "Receives Tips" — or tips already recorded, so they stay editable.
    const showTipsBox = tipsEnabled || aggregated.tips > 0;
    const tipsOnTop = field === "posSales" || field === "cashSales";
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
    // Reset inputs when entry changes while editor is closed.
    useEffect(() => {
        if (isOpen) return;
        const liveIndependent = entryRef.current.independent;
        const liveAgg = getColumnBreakdown(liveIndependent, field);
        setServices(liveAgg.services > 0 ? liveAgg.services.toFixed(2) : "");
        setTips(liveAgg.tips > 0 ? liveAgg.tips.toFixed(2) : "");
        setProducts(liveAgg.products > 0 ? liveAgg.products.toFixed(2) : "");
        setOther(liveAgg.other > 0 ? liveAgg.other.toFixed(2) : "");
    }, [entry]);
    const total = Number(services || 0) +
        Number(tips || 0) +
        Number(products || 0) +
        Number(other || 0);
    const save = async () => {
        const latestEntry = entryRef.current;
        if (!latestEntry.id || !latestEntry.independent)
            return;
        const breakdownCandidate = {
            paymentMethod: config.paymentMethod,
            services: config.categories.includes("services") && Number(services || 0) > 0
                ? Number(services || 0)
                : undefined,
            tips: showTipsBox && Number(tips || 0) > 0
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
            // Use live entry breakdowns to avoid overwriting concurrent edits.
            const liveBreakdowns = latestEntry.independent.incomeBreakdowns ?? [];
            // Replace everything this column covers (card lines are saved
            // back as Card / POS). "Other" lines also carry custom income,
            // so the Other / Bank column rebuilds those mirrors from the
            // customIncome list and replaces only the rest.
            const nextBreakdowns = field === "otherIncome"
                ? [
                    ...liveBreakdowns.filter((item) => item.paymentMethod !== "other"),
                    ...getCustomIncomeMirrors(latestEntry.independent),
                ]
                : liveBreakdowns.filter((item) => !belongsToColumn(item, field));
            if (parsed.data) {
                nextBreakdowns.push(parsed.data);
            }
            await entriesService.updateEntry(workspaceId, latestEntry.id, {
                independent: { incomeBreakdowns: nextBreakdowns },
            });
            onSaved();
        } catch (err) {
            savedFailedToast();
        } finally {
            setSaving(false);
        }
    };
    return (<Popover open={isOpen} onOpenChange={(nextOpen) => {
            if (!nextOpen)
                onClose();
        }}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName} onClick={onTriggerClick}>
          {trigger ?? displayMoneyValue(getIndependentColumnTotal(entry, field))}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-72 space-y-3 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-sm font-medium">{config.label} Breakdown</div>

        {config.categories.includes("services") && (<div>
            <label className="text-xs text-muted-foreground">Services</label>
            <Input value={services} onChange={(e) => setServices(e.target.value)}/>
          </div>)}
        {showTipsBox && !tipsOnTop && (<div>
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
        {showTipsBox && tipsOnTop && (<div>
            <label className="text-xs text-muted-foreground">+ Tips (on top of sales)</label>
            <Input value={tips} onChange={(e) => setTips(e.target.value)}/>
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
}

/** Hours — W-2 (times pop-up or manual hours) and independent (manual hours). */
export function HoursCellEditor({ entry, breakMinutesDefault, workspaceId, isOpen, onClose, onTriggerClick, onSaved, triggerClassName, trigger, }: CellEditorControl & {
    entry: EntryType;
    /** settings.w2.breakMinutesDefault, for the W-2 times pop-up. */
    breakMinutesDefault?: number;
}) {
    const isInd = entry.workspace === "independent";
    const entryRef = useRef(entry);
    useEffect(() => { entryRef.current = entry; }, [entry]);
    // ----- W2 STATE -----
    const [hoursW2, setHoursW2] = useState(entry.totals?.paidHours != null ? entry.totals.paidHours.toFixed(2) : "");
    const [inVal, setInVal] = useState(entry.w2?.inTime ?? "");
    const [outVal, setOutVal] = useState(entry.w2?.outTime ?? "");
    // ----- Independent STATE -----
    const [hoursInd, setHoursInd] = useState(entry.independent?.hours != null
        ? entry.independent.hours.toFixed(2)
        : "");
    const [saving, setSaving] = useState(false);
    // Reset inputs when entry changes while editor is closed.
    useEffect(() => {
        if (isOpen) return;
        const e = entryRef.current;
        setHoursW2(e.totals?.paidHours != null ? e.totals.paidHours.toFixed(2) : "");
        setInVal(e.w2?.inTime ?? "");
        setOutVal(e.w2?.outTime ?? "");
        setHoursInd(e.independent?.hours != null ? e.independent.hours.toFixed(2) : "");
    }, [entry]);
    /* ============================================================
     *  W2 — SAVE MANUAL HOURS
     * ============================================================ */
    const saveManualW2 = async () => {
        const id = entryRef.current.id;
        if (!id) return;
        const parsed = Number(hoursW2);
        const result = FieldSchemas["w2.hours"].safeParse(parsed);
        if (!result.success) {
            alert(result.error.issues[0]?.message ?? "Invalid hours");
            return;
        }
        setSaving(true);
        try {
            await entriesService.updateEntry(workspaceId, id, {
                w2: { hours: result.data },
            });
            onSaved();
        } catch (err) {
            savedFailedToast("We could not save hours. Please try again.");
        } finally {
            setSaving(false);
        }
    };
    /* ============================================================
     *  W2 — SAVE IN/OUT TIMES
     * ============================================================ */
    const saveTimesW2 = async () => {
        const id = entryRef.current.id;
        if (!id) return;
        setSaving(true);
        try {
            await entriesService.updateEntry(workspaceId, id, {
                w2: { inTime: inVal, outTime: outVal },
            });
            onSaved();
        } catch (err) {
            savedFailedToast("We could not save times. Please try again.");
        } finally {
            setSaving(false);
        }
    };
    /* ============================================================
     *  INDEPENDENT — SAVE MANUAL HOURS
     * ============================================================ */
    const saveManualInd = async () => {
        const id = entryRef.current.id;
        if (!id) return;
        const parsed = Number(hoursInd);
        const result = FieldSchemas["independent.hours"].safeParse(parsed);
        if (!result.success) {
            alert(result.error.issues[0]?.message ?? "Invalid hours");
            return;
        }
        setSaving(true);
        try {
            await entriesService.updateEntry(workspaceId, id, {
                independent: { hours: result.data },
            });
            onSaved();
        } catch (err) {
            savedFailedToast("We could not save hours. Please try again.");
        } finally {
            setSaving(false);
        }
    };
    const onOpenChange = (nextOpen: boolean) => {
        if (!nextOpen)
            onClose();
    };
    /* ============================================================
     *  RENDER — INDEPENDENT MODE (ONLY MANUAL HOURS)
     * ============================================================ */
    if (isInd) {
        return (<Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className={triggerClassName} onClick={onTriggerClick}>
            {trigger ?? displayNumberValue(Number(hoursInd))}
          </button>
        </PopoverTrigger>

        <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex items-center gap-3 w-full">
            <div className="relative flex-1">
              <input type="text" value={hoursInd} onChange={(e) => setHoursInd(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
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
    const breakMinutes = entry.w2?.breakMinutes ?? breakMinutesDefault ?? 0;
    if (hasTimes) {
        return (<Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className={triggerClassName} onClick={onTriggerClick}>
            {trigger ?? <>{displayNumberValue(paid)}{paid > 0 ? " ⏰" : ""}</>}
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
    return (<Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName} onClick={onTriggerClick}>
          {trigger ?? displayNumberValue(paid)}
        </button>
      </PopoverTrigger>

      <GridEditorPopoverContent data-grid-popover="entries" side="top" align="end" className="w-56 p-3 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-3 w-full">
          <div className="relative flex-1">
            <input type="text" value={hoursW2} onChange={(e) => setHoursW2(e.target.value)} className="w-full border rounded-md py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            <Pencil size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
          </div>

          <button onClick={saveManualW2} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </GridEditorPopoverContent>
    </Popover>);
}

/** The grid's "Delete Entry" — confirms, deletes, toasts on failure. */
export async function deleteEntryWithConfirm(workspaceId: string | null, entryId: string) {
    if (!confirm("Delete this entry?"))
        return;
    if (!workspaceId)
        return;
    try {
        await entriesService.removeEntry(workspaceId, entryId);
    } catch (error) {
        const isAuthError = error instanceof Error && error.message.includes("401");
        toast({
            title: "Entry not deleted",
            description: isAuthError
                ? "Your session expired. Please sign in again."
                : "We could not delete this entry. Please try again.",
            variant: "destructive",
        });
    }
}
