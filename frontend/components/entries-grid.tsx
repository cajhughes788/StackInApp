// /components/entries-grid.tsx
"use client";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { MessageCircle, MoreVertical } from "lucide-react";
import { formatCurrency, parseLocalDate } from "@/lib/helpers";
import { EntryType } from "@shared/schemas/entry";
import { resolveEntryGridVisibility } from "@shared/entryVisibility";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { thBase, tdBase } from "@/lib/tableStyles";
import { cn } from "@/lib/utils";
import {
    useEntriesData,
    useEntriesRenderState,
} from "@/lib/stores/useEntriesStore";
import {
    useSettingsData,
    useSettingsRenderState,
} from "@/lib/stores/useSettingsStore";
import { computeIncomeGaugeForEntry } from "@shared/computeIncomeGauge";
import { debugRender } from "@/lib/debugLoop";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import SyncStatusIndicator from "@/components/sync-status-indicator";
import { GridSkeleton } from "@/components/loading-skeletons";
import { BreakdownCellEditor, HoursCellEditor, NumericCellEditor, deleteEntryWithConfirm, getIndependentColumnTotal, type PaymentField, } from "@/components/entry-cell-editors";
// Short date formatter
const formatShortDate = (iso: string) => parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    const entries = useEntriesData(activeWorkspaceId);
    const {
        status: entriesStatus,
        isHydrating: entriesHydrating,
        isRevalidating: entriesRevalidating,
        lastSuccessfulSyncAt: entriesLastSuccessfulSyncAt,
    } = useEntriesRenderState(activeWorkspaceId);
    const settings = useSettingsData(activeWorkspaceId);
    const {
        status: settingsStatus,
        isHydrating: settingsHydrating,
    } = useSettingsRenderState(activeWorkspaceId);
    const isWorkspaceReady = workspaceState.status === "ready" && !!activeWorkspaceId && !!activeWorkspace;
    const hasRenderableEntries = entries.length > 0 || entriesLastSuccessfulSyncAt !== null;
    const hasRenderableSettings = settings !== null;
    debugRender("entries-grid", {
        workspaceId: activeWorkspaceId,
        workspaceType: activeWorkspace?.type ?? null,
        entriesStatus,
        settingsStatus,
        entriesCount: entries.length,
        hasSettings: settings !== null,
    });
    const gridRootRef = useRef<HTMLDivElement>(null);
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
    // "Receives Tips" — offers a Tips box in every income source's editor.
    const tipsEnabled = resolvedSettings.independent?.isTippedIndependent === true;
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
            showUnreportedCash: visibility.showUnreportedCash,
            showVenmo: visibility.showVenmo,
            showAppleCash: visibility.showAppleCash,
            showZelle: visibility.showZelle,
            showPosSales: visibility.showPosSales,
            showCashSales: visibility.showCashSales,
            showOtherIncome: visibility.showOtherIncome,
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
            otherIncome: number;
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
                acc.unreportedCash += e.independent?.unreportedCashTips ?? e.independent?.unreportedCash ?? 0;
                acc.venmo += getIndependentColumnTotal(e, "venmo");
                acc.appleCash += getIndependentColumnTotal(e, "appleCash");
                acc.zelle += getIndependentColumnTotal(e, "zelle");
                acc.posSales += getIndependentColumnTotal(e, "posSales");
                acc.cashSales += getIndependentColumnTotal(e, "cashSales");
                acc.otherIncome += getIndependentColumnTotal(e, "otherIncome");
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
            otherIncome: 0,
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
        if (independentColumns?.showOtherIncome)
            count += 1;
        if (independentColumns?.showCustomIncome)
            count += 1;
        return count;
    }, [showNotesColumn, visibility, independentColumns]);
    const handleDelete = useCallback((entryId: string) => deleteEntryWithConfirm(activeWorkspaceId, entryId), [activeWorkspaceId]);
    if (!isWorkspaceReady) {
        return <GridSkeleton label="Loading workspace…"/>;
    }
    if ((entriesHydrating && !hasRenderableEntries) || (settingsHydrating && !hasRenderableSettings)) {
        return <GridSkeleton label="Loading your entries…"/>;
    }
    if (!settings) {
        return (<div className="p-4 text-muted-foreground text-sm">
        Loading settings…
      </div>);
    }
    // The editors live in entry-cell-editors.tsx (shared with the home
    // page's income streams); these wire them to the grid's arm-then-open
    // taps. First tap arms a cell, the second opens its editor.
    const cellControl = (cellId: string, field: string) => {
        const isOpen = openEditorCell?.id === cellId && openEditorCell.field === field;
        const isArmed = armedCell?.id === cellId && armedCell.field === field;
        return {
            workspaceId: activeWorkspaceId,
            isOpen,
            onClose: () => setOpenEditorCell((current) => current?.id === cellId && current.field === field ? null : current),
            onTriggerClick: () => armOrOpenCell(cellId, field),
            onSaved: () => {
                setOpenEditorCell(null);
                setArmedCell(null);
            },
            triggerClassName: getEditableCellButtonClass(isArmed),
        };
    };
    /** Generic numeric editor for inline cells (tips, rate, cash, etc.) */
    const NumericCell = ({ entry, field, prefix = "", decimals = 2, }: {
        entry: EntryType;
        field: string;
        prefix?: string;
        decimals?: number;
    }) => entry.kind === "refund"
        ? <span className="block px-2 py-1 text-muted-foreground">—</span>
        : (<NumericCellEditor entry={entry} field={field} prefix={prefix} decimals={decimals} {...cellControl(entry.id ?? `${entry.date ?? "entry"}-${field}`, field)}/>);
    const BreakdownCell = ({ entry, field, }: {
        entry: EntryType;
        field: PaymentField;
    }) => {
        const cellField = `breakdown.${field}`;
        // Refunds are booked by the server against an invoice: shown, not
        // edited here (the row's Delete still works).
        if (entry.kind === "refund") {
            const value = getIndependentColumnTotal(entry, field);
            return (<span className={`block px-2 py-1 tabular-nums ${value < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} title="Refund">
            {value ? (value < 0 ? `−$${(-value).toFixed(2)}` : `$${value.toFixed(2)}`) : "—"}
          </span>);
        }
        return (<BreakdownCellEditor entry={entry} field={field} tipsEnabled={tipsEnabled} {...cellControl(entry.id ?? `${entry.date ?? "entry"}-${cellField}`, cellField)}/>);
    };
    /** Hours cell — fully corrected for W2 + Independent modes */
    const HoursCell = ({ entry }: {
        entry: EntryType;
    }) => {
        if (entry.kind === "refund")
            return <span className="block px-2 py-1 text-muted-foreground">Refund</span>;
        const cellField = entry.workspace === "w2" ? "w2.hours" : "independent.hours";
        return (<HoursCellEditor entry={entry} breakMinutesDefault={settings.w2?.breakMinutesDefault} {...cellControl(entry.id ?? `${entry.date ?? "entry"}-${cellField}`, cellField)}/>);
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
    return (<div ref={gridRootRef} data-entries-grid-root="true" className="relative overflow-hidden rounded-lg border bg-card shadow-sm">
      <SyncStatusIndicator visible={entriesRevalidating} label="Syncing entries"/>

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
        <ResponsiveHeader desktopLabel="Personal Cash" mobileLines={["Personal", "Cash"]}/>
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
      {independentColumns?.showUnreportedCash && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Personal Cash" mobileLines={["Personal", "Cash"]}/>
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
          <ResponsiveHeader desktopLabel="Card / POS" mobileLines={["Card /", "POS"]}/>
        </th>)}
      {independentColumns?.showCashSales && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Cash"/>
        </th>)}
      {independentColumns?.showOtherIncome && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Unnamed deposits" mobileLines={["Unnamed", "deposits"]}/>
        </th>)}
      {independentColumns?.showCustomIncome && (<th className={`${thBase} text-center sm:text-right`}>
          <ResponsiveHeader desktopLabel="Other income" mobileLines={["Other", "income"]}/>
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
                    return (<tr key={e.id} data-entry-date={e.date} className="bg-card even:bg-secondary/55 divide-x divide-border">
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

        {/* Personal Cash */}
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
                    return (<tr key={e.id} data-entry-date={e.date} className="bg-card even:bg-secondary/55 divide-x divide-border">
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

    {/* Other / Bank */}
    {independentColumns?.showOtherIncome && (<td className={`${tdBase} text-center tabular-nums whitespace-nowrap sm:text-right leading-tight py-1`}>
        <BreakdownCell entry={e} field="otherIncome"/>
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
        {visibility.showTips && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.tips)}
          </td>)}

        {visibility.showHours && (<>
            <td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
              {totals.paidHours.toFixed(2)}
            </td>
            {visibility.showRate && <td className="px-2 py-1.5"></td>}
          </>)}

        {visibility.showReportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.reportedCash)}
          </td>)}

        {visibility.showUnreportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.unreportedCash)}
          </td>)}
      </>)}

    {/* =========================== */}
    {/* INDEPENDENT TOTALS SECTION  */}
    {/* =========================== */}
    {visibility.mode === "independent" && (<>
        {/* Hours */}
        {independentColumns?.showHours && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {totals.paidHours.toFixed(2)}
          </td>)}

        {independentColumns?.showUnreportedCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.unreportedCash)}
          </td>)}

        {/* Venmo */}
        {independentColumns?.showVenmo && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.venmo)}
          </td>)}

        {/* Apple Cash */}
        {independentColumns?.showAppleCash && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.appleCash)}
          </td>)}

        {independentColumns?.showZelle && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.zelle)}
          </td>)}

        {/* POS */}
        {independentColumns?.showPosSales && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.posSales)}
          </td>)}

        {/* Cash Sales */}
        {independentColumns?.showCashSales && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.cashSales)}
          </td>)}

        {/* Other / Bank */}
        {independentColumns?.showOtherIncome && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.otherIncome)}
          </td>)}

        {/* Custom Income */}
        {independentColumns?.showCustomIncome && (<td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-foreground/80">
            {formatCurrency(totals.customIncome)}
          </td>)}
      </>)}

    {/* =========================== */}
    {/* ALWAYS SHOWN — COMBINED DAY TOTAL */}
    {/* =========================== */}
    <td className="px-2 py-1.5 text-center sm:text-right tabular-nums whitespace-nowrap text-emerald-700 dark:text-emerald-400 font-semibold">
      {formatCurrency(totals.dayTotal)}
    </td>
  </tr>
    </tfoot>

        </table>
      </div>
    </div>);
}
