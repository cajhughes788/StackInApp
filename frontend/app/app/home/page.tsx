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
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import ExpenseForm from "@/components/expense-form";
import ExpensesGrid from "@/components/expenses-grid";
import ReceiptCapturePanel from "@/components/receipt-capture-panel";
import VenmoImportPanel from "@/components/venmo-import-panel";
import { useExpensesStore } from "@/lib/stores/useExpensesStore";
import { debugLog, debugRender } from "@/lib/debugLoop";
import { formatCurrency } from "@/lib/helpers";
import { getActiveProfileTrace } from "@/lib/observability/profileTrace";
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context";

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
    const ensureSettingsLoaded = useSettingsStore((s) => s.ensureLoaded);
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const settings = settingsEntry?.data ?? null;
    const showVenmoImportPanel = settings?.independent?.enableVenmo === true;
    const settingsStatus = settingsEntry?.status ?? "idle";
    const settingsLoading = activeWorkspaceId != null
        ? settingsStatus === "idle" || settingsStatus === "loading"
        : true;
    // ---- INCOME vs EXPENSES TOGGLE ----
    const [mode, setMode] = useState<"income" | "expenses">("income");
    const [showNet, setShowNet] = useState(false);
    // ---- ENTRIES STORE ----
    const entriesEntry = useEntriesStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const hydrateEntries = useEntriesStore((s) => s.hydrateFromCache);
    // ---- EXPENSES STORE ----
    const expensesEntry = useExpensesStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const hydrateExpensesOnce = useExpensesStore((s) => s.hydrateFromCacheOnce);
    const entries = entriesEntry?.entries ?? [];
    const expenses = expensesEntry?.expenses ?? [];
    // Hydration once per mount
    const didHydrateEntriesRef = useRef(false);
    const didMarkUsefulRenderRef = useRef(false);
    debugRender("home-page", {
        authLoading,
        contextReady,
        userUid: user?.uid ?? null,
        workspaceStatus: workspaceState.status,
        activeWorkspaceId,
        activeWorkspaceType: activeWorkspace?.type ?? null,
        settingsStatus,
        settingsLoading,
        entriesStatus: entriesEntry?.status ?? "idle",
        expensesStatus: expensesEntry?.status ?? "idle",
        mode,
    });
    useEffect(() => {
    }, []);
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
        didHydrateEntriesRef.current = false;
    }, [activeWorkspaceId]);
    useEffect(() => {
        debugLog("home-page", "mode_or_workspace_reset_show_net", {
            mode,
            activeWorkspaceId,
        });
        setShowNet(false);
    }, [mode, activeWorkspaceId]);
    useEffect(() => {
        if (!activeWorkspaceId)
            return;
        debugLog("home-page", "ensure_settings_loaded", {
            activeWorkspaceId,
        });
        ensureSettingsLoaded(activeWorkspaceId);
    }, [activeWorkspaceId, ensureSettingsLoaded]);
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
    // Background hydration: taxProfile + payStubs (unchanged)
    // --------------------------------------------------------------------
    useEffect(() => {
        if (!user || !activeWorkspaceId)
            return;
        debugLog("home-page", "background_tax_profile_refresh", {
            activeWorkspaceId,
            activeWorkspaceType: activeWorkspace?.type ?? null,
        });
        useTaxProfileStore
            .getState()
            .refreshFromBackend(activeWorkspaceId)
            .catch((err) => {
        });
        if (activeWorkspace?.type === "w2") {
            debugLog("home-page", "paystubs_cache_hydrate_once", {
                activeWorkspaceId,
            });
            usePayStubsStore
                .getState()
                .hydrateFromCacheOnce(activeWorkspaceId)
                .catch((err) => {
            });
        }
    }, [user, activeWorkspaceId, activeWorkspace?.type]);
    // --------------------------------------------------------------------
    // Redirect logic (unchanged)
    // --------------------------------------------------------------------
    useEffect(() => {
        if (authLoading || workspaceState.status !== "ready" || settingsLoading || !contextReady)
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
    }, [authLoading, workspaceState.status, settingsLoading, contextReady, user, settings, settingsStatus, router]);
    // --------------------------------------------------------------------
    // Cache hydration kicks off once the workspace and settings are known.
    // The page shell no longer waits for these requests to finish.
    // --------------------------------------------------------------------
    useEffect(() => {
        if (didHydrateEntriesRef.current) {
            return;
        }
        if (authLoading || workspaceState.status !== "ready" || settingsLoading) {
            return;
        }
        if (!user || !settings || !activeWorkspaceId || !activeWorkspace) {
            return;
        }
        didHydrateEntriesRef.current = true;
        const entryPeriod = getCurrentEntryPeriod(settings, activeWorkspace.type);
        const entriesPeriodId = entryPeriod.periodId;
        const calendarMonthPeriodId = getCurrentCalendarMonthPeriodAt(settings).periodId;
        debugLog("home-page", "entries_period_selected", {
            activeWorkspaceId,
            workspaceType: activeWorkspace.type,
            entriesPeriodId,
            calendarMonthPeriodId,
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
        void useEntriesStore
            .getState()
            .refreshFromBackend(activeWorkspaceId, entriesPeriodId, { force: true });
        if (supportsExpenses) {
            // Expenses use monthly periodId "YYYY-MM"
            const now = new Date();
            const expensesPeriodId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
    const showBlockingLoader = authLoading || workspaceState.status !== "ready";
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
