// /components/income-gauge.tsx
"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/helpers";
import { calculateNetPay } from "@shared/tax/engine";
import { buildTaxProfileInput } from "@shared/tax/buildTaxProfileInput";
import {
    useEntriesData,
    useEntriesRenderState,
} from "@/lib/stores/useEntriesStore";
import {
    useSettingsData,
    useSettingsRenderState,
} from "@/lib/stores/useSettingsStore";
import {
    useTaxProfileData,
    useTaxProfileRenderState,
} from "@/lib/stores/useTaxProfileStore";
import { computeIncomeGaugeForEntries } from "@shared/computeIncomeGauge";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import SyncStatusIndicator from "@/components/sync-status-indicator";
import { TotalCardSkeleton } from "@/components/loading-skeletons";
import Expand from "@/components/expand";
import PeriodSelector from "@/components/period-selector";
import { getEntryGross } from "@shared/entryPay";
export default function IncomeGauge() {
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const entries = useEntriesData(activeWorkspaceId);
    const { isHydrating: entriesHydrating, isRevalidating: entriesRevalidating, lastSuccessfulSyncAt: entriesLastSuccessfulSyncAt } = useEntriesRenderState(activeWorkspaceId);
    const settings = useSettingsData(activeWorkspaceId);
    const { isHydrating: settingsHydrating, isRevalidating: settingsRevalidating } = useSettingsRenderState(activeWorkspaceId);
    const taxProfile = useTaxProfileData(activeWorkspaceId);
    const { isRevalidating: taxRevalidating } = useTaxProfileRenderState(activeWorkspaceId);
    const hasRenderableEntries = entries.length > 0 || entriesLastSuccessfulSyncAt !== null;
    const hasRenderableSettings = settings !== null;
    const showSyncIndicator = entriesRevalidating || settingsRevalidating || taxRevalidating;
    const [netPreview, setNetPreview] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [previewMessage, setPreviewMessage] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    // ------------------------------------------------------------
    // Compute income gauge totals across entries
    // ------------------------------------------------------------
    const totals = useMemo(() => {
        if (!entries?.length || !settings || !activeWorkspace) {
            return {
                incomeGauge: 0,
                hours: 0,
                daysWorked: 0,
                avgPerDay: 0,
                avgPerHour: 0,
            };
        }
        return computeIncomeGaugeForEntries(entries, {
            includeUnreportedInUI: activeWorkspace.type === "w2"
                ? settings.w2?.includeUnreportedInUI ?? false
                : settings.independent?.includeUnreportedInUI ?? false,
        });
    }, [entries, settings, activeWorkspace]);
    const previewGrossIncome = useMemo(() => entries.reduce((sum, entry) => {
        return sum + getEntryGross(entry);
    }, 0), [entries]);
    const previewCustomDeductions = useMemo(() => entries.reduce((sum, entry) => {
        return sum + Number(entry.totals?.customDeductionsAmount ?? 0);
    }, 0), [entries]);
    // ------------------------------------------------------------
    // Net Pay Preview — PATCH 1 + PATCH 2
    // ------------------------------------------------------------
    async function handlePreviewNet() {
        // UPDATED: require W-2 mode + correct toggle + taxProfile
        if (activeWorkspace?.type !== "w2") {
            setPreviewMessage("Net pay preview is only available for W-2 workspaces.");
            return;
        }
        if (!settings?.w2?.autoTaxCalculation) {
            setPreviewMessage("Enable auto tax calculation in settings to preview net pay.");
            return;
        }
        if (!taxProfile) {
            setPreviewMessage("Complete your tax profile to preview net pay.");
            return;
        }
        try {
            setIsLoading(true);
            setPreviewMessage(null);
            const profile = (taxProfile as any)?.taxProfile ?? taxProfile;
            if ((profile.state === "Maryland" || profile.residenceState === "Maryland")
                && !(profile.residenceCounty ?? "").trim()) {
                setPreviewMessage("Add your Maryland residence county in tax settings to preview net pay.");
                return;
            }
            // UPDATED (PATCH 2): explicit W-2 payFrequency selection
            const payFrequency: "weekly" | "biweekly" | "semi-monthly" | "monthly" = settings?.w2?.payFrequency ?? "biweekly";
            const payload = buildTaxProfileInput(profile, {
                grossIncome: previewGrossIncome,
                payFrequency,
                customDeductions: previewCustomDeductions,
            });
            const result = calculateNetPay(payload);
            setNetPreview(result.netIncome);
        }
        catch (err) {
            setPreviewMessage("Unable to calculate net pay right now.");
        }
        finally {
            setIsLoading(false);
        }
    }
    // ------------------------------------------------------------
    // Auto-hide net preview on scroll
    // ------------------------------------------------------------
    useEffect(() => {
        function handleScroll() {
            if (netPreview !== null || previewMessage !== null) {
                setNetPreview(null);
                setPreviewMessage(null);
            }
        }
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, [netPreview, previewMessage]);
    useEffect(() => {
        function handlePointerDown(event: PointerEvent) {
            if (!previewRef.current) {
                return;
            }
            if (!previewRef.current.contains(event.target as Node)) {
                setNetPreview(null);
                setPreviewMessage(null);
            }
        }
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, []);
    // ------------------------------------------------------------
    // Goal progress (falls back to a $5000 scale with no goal set)
    // ------------------------------------------------------------
    const maxAmount = 5000;
    const targetIncome = settings?.w2?.incomeTargetPerPeriod && settings.w2.incomeTargetPerPeriod > 0
        ? settings.w2.incomeTargetPerPeriod
        : null;
    const gaugeScale = targetIncome ?? maxAmount;
    const fillPercentage = Math.min((totals.incomeGauge / gaugeScale) * 100, 100);
    // ------------------------------------------------------------
    // Loading States
    // ------------------------------------------------------------
    if (workspaceState.status !== "ready" ||
        !activeWorkspaceId ||
        !activeWorkspace ||
        (entriesHydrating && !hasRenderableEntries) ||
        (settingsHydrating && !hasRenderableSettings)) {
        return <TotalCardSkeleton label="Loading pay summary…"/>;
    }
    // ------------------------------------------------------------
    // RENDER — laid out like the independent total card
    // (income-streams-overview.tsx): period, headline gross, goal, and the
    // day stats behind "Details".
    // ------------------------------------------------------------
    const goalShare = targetIncome ? totals.incomeGauge / targetIncome : 0;
    return (<div ref={previewRef} className="relative rounded-[22px] bg-card p-5">
      <SyncStatusIndicator visible={showSyncIndicator} label="Syncing pay summary"/>

      <PeriodSelector />

      <button type="button" onClick={() => setDetailsOpen((current) => !current)} aria-expanded={detailsOpen} className="flex w-full items-end justify-between gap-3 text-left">
        <span>
          <span className="block text-sm text-muted-foreground">Gross pay this period</span>
          <span className="block text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
            {formatCurrency(totals.incomeGauge)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 pb-1.5 text-sm font-medium text-primary">
          {targetIncome ? `${Math.round(goalShare * 100)}% of goal` : "Details"}
          <ChevronDown className={`size-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden="true"/>
        </span>
      </button>

      {/* --- Take-home preview --- */}
      {activeWorkspace.type === "w2" && settings?.w2?.autoTaxCalculation && (<div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
          {netPreview !== null && !isLoading ? (<span className="text-muted-foreground">
              Take-home about <span className="font-medium tabular-nums text-foreground">{formatCurrency(netPreview)}</span>
            </span>) : (<button type="button" onClick={handlePreviewNet} disabled={isLoading} className="font-medium text-primary">
              {isLoading ? "Calculating…" : "See take-home"}
            </button>)}
        </div>)}

      {previewMessage && (<div className="mt-1 text-sm text-muted-foreground">
          {previewMessage}
        </div>)}

      <Expand open={detailsOpen} className="mt-4 space-y-4">
          {targetIncome ? (<div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${fillPercentage}%` }}/>
              </div>
              <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>{formatCurrency(totals.incomeGauge)}</span>
                <span>Goal {formatCurrency(targetIncome)}</span>
              </div>
            </div>) : null}
          <dl className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl bg-muted py-3 text-center">
            <div className="flex flex-col-reverse">
              <dt className="text-xs text-muted-foreground">Days worked</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{totals.daysWorked}</dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="text-xs text-muted-foreground">Avg / day</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(totals.avgPerDay)}</dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="text-xs text-muted-foreground">Avg / hour</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(totals.avgPerHour)}</dd>
            </div>
          </dl>
        </Expand>
    </div>);
}
