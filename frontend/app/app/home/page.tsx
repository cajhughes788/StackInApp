// /app/home/page.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, QrCode } from "lucide-react";
import AppLoader from "@/components/app-loader";
import StackInHeader from "@/components/stackin-header";
import IncomeGauge from "@/components/income-gauge";
import IncomeStreamsOverview from "@/components/income-streams-overview";
import ExpenseCategoriesOverview from "@/components/expense-categories-overview";
import NeedsYouPanel from "@/components/needs-you-panel";
import EntryForm from "@/components/entry-form";
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
import { getCalendarMonthBucketAt, getCalendarMonthBucketFromDate, getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";
import { useSelectedPeriod } from "@/lib/stores/usePeriodSelectionStore";
import { selectExpenseMonth, useExpenseFocusStore } from "@/lib/stores/useExpenseFocusStore";
import ExpenseForm from "@/components/expense-form";
import ImportSalesPanel from "@/components/import-sales-panel";
import { availableImportSources } from "@shared/importVisibility";
import { useReviewRequestNonce } from "@/lib/push/deepLinkStore";
import {
    useExpensesData,
    useExpensesRenderState,
    useExpensesStore,
} from "@/lib/stores/useExpensesStore";
import { debugLog, debugRender } from "@/lib/debugLoop";
import AllRecordsSection from "@/components/all-records-section";
import { getActiveProfileTrace } from "@/lib/observability/profileTrace";
import { useAppBootstrapState } from "@/contexts/app-bootstrap-context";
import { useHomepageLayoutShiftDiagnostics } from "@/hooks/useHomepageLayoutShiftDiagnostics";
import { useWarmClientsAndBooking } from "@/hooks/useWarmClientsAndBooking";
import HomeTour from "@/components/onboarding/home-tour";
import AllIncomeCard from "@/components/all-income-card";

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
    const selectedPeriod = useSelectedPeriod(activeWorkspaceId);
    const settings = useSettingsData(activeWorkspaceId);
    const settingsState = useSettingsRenderState(activeWorkspaceId);
    const importSources = supportsExpenses && settings
        ? availableImportSources(settings.independent)
        : [];
    const importSourcesKey = importSources.join(",");
    // Keep the array stable between renders so the panel's effects don't refire.
    const stableImportSources = useMemo(() => importSources, [importSourcesKey]);
    const showImportSalesPanel = stableImportSources.length > 0;
    // Bumped by "Import a CSV" under Payment streams to open the panel.
    const [importOpenRequest, setImportOpenRequest] = useState(0);
    const settingsStatus = settingsState.status;
    const settingsLoading = activeWorkspaceId != null
        ? settingsStatus === "idle" || settingsStatus === "loading"
        : true;
    // ---- INCOME vs EXPENSES TOGGLE ----
    const [mode, setMode] = useState<"income" | "expenses">("income");
    // Lets a link land directly on the Expenses tab via
    // /app/home?mode=expenses (web). Reads window.location directly rather
    // than useSearchParams() so this page doesn't need a Suspense boundary.
    // Notification taps go through deepLinkStore instead — see below.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("mode") === "expenses") {
            setMode("expenses");
        }
    }, []);
    // A notification tap (deepLinkStore.ts) picks the tab — including when
    // the app was already open on this page, which a mount-time check would
    // miss. Once per tap (nonce).
    const expensesReviewNonce = useReviewRequestNonce("expenses", activeWorkspaceId);
    const incomeReviewNonce = useReviewRequestNonce("income", activeWorkspaceId);
    const appliedReviewNonceRef = useRef<number | null>(null);
    useEffect(() => {
        const nonce = expensesReviewNonce ?? incomeReviewNonce;
        if (nonce == null || appliedReviewNonceRef.current === nonce) return;
        appliedReviewNonceRef.current = nonce;
        setMode(expensesReviewNonce != null ? "expenses" : "income");
    }, [expensesReviewNonce, incomeReviewNonce]);
    // "View expense" from elsewhere (e.g. Receipts): show the Expenses tab
    // for the expense's month, then hand off to the grid to scroll to it.
    const expenseFocusRequest = useExpenseFocusStore((s) => s.request);
    useEffect(() => {
        if (!expenseFocusRequest || !settings || !activeWorkspace || !activeWorkspaceId) return;
        if (expenseFocusRequest.workspaceId !== activeWorkspaceId) return;
        // Usually already selected by the caller before navigating; this
        // covers requests made while home is already open.
        selectExpenseMonth(activeWorkspaceId, activeWorkspace.type, activeWorkspace.createdAt ?? null, settings, expenseFocusRequest.month);
        setMode("expenses");
        const focusStore = useExpenseFocusStore.getState();
        focusStore.setHighlight(expenseFocusRequest.expenseId);
        focusStore.clearRequest();
    }, [expenseFocusRequest, settings, activeWorkspace, activeWorkspaceId]);
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
    // Clients and Booking only exist in independent workspaces.
    useWarmClientsAndBooking(
        supportsExpenses ? activeWorkspaceId : null,
        entriesState.status === "ready" && !entriesState.isRevalidating
    );

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
        // Only once the workspace is known: before that supportsExpenses is
        // false for every workspace, and this used to undo a deep link's
        // Expenses tab during startup.
        if (workspaceState.status === "ready" && !supportsExpenses && mode === "expenses") {
            debugLog("home-page", "force_income_mode");
            setMode("income");
        }
    }, [workspaceState.status, supportsExpenses, mode]);
    useEffect(() => {
        debugLog("home-page", "workspace_changed_reset_hydration", {
            activeWorkspaceId,
        });
        didHydrateKeyRef.current = null;
    }, [activeWorkspaceId]);
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
        const entryPeriod = selectedPeriod ?? getCurrentEntryPeriod(settings, activeWorkspace.type);
        const entriesPeriodId = entryPeriod.periodId;
        const calendarMonthPeriodId = getCurrentCalendarMonthPeriodAt(settings).periodId;
        const expensesMonthBucket = selectedPeriod
            ? getCalendarMonthBucketFromDate(selectedPeriod.start, settings)
            : getCalendarMonthBucketAt(settings);
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
        selectedPeriod,
    ]);
    // Layout already gates on workspace ready; this is a safety net for direct navigation.
    const showBlockingLoader = workspaceState.status !== "ready";
    const showDashboardShell = !showBlockingLoader && !!user;
    if (showBlockingLoader) {
        return <AppLoader label="Loading your dashboard..."/>;
    }
    if (!showDashboardShell) {
        return null;
    }
    if (supportsExpenses) {
        // Independent home: Income/Expenses switch, the period's total, the bank
        // review ("Needs you", shared by both tabs), the breakdown, the entry
        // form, and the full grid tucked away at the bottom. The overviews
        // return order-1 (total) and order-3 (breakdown) sections so the review
        // can sit between them while staying mounted across tab switches.
        return (<div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pb-10 pt-4">
        <AllIncomeCard className="order-0"/>
        <div className="order-0 grid grid-cols-2 rounded-full bg-secondary p-1 dark:bg-muted" role="group" aria-label="Show income or expenses" data-tour="mode-switch">
          {(["income", "expenses"] as const).map((tab) => (<button key={tab} type="button" aria-pressed={mode === tab} onClick={() => setMode(tab)} className={`rounded-full py-2 text-sm font-medium transition-colors ${mode === tab
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"}`}>
              {tab === "income" ? "Income" : "Expenses"}
            </button>))}
        </div>

        {mode === "income" ? <IncomeStreamsOverview onImportCsv={showImportSalesPanel ? () => setImportOpenRequest((n) => n + 1) : undefined}/> : <ExpenseCategoriesOverview />}

        <div className="order-2 space-y-5">
          {supportsExpenses ? (<Link href="/app/charge" className="flex items-center gap-3 rounded-[22px] border border-card-border bg-card px-5 py-4 hover:bg-muted/50" data-tour="charge">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <QrCode className="size-5" aria-hidden="true"/>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">Charge</span>
                <span className="block text-sm text-muted-foreground">Show a QR code your customer pays with</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
            </Link>) : null}
          <NeedsYouPanel />
          {showImportSalesPanel ? <ImportSalesPanel sources={stableImportSources} openRequest={importOpenRequest}/> : null}
        </div>

        <div className="order-4" data-tour="entry-form">
          {mode === "income" ? <EntryForm /> : <ExpenseForm />}
        </div>

        <AllRecordsSection kind={mode === "income" ? "entries" : "expenses"} count={mode === "income" ? entries.length : expenses.length}/>
      </main>
      <HomeTour />
    </div>);
    }
    // W-2 home: the pay period's total, the entry form, and the grid (the
    // only place W-2 entries are edited, so it starts open).
    return (<div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pb-10 pt-4">
        <AllIncomeCard />
        <div data-tour="total">
          <IncomeGauge />
        </div>
        <div data-tour="entry-form">
          <EntryForm />
        </div>
        <div data-tour="records">
          <AllRecordsSection kind="entries" count={entries.length} defaultOpen className=""/>
        </div>
      </main>
      <HomeTour />
    </div>);
}
