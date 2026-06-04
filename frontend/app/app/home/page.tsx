// /app/home/page.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppLoader from "@/components/app-loader";
import StackInHeader from "@/components/stackin-header";
import IncomeGauge from "@/components/income-gauge";
import IndependentIncomeGauge from "@/components/independent-income-gauge";
import IndependentExpenseGauge from "@/components/independent-expense-gauge";
import EntryForm from "@/components/entry-form";
import EntriesGrid from "@/components/entries-grid";
import { useAuth } from "@/contexts/auth-context";
import {
    useSettingsData,
    useSettingsRenderState,
    useSettingsStore,
} from "@/lib/stores/useSettingsStore";
import {
    useEntriesData,
    useEntriesRenderState,
    useEntriesStore,
} from "@/lib/stores/useEntriesStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { getCalendarMonthBucketAt, getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";
import ExpenseForm from "@/components/expense-form";
import ExpensesGrid from "@/components/expenses-grid";
import ReceiptCapturePanel from "@/components/receipt-capture-panel";
import VenmoImportPanel from "@/components/venmo-import-panel";
import {
    useExpensesData,
    useExpensesRenderState,
    useExpensesStore,
} from "@/lib/stores/useExpensesStore";
import { debugLog, debugRender } from "@/lib/debugLoop";
import { formatCurrency } from "@/lib/helpers";
import { getActiveProfileTrace } from "@/lib/observability/profileTrace";
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context";
import { useHomepageLayoutShiftDiagnostics } from "@/hooks/useHomepageLayoutShiftDiagnostics";

export default function HomePage() {
    const router = useRouter();
    // ---- AUTH ----
    const { user, authLoading } = useAuth();
    const { contextReady } = useAppBootstrapState();
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const supportsExpenses = activeWorkspace?.type === "independent";
    const settings = useSettingsData(activeWorkspaceId);
    const settingsState = useSettingsRenderState(activeWorkspaceId);
    const showVenmoImportPanel = settings?.independent?.enableVenmo === true;
    const settingsStatus = settingsState.status;
    const settingsLoading = activeWorkspaceId != null
        ? settingsStatus === "idle" || settingsStatus === "loading"
        : true;
    // ---- INCOME vs EXPENSES TOGGLE ----
    const [mode, setMode] = useState<"income" | "expenses">("income");
    const [showNet, setShowNet] = useState(false);
    // ---- ENTRIES STORE ----
    const entries = useEntriesData(activeWorkspaceId);
    const entriesState = useEntriesRenderState(activeWorkspaceId);
    const hydrateEntries = useEntriesStore((s) => s.hydrateFromCache);
    // ---- EXPENSES STORE ----
    const expenses = useExpensesData(activeWorkspaceId);
    const expensesState = useExpensesRenderState(activeWorkspaceId);
    const hydrateExpensesOnce = useExpensesStore((s) => s.hydrateFromCacheOnce);
    const ensureSettingsLoaded = useSettingsStore((s) => s.ensureLoaded);
    // Hydration once per mount
    const didHydrateKeyRef = useRef<string | null>(null);
    const didMarkUsefulRenderRef = useRef(false);
    useHomepageLayoutShiftDiagnostics();

    // Kick off settings load as soon as workspace is known — runs in parallel
    // with bootstrap so settings are ready from cache before bootstrap settles.
    useEffect(() => {
        if (!activeWorkspaceId) return;
        void ensureSettingsLoaded(activeWorkspaceId);
    }, [activeWorkspaceId, ensureSettingsLoaded]);

    // Tax profile + paystubs — background, don't block rendering.
    useEffect(() => {
        if (!user || !activeWorkspaceId) return;
        void useTaxProfileStore.getState().refreshFromBackend(activeWorkspaceId).catch(() => {});
        if (activeWorkspace?.type === "w2") {
            void usePayStubsStore.getState().hydrateFromCacheOnce(activeWorkspaceId).catch(() => {});
        }
    }, [user, activeWorkspaceId, activeWorkspace?.type]);

    useEffect(() => {
        debugRender("home-page", {
            authLoading,
            contextReady,
            userUid: user?.uid ?? null,
            workspaceStatus: workspaceState.status,
            activeWorkspaceId,
            activeWorkspaceType: activeWorkspace?.type ?? null,
            settingsStatus,
            settingsLoading,
            entriesStatus: entriesState.status,
            expensesStatus: expensesState.status,
            mode,
        });
    }, [
        authLoading,
        contextReady,
        user?.uid,
        workspaceState.status,
        activeWorkspaceId,
        activeWorkspace?.type,
        settingsStatus,
        settingsLoading,
        entriesState.status,
        expensesState.status,
        mode,
    ]);
    useEffect(() => {
        if (!supportsExpenses && mode === "expenses") {
            debugLog("home-page", "force_income_mode");
            setMode("income");
        }
    }, [supportsExpenses, mode]);
    useEffect(() => {
        debugLog("home-page", "workspace_changed_reset_hydration", {
            activeWorkspaceId,
        });
        didHydrateKeyRef.current = null;
    }, [activeWorkspaceId]);
    useEffect(() => {
        debugLog("home-page", "mode_or_workspace_reset_show_net", {
            mode,
            activeWorkspaceId,
        });
        setShowNet(false);
    }, [mode, activeWorkspaceId]);
    useEffect(() => {
        if (didMarkUsefulRenderRef.current)
            return;
        if (authLoading || workspaceState.status !== "ready" || settingsLoading || !user) {
            return;
        }
        const trace = getActiveProfileTrace("startup");
        trace?.mark("startup.first_useful_render", {
            workspaceId: activeWorkspaceId ?? "unknown",
            workspaceType: activeWorkspace?.type ?? "unknown",
        });
        debugLog("home-page", "first_useful_render", {
            activeWorkspaceId,
            activeWorkspaceType: activeWorkspace?.type ?? null,
        });
        didMarkUsefulRenderRef.current = true;
    }, [
        authLoading,
        workspaceState.status,
        settingsLoading,
        user,
        activeWorkspaceId,
        activeWorkspace?.type,
    ]);
    // --------------------------------------------------------------------
    // Redirect logic (unchanged)
    // --------------------------------------------------------------------
    useEffect(() => {
        if (authLoading || workspaceState.status !== "ready" || settingsLoading)
            return;
        if (!user) {
            debugLog("home-page", "redirect_login");
            router.replace("/login");
            return;
        }
        if (settingsStatus === "error") {
            return;
        }
        if (settings === null) {
            debugLog("home-page", "redirect_settings", {
                activeWorkspaceId,
            });
            router.replace("/app/settings");
            return;
        }
    }, [authLoading, workspaceState.status, settingsLoading, user, settings, settingsStatus, router]);
    // --------------------------------------------------------------------
    // Cache hydration kicks off once the workspace and settings are known.
    // The page shell no longer waits for these requests to finish.
    // --------------------------------------------------------------------
    useEffect(() => {
        if (authLoading || workspaceState.status !== "ready" || settingsLoading) {
            return;
        }
        if (!user || !settings || !activeWorkspaceId || !activeWorkspace) {
            return;
        }
        const entryPeriod = getCurrentEntryPeriod(settings, activeWorkspace.type);
        const entriesPeriodId = entryPeriod.periodId;
        const calendarMonthPeriodId = getCurrentCalendarMonthPeriodAt(settings).periodId;
        const expensesMonthBucket = getCalendarMonthBucketAt(settings);
        const hydrationKey = `${activeWorkspaceId}::${entriesPeriodId}::${supportsExpenses ? expensesMonthBucket : "no-expenses"}`;
        if (didHydrateKeyRef.current === hydrationKey) {
            return;
        }
        didHydrateKeyRef.current = hydrationKey;
        debugLog("home-page", "entries_period_selected", {
            activeWorkspaceId,
            workspaceType: activeWorkspace.type,
            entriesPeriodId,
            calendarMonthPeriodId,
            expensesMonthBucket,
            periodResolver: activeWorkspace.type === "independent" ? "calendar-month" : "w2-pay-period",
            usesW2PayFrequency: settings?.w2?.payFrequency ?? null,
            w2PayPeriodStartDate: settings?.w2?.payPeriodStartDate ?? null,
            independentMonthTarget: settings?.independent?.incomeTargetPerMonth ?? null,
        });
        debugLog("home-page", "hydrate_entries", {
            activeWorkspaceId,
            entriesPeriodId,
            supportsExpenses,
        });
        hydrateEntries(activeWorkspaceId, entriesPeriodId);
        if (supportsExpenses) {
            // Expenses use the current calendar month bucket "YYYY-MM"
            const expensesPeriodId = expensesMonthBucket;
            debugLog("home-page", "hydrate_expenses_once", {
                activeWorkspaceId,
                expensesPeriodId,
            });
            // Hydrate expenses with the monthly periodId that matches Expense.periodId
            hydrateExpensesOnce(activeWorkspaceId, expensesPeriodId);
        }
        else {
        }
    }, [
        authLoading,
        workspaceState.status,
        activeWorkspaceId,
        activeWorkspace,
        settingsLoading,
        user,
        settings,
        hydrateEntries,
        hydrateExpensesOnce,
        supportsExpenses,
    ]);
    // Layout already gates on workspace ready; this is a safety net for direct navigation.
    const showBlockingLoader = workspaceState.status !== "ready";
    const showDashboardShell = !showBlockingLoader && !!user;
    const independentNet = useMemo(() => {
        const grossIncome = entries.reduce((sum, entry) => sum + (entry.totals?.dayTotal ?? 0), 0);
        const grossExpenses = expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0);
        return grossIncome - grossExpenses;
    }, [entries, expenses]);
    if (showBlockingLoader) {
        return <AppLoader label="Loading your dashboard..."/>;
    }
    if (!showDashboardShell) {
        return null;
    }
    return (<div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />

      <main className="flex-1 px-4 pb-6 pt-4 max-w-3xl mx-auto w-full space-y-4">
        {activeWorkspace?.type === "independent" ? (mode === "income" ? <IndependentIncomeGauge /> : <IndependentExpenseGauge />) : (<IncomeGauge />)}

        {/* Toggle */}
        <div className="flex justify-center gap-3 mt-4">
          <button onClick={() => setMode("income")} className={`px-4 py-2 rounded-lg border font-medium transition
      ${mode === "income"
            ? "border-border bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border-border hover:bg-accent"}
    `}>
            Income
          </button>

          {supportsExpenses && (<button onClick={() => setMode("expenses")} className={`px-4 py-2 rounded-lg border font-medium transition
      ${mode === "expenses"
                ? "border-border bg-primary text-primary-foreground"
                : "bg-card text-card-foreground border-border hover:bg-accent"}
    `}>
              Expenses
            </button>)}
        </div>

        {supportsExpenses && (<div className="flex justify-center">
            <button onClick={() => setShowNet((current) => !current)} className="text-sm font-medium text-emerald-700 hover:text-emerald-800 transition-colors">
              {showNet
                ? `Net: ${formatCurrency(independentNet)}`
                : "Net $"}
            </button>
          </div>)}

        {supportsExpenses ? (<div className="space-y-3">
            {showVenmoImportPanel ? <VenmoImportPanel /> : null}
            {mode === "expenses" ? <ReceiptCapturePanel /> : null}
          </div>) : null}

        {/* Mode */}
        <div className="space-y-4 mt-6">
          {mode === "income" && (<>
              <EntryForm />
              <EntriesGrid />
            </>)}

          {supportsExpenses && mode === "expenses" && (<>
              <ExpenseForm />
              <ExpensesGrid />
            </>)}
        </div>
      </main>
    </div>);
}
