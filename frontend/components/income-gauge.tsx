// /components/income-gauge.tsx
"use client";
import { useState, useEffect, useMemo, useRef } from "react";
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
        return sum + Number(entry.totals?.dayTotal ?? 0);
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
    // Gauge Fill Percentage (max capped at $5000)
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
        return (<div className="p-4 text-gray-400 text-sm">
        Loading pay summary…
      </div>);
    }
    // ------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------
    return (<div ref={previewRef} className="relative bg-card rounded-lg border p-4 shadow-sm sm:p-6">
      <SyncStatusIndicator visible={showSyncIndicator} label="Syncing pay summary"/>

      <h2 className="mb-4 text-lg font-semibold">Current Pay Period</h2>

      {/* --- Gauge Bar --- */}
      <div className="relative mb-5 h-28 sm:mb-6 sm:h-32">
        <div className="app-soft-surface absolute inset-0 rounded-lg overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500 ease-out" style={{ width: `${fillPercentage}%` }}/>
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-black sm:text-3xl">
              {formatCurrency(totals.incomeGauge)}
            </div>
            <div className="text-xs text-slate-600 sm:text-sm">
              Gross Income
              {targetIncome ? ` of ${formatCurrency(targetIncome)}` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* --- Breakdown --- */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {totals.daysWorked}
          </div>
          <div className="text-xs text-muted-foreground">Days Worked</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatCurrency(totals.avgPerDay)}
          </div>
          <div className="text-xs text-muted-foreground">Avg/Day</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-center">
          <div className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatCurrency(totals.avgPerHour)}
          </div>
          <div className="text-xs text-muted-foreground">Avg/Hour</div>
        </div>
      </div>

      {/* --- Net Pay Preview Button — PATCH 3 --- */}
      {activeWorkspace.type === "w2" && settings?.w2?.autoTaxCalculation && (<div className="mt-4 flex items-center justify-center gap-3">
          <button onClick={handlePreviewNet} disabled={isLoading} className="text-sm font-medium text-emerald-700 hover:text-emerald-800 transition-colors">
            {isLoading ? "Calculating…" : "Preview Net Pay"}
          </button>

          {netPreview !== null && !isLoading && (<div className="text-sm font-semibold text-emerald-600 transition-transform duration-300 ease-out" style={{ transform: "translateX(0)" }}>
              Net: {formatCurrency(netPreview)}
            </div>)}
        </div>)}

      {previewMessage && (<div className="mt-2 text-center text-sm text-muted-foreground">
          {previewMessage}
        </div>)}
    </div>);
}
