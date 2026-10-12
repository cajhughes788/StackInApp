// earnings-page.tsx
"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    ChevronRight,
    FileSpreadsheet,
    MoreVertical,
    Printer,
    Share2,
} from "lucide-react";
import AppLoader from "@/components/app-loader";
import { exportCsvFile, escapeCsvField } from "@/lib/documentExport";
import { formatCurrency, formatDate, getLocalDateInputValue } from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import { Type as PayStub } from "@shared/schemas/paystub";
import type { W2HoursGoalType } from "@shared/schemas/settings";
import { useAuth } from "@/contexts/auth-context";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import * as settingsService from "@/lib/domain/settingsService";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import StackInHeader from "@/components/stackin-header";
import YearlyEarningsGaugeCard from "@/components/yearly-earnings-gauge-card";
import HoursWorkedCard from "@/components/hours-worked-card";
import HoursGoalCard from "@/components/hours-goal-card";
import EarningsPositionBreakdown, { buildPositionBreakdown } from "@/components/earnings-position-breakdown";
import { getEntryPositionTitle } from "@shared/hourlyRates";
import { getEntryGross, getEntryHourlyPay } from "@shared/entryPay";
import { useRouteScrollReset } from "@/hooks/useRouteScrollReset";
// Simple pure-React dropdown replacement
function SimpleMenu({ onPrint, onDownload, onShare }: {
    onPrint: () => void;
    onDownload: () => void;
    onShare: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node))
                setOpen(false);
        };
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []);
    return (<div ref={ref} className="relative">
      <Button variant="ghost" size="icon" className="rounded-full text-foreground hover:bg-muted hover:text-foreground" onClick={() => setOpen(!open)}>
        <MoreVertical className="h-5 w-5"/>
      </Button>

      {open && (<div className="absolute right-0 mt-2 w-40 rounded-md border border-border bg-card text-foreground shadow-lg z-[9999]">
          <button onClick={() => {
                setOpen(false);
                onPrint();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted">
            <Printer className="h-4 w-4"/>
            Print
          </button>
          <button onClick={() => {
                setOpen(false);
                onShare();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted">
            <Share2 className="h-4 w-4"/>
            Share
          </button>
          <button onClick={() => {
                setOpen(false);
                onDownload();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted">
            <FileSpreadsheet className="h-4 w-4"/>
            Export CSV
          </button>
        </div>)}
    </div>);
}

// A label/value pair under the pay period's headline number.
function SummaryStat({ label, value, tone = "default" }: {
    label: string;
    value: string;
    tone?: "default" | "muted";
}) {
    return (<div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={`mt-0.5 truncate text-base font-semibold tabular-nums ${tone === "muted" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {value}
        </dd>
    </div>);
}

type MetricCellProps = {
    label: string;
    value: string;
    subtle?: boolean;
};

function MetricCell({ label, value, subtle = false }: MetricCellProps) {
    return (
        <div className="rounded-2xl bg-muted px-3 py-3">
            <div className="text-xs text-muted-foreground">
                {label}
            </div>
            <div className={`mt-1 text-base font-semibold tabular-nums ${subtle ? "text-muted-foreground" : "text-foreground"}`}>
                {value}
            </div>
        </div>
    );
}

function decodePeriodId(value: string | null | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}

export default function EarningsPage({ periodId }: { periodId?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [showYTD, setShowYTD] = useState(false);
    const [expandedActivityKey, setExpandedActivityKey] = useState<string | null>(null);
    const { user, authLoading } = useAuth();
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const ensureSettingsLoaded = useSettingsStore((s) => s.ensureLoaded);
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const settings = settingsEntry?.data ?? null;
    const updateSettingsStore = useSettingsStore((s) => s.setSettings);
    const settingsLoading = activeWorkspaceId != null
        ? (settingsEntry?.status ?? "idle") === "loading"
        : true;
    const payStubsEntry = usePayStubsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const stubs = payStubsEntry?.payStubs ?? [];
    const payStubsStatus = payStubsEntry?.status ?? "idle";
    const payStubsHasHydrated = payStubsEntry?.hasHydrated ?? false;
    const payStubsLoading = activeWorkspaceId != null
        ? !payStubsHasHydrated
            || payStubsStatus === "loading"
            || (payStubsHasHydrated && payStubsStatus === "ready" && stubs.length === 0 && payStubsEntry?.lastSuccessfulSyncAt == null)
        : true;
    const hydratePayStubsFromCacheOnce = usePayStubsStore((s) => s.hydrateFromCacheOnce);
    const refreshPayStubs = usePayStubsStore((s) => s.refreshFromBackend);
    const taxEnabled = settings?.w2?.autoTaxCalculation === true;
    const resolvedPeriodId = periodId ?? decodePeriodId(searchParams.get("periodId"));

    useRouteScrollReset(resolvedPeriodId);

    function getStubRecency(stub: PayStub) {
        const updated = stub.updatedAt ? new Date(stub.updatedAt).getTime() : 0;
        const created = stub.createdAt ? new Date(stub.createdAt).getTime() : 0;
        return Math.max(updated, created, 0);
    }

    function formatHeaderDateRange(start: string, end: string) {
        const format = (value: string) => {
            const [year, month, day] = value.split("-");
            return `${month}/${day}/${year.slice(-2)}`;
        };
        return `${format(start)} - ${format(end)}`;
    }

    function formatGridCurrency(value: number) {
        return value === 0 ? "—" : formatCurrency(value);
    }

    function formatSummaryCurrency(value: number) {
        return value === 0 ? "—" : formatCurrency(value);
    }

    function getSelectedRows(stub: PayStub): Record<string, any>[] {
        return Array.isArray(stub.breakdown)
            ? stub.breakdown
            : stub.entries || [];
    }

    function getRowTips(row: Record<string, any>) {
        return Number(row.w2?.tips ?? row.tips ?? 0);
    }

    function getRowPaidHours(row: Record<string, any>) {
        return Number(row.totals?.paidHours ?? row.paidHours ?? row.w2?.hours ?? row.hours ?? 0);
    }

    function getRowRate(row: Record<string, any>) {
        const rate = row.w2?.rate ?? row.rate ?? row.hourlyRate;
        return rate != null ? Number(rate) : null;
    }

    function getRowReportedCash(row: Record<string, any>) {
        return Number(row.w2?.reportedCash ?? row.reportedCash ?? 0);
    }

    function getRowUnreportedCash(row: Record<string, any>) {
        return Number(row.w2?.unreportedCash ?? row.unreportedCash ?? 0);
    }

    function getRowGross(row: Record<string, any>) {
        return getEntryGross(row);
    }

    function getRowHourlyGross(row: Record<string, any>) {
        return getEntryHourlyPay(row);
    }

    const positionCalc = { paidHours: getRowPaidHours, hourlyPay: getRowHourlyGross };

    function getSocialSecurityDeduction(breakdown: Record<string, any>) {
        if (breakdown.socialSecurity != null) {
            return Number(breakdown.socialSecurity);
        }
        const fica = Number(breakdown.ficaTax ?? breakdown.fica ?? 0);
        const medicare = Number(breakdown.medicareTax ?? breakdown.medicare ?? 0);
        return Math.max(fica - medicare, 0);
    }

    function getFicaDeduction(breakdown: Record<string, any>) {
        const fica = Number(breakdown.ficaTax ?? breakdown.fica ?? 0);
        if (fica > 0) {
            return fica;
        }
        return Number(breakdown.medicareTax ?? breakdown.medicare ?? 0)
            + getSocialSecurityDeduction(breakdown);
    }

    function getLocalTaxDeduction(breakdown: Record<string, any>) {
        return Number(breakdown.localTax ?? breakdown.local ?? breakdown.marylandLocalTax ?? 0);
    }

    function getCustomDeductionsAmount(breakdown: Record<string, any>) {
        return Number(breakdown.customDeductions ?? 0);
    }

    function getLocalTaxLabel(stub: PayStub) {
        const state = String(stub.taxProfile?.state ?? stub.taxProfile?.residenceState ?? "").trim().toLowerCase();
        const county = String(stub.taxProfile?.residenceCounty ?? stub.taxProfile?.workCounty ?? "").trim();
        if (state === "maryland") {
            return county ? `${county} Local Tax` : "Maryland Local Tax";
        }
        return "Local Tax";
    }

    function buildShareText(stub: PayStub) {
        const breakdown = (stub.breakdown ?? stub) as Record<string, any>;
        const deductions = Number(breakdown.federalTax ?? breakdown.federal ?? 0)
            + Number(breakdown.medicareTax ?? breakdown.medicare ?? 0)
            + getSocialSecurityDeduction(breakdown)
            + Number(breakdown.stateTax ?? breakdown.state ?? 0)
            + getLocalTaxDeduction(breakdown)
            + getCustomDeductionsAmount(breakdown)
            + Number(breakdown.retirement401k ?? breakdown.retirement ?? 0)
            + Number(breakdown.insurance ?? breakdown.insurancePreTax ?? breakdown.insurancePostTax ?? 0)
            + Number(breakdown.other ?? 0);
        const netIncome = Number(stub.grossIncome) - deductions || Number(stub.netIncome);

        return [
            `Earnings: ${stub.periodStart} - ${stub.periodEnd}`,
            `Gross Income: ${formatCurrency(Number(stub.grossIncome))}`,
            `Net Income: ${formatCurrency(Number(netIncome))}`,
            `Total Deductions: ${formatCurrency(deductions)}`,
            stub.totalUnreported !== undefined
                ? `Personal Cash: ${formatCurrency(Number(stub.totalUnreported))}`
                : null,
        ]
            .filter(Boolean)
            .join("\n");
    }

    function buildCsv(stub: PayStub) {
        const rows = getSelectedRows(stub);
        const breakdown = (stub.breakdown ?? stub) as Record<string, any>;
        const deductions = [
            ["FIT (Federal Income Tax)", breakdown.federalTax ?? breakdown.federal ?? 0],
            ["FICA", getFicaDeduction(breakdown)],
            ["State Tax", breakdown.stateTax ?? breakdown.state ?? 0],
            [getLocalTaxLabel(stub), getLocalTaxDeduction(breakdown)],
            ["Custom Deductions", getCustomDeductionsAmount(breakdown)],
            ["401(k) / Retirement", breakdown.retirement401k ?? breakdown.retirement ?? 0],
            ["Insurance", breakdown.insurance ?? breakdown.insurancePreTax ?? breakdown.insurancePostTax ?? 0],
            ["Other", breakdown.other ?? 0],
        ].filter(([, amount]) => Number(amount) > 0);

        // "Position" is appended last so existing column positions stay put
        // for anyone with formulas/imports built on the old layout.
        const csvRows: (string | number)[][] = [
            ["Section", "Date", "Label", "Amount", "Hours", "Rate", "Position"],
            ["Summary", "", "Gross Income", Number(stub.grossIncome), "", ""],
            ["Summary", "", "Net Income", Number(stub.netIncome), "", ""],
            ...(stub.totalUnreported !== undefined
                ? [["Summary", "", "Personal Cash", Number(stub.totalUnreported), "", ""]]
                : []),
            ...rows.map((row) => [
                "Entries",
                row.date ?? "",
                "Earnings Entry",
                getRowGross(row),
                getRowPaidHours(row),
                getRowRate(row) ?? "",
                getRowRate(row) != null ? getEntryPositionTitle(row.w2, settings) : "",
            ]),
            // Hourly pay per position/rate, same math as the rest of
            // earnings; tips and cash stay in Entry Details.
            ...buildPositionBreakdown(rows, settings, positionCalc).map((line) => [
                "Hourly by Position",
                "",
                line.title,
                Math.round(line.pay * 100) / 100,
                Math.round(line.hours * 100) / 100,
                line.rate,
                line.title,
            ]),
            ...rows.map((row) => ["Entry Details", row.date ?? "", "Tips", getRowTips(row), "", ""]),
            ...rows
                .filter((row) => getRowReportedCash(row) !== 0)
                .map((row) => ["Entry Details", row.date ?? "", "Reported Cash", getRowReportedCash(row), "", ""]),
            ...rows
                .filter((row) => getRowUnreportedCash(row) !== 0)
                .map((row) => ["Entry Details", row.date ?? "", "Personal Cash", getRowUnreportedCash(row), "", ""]),
            ...deductions.map(([label, amount]) => ["Deductions", "", label, Number(amount), "", ""]),
        ];

        return csvRows
            .map((row) => [...row, ...Array(7 - row.length).fill("")].map(escapeCsvField).join(","))
            .join("\n");
    }
    const yearlyGaugeSummary = useMemo(() => {
        const latestStubByPeriod = new Map<string, PayStub>();
        for (const stub of stubs) {
            const existing = latestStubByPeriod.get(stub.periodId);
            if (!existing || getStubRecency(stub) >= getStubRecency(existing)) {
                latestStubByPeriod.set(stub.periodId, stub);
            }
        }
        const uniqueStubs = [...latestStubByPeriod.values()];
        const availableYears = uniqueStubs
            .map((stub) => Number(String(stub.periodEnd ?? stub.periodStart ?? "").slice(0, 4)))
            .filter((year) => Number.isFinite(year) && year > 0)
            .sort((a, b) => b - a);
        const currentYear = new Date().getFullYear();
        const year = availableYears.includes(currentYear)
            ? currentYear
            : availableYears[0] ?? currentYear;
        let hourly = 0;
        let reportedCash = 0;
        let unreportedCash = 0;
        let card = 0;
        let payPeriods = 0;
        let hoursWorked = 0;
        for (const stub of uniqueStubs) {
            const rows = getSelectedRows(stub);
            const rowsInYear = rows.filter((row) => {
                const sourceDate = String(row.date ?? stub.periodEnd ?? stub.periodStart ?? "");
                return sourceDate.startsWith(`${year}-`);
            });
            if (rowsInYear.length === 0) {
                continue;
            }
            payPeriods += 1;
            for (const row of rowsInYear) {
                hourly += getRowHourlyGross(row);
                reportedCash += getRowReportedCash(row);
                card += getRowTips(row);
                unreportedCash += getRowUnreportedCash(row);
                hoursWorked += getRowPaidHours(row);
            }
        }
        const cash = reportedCash + unreportedCash;
        const totalGross = hourly + cash + card;
        return {
            year,
            payPeriods,
            breakdown: {
                hourly,
                cash,
                card,
            },
            cashBreakdown: {
                reported: reportedCash,
                unreported: unreportedCash,
            },
            totalGross,
            avgPerHour: hoursWorked > 0 ? totalGross / hoursWorked : 0,
        };
    }, [stubs]);
    const flatHoursRows = useMemo(() => {
        const latestStubByPeriod = new Map<string, PayStub>();
        for (const stub of stubs) {
            const existing = latestStubByPeriod.get(stub.periodId);
            if (!existing || getStubRecency(stub) >= getStubRecency(existing)) {
                latestStubByPeriod.set(stub.periodId, stub);
            }
        }
        const rows: { date: string; hours: number }[] = [];
        for (const stub of latestStubByPeriod.values()) {
            for (const row of getSelectedRows(stub)) {
                const hours = getRowPaidHours(row);
                const date = String(row.date ?? stub.periodEnd ?? stub.periodStart ?? "");
                if (hours > 0 && date) {
                    rows.push({ date, hours });
                }
            }
        }
        return rows;
    }, [stubs]);
    const monthlyHoursBuckets = useMemo(() => {
        const totalsByMonth = new Map<string, { hours: number; firstActivityDate: string }>();
        for (const row of flatHoursRows) {
            const key = row.date.slice(0, 7);
            const current = totalsByMonth.get(key);
            if (!current) {
                totalsByMonth.set(key, { hours: row.hours, firstActivityDate: row.date });
            } else {
                current.hours += row.hours;
                if (row.date < current.firstActivityDate) current.firstActivityDate = row.date;
            }
        }
        return [...totalsByMonth.entries()]
            .map(([key, { hours: totalHours, firstActivityDate }]) => {
                const [year, month] = key.split("-").map(Number);
                const periodStart = `${key}-01`;
                const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
                const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                });
                return {
                    key,
                    label,
                    totalHours: Math.round(totalHours * 100) / 100,
                    periodStart,
                    periodEnd,
                    firstActivityDate,
                };
            })
            .sort((a, b) => b.key.localeCompare(a.key));
    }, [flatHoursRows]);
    const defaultGoalStartDate = useMemo(() => {
        const yearPrefix = String(new Date().getFullYear());
        const datesThisYear = flatHoursRows
            .filter((row) => row.date.startsWith(yearPrefix))
            .map((row) => row.date);
        if (datesThisYear.length === 0) return getLocalDateInputValue();
        return datesThisYear.reduce((min, d) => (d < min ? d : min));
    }, [flatHoursRows]);
    const hoursGoal = settings?.w2?.hoursGoal ?? null;
    const hoursSinceGoalStart = useMemo(() => {
        if (!hoursGoal) return 0;
        return Math.round(
            flatHoursRows
                .filter((row) => row.date >= hoursGoal.startDate && row.date <= hoursGoal.endDate)
                .reduce((sum, row) => sum + row.hours, 0) * 100
        ) / 100;
    }, [flatHoursRows, hoursGoal]);
    async function persistHoursGoal(nextGoal: W2HoursGoalType | null) {
        if (!activeWorkspaceId || !settings) return;
        const optimisticSettings = { ...settings, w2: { ...settings.w2, hoursGoal: nextGoal } };
        updateSettingsStore(activeWorkspaceId, optimisticSettings, {
            source: "optimistic",
            localUpdatedAt: Date.now(),
        });
        const saved = await settingsService.save(activeWorkspaceId, { w2: { hoursGoal: nextGoal } });
        if (saved.source === "backend" && saved.data) {
            updateSettingsStore(activeWorkspaceId, saved.data, {
                source: "backend",
                remoteMeta: saved.remoteMeta,
                lastSuccessfulSyncAt: saved.lastSuccessfulSyncAt,
                localUpdatedAt: saved.localUpdatedAt,
            });
        }
    }
    const selected = useMemo(() => {
        if (!resolvedPeriodId) {
            return null;
        }
        return stubs.find((stub) => stub.periodId === resolvedPeriodId) ?? null;
    }, [resolvedPeriodId, stubs]);
    useEffect(() => {
        if (workspaceState.status !== "ready")
            return;
        if (activeWorkspace?.type === "independent") {
            router.replace("/app/profitloss");
        }
    }, [workspaceState.status, activeWorkspace?.type, router]);
    useEffect(() => {
        if (!activeWorkspaceId)
            return;
        ensureSettingsLoaded(activeWorkspaceId);
    }, [activeWorkspaceId, ensureSettingsLoaded]);
    useEffect(() => {
        if (!activeWorkspaceId)
            return;
        void hydratePayStubsFromCacheOnce(activeWorkspaceId);
    }, [activeWorkspaceId, hydratePayStubsFromCacheOnce]);
    useEffect(() => {
        if (!user)
            return;
        if (workspaceState.status !== "ready")
            return;
        if (!activeWorkspaceId || !activeWorkspace)
            return;
        if (!payStubsHasHydrated)
            return;
        if (!settings)
            return;
        // TTL-based backend hydration
        refreshPayStubs(activeWorkspaceId, { force: false });
    }, [user, workspaceState.status, activeWorkspaceId, activeWorkspace, settings, refreshPayStubs, payStubsHasHydrated]);
    useEffect(() => {
        setShowYTD(false);
        setExpandedActivityKey(null);
    }, [resolvedPeriodId]);

    const handleBackToList = () => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
            return;
        }
        router.push("/app/earnings");
    };
    // === PDF Download Handler (disabled for now) ===
    const handleDownloadPDF = async () => {
        if (!selected)
            return;
        const csv = buildCsv(selected);
        try {
            await exportCsvFile(`earnings-${selected.periodStart}-to-${selected.periodEnd}.csv`, csv, "Earnings CSV");
        }
        catch {
            alert("We couldn't export your earnings CSV.");
        }
    };

    const handleShare = async () => {
        if (!selected)
            return;
        const text = buildShareText(selected);
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Earnings: ${selected.periodStart} - ${selected.periodEnd}`,
                    text,
                });
                return;
            }
            catch {
                // Fall back to clipboard if the share sheet is dismissed or unsupported.
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            window.alert("Earnings summary copied so you can paste it into text or email.");
        }
        catch {
            window.alert(text);
        }
    };
    // === Print Handler (desktop + iOS friendly) ===
    const handlePrint = () => {
        const content = document.getElementById("earnings-content");
        if (!content)
            return;
        const printMarkup = `
        <html>
          <head>
            <title>Earnings</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #ccc; padding: 4px; text-align: left; }
              h1 { font-size: 1.25rem; margin-bottom: 1rem; }
              .deduction-box, .deduction-box div {
                border: 1px solid #ccc !important;
                border-collapse: collapse;
              }
              .no-print { display: none !important; }
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .border, .border-gray-300, .rounded-lg { border: 1px solid #ccc !important; }
                .bg-gray-100, .bg-gray-50 { background-color: #f8f8f8 !important; }
                .no-print { display: none !important; }
              }
            </style>
          </head>
          <body>${content.innerHTML}</body>
        </html>
      `;
        void printHtmlDocument({
            title: "Earnings",
            html: printMarkup,
        }).catch(() => {
            alert("We couldn't prepare your earnings view for printing.");
        });
    };
    if (authLoading ||
        workspaceState.status !== "ready" ||
        settingsLoading ||
        payStubsLoading) {
        return <AppLoader label="Loading earnings..."/>;
    }
    if (resolvedPeriodId && !selected) {
        return (<>
        <StackInHeader />
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          <div className="rounded-[22px] bg-card p-6">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">Pay period not found</h1>
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t find an earnings detail view for this pay period.
              </p>
            </div>

            <Button className="mt-5" variant="outline" onClick={handleBackToList}>
              Back to earnings
            </Button>
          </div>
        </div>
      </>);
    }
    if (selected) {
        const rows: Record<string, any>[] = Array.isArray(selected.breakdown)
            ? selected.breakdown
            : selected.entries || [];
        const totals = rows.reduce((acc, r) => {
            acc.tips += getRowTips(r);
            acc.paidHours += getRowPaidHours(r);
            acc.gross += getRowGross(r);
            acc.unreported += getRowUnreportedCash(r);
            acc.reported += getRowReportedCash(r);
            return acc;
        }, { tips: 0, paidHours: 0, gross: 0, unreported: 0, reported: 0 });
        const positionLines = buildPositionBreakdown(rows, settings, positionCalc);
        const showPositions = positionLines.length > 1;
        const hasReportedCash = rows.some((r) => getRowReportedCash(r) > 0);
        const hasUnreportedCash = rows.some((r) => getRowUnreportedCash(r) > 0);
        const breakdown = (selected.breakdown ?? selected) as Record<string, any>;
        const dedFederal = Number(breakdown.federalTax ?? breakdown.federal ?? 0);
        const dedMedicare = Number(breakdown.medicareTax ?? breakdown.medicare ?? 0);
        const dedSocialSecurity = getSocialSecurityDeduction(breakdown);
        const dedFica = getFicaDeduction(breakdown);
        const dedState = Number(breakdown.stateTax ?? breakdown.state ?? 0);
        const dedLocal = getLocalTaxDeduction(breakdown);
        const dedCustomDeductions = getCustomDeductionsAmount(breakdown);
        const dedRetirement = Number(breakdown.retirement401k ?? breakdown.retirement ?? 0);
        const dedInsurance = Number(breakdown.insurance ?? breakdown.insurancePreTax ?? breakdown.insurancePostTax ?? 0);
        const dedOther = Number(breakdown.other ?? 0);
        const totalDeductions = dedFederal + dedMedicare + dedSocialSecurity + dedState + dedLocal + dedCustomDeductions + dedRetirement + dedInsurance + dedOther;
        const localTaxLabel = getLocalTaxLabel(selected);
        const deductionRows = [
            { label: "FIT (Federal Income Tax)", amount: dedFederal },
            { label: "FICA", amount: dedFica },
            { label: "State Tax", amount: dedState },
            ...(dedLocal > 0 ? [{ label: localTaxLabel, amount: dedLocal }] : []),
            ...(dedCustomDeductions > 0 ? [{ label: "Custom Deductions", amount: dedCustomDeductions }] : []),
            ...(dedRetirement > 0 ? [{ label: "401(k) / Retirement", amount: dedRetirement }] : []),
            ...(dedInsurance > 0 ? [{ label: "Insurance", amount: dedInsurance }] : []),
            ...(dedOther > 0 ? [{ label: "Other", amount: dedOther }] : []),
        ];
        const needsMarylandCounty = (selected.taxProfile?.state === "Maryland"
            || selected.taxProfile?.residenceState === "Maryland")
            && !(selected.taxProfile?.residenceCounty ?? "").trim();
        const computedNet = Number(selected.grossIncome) - Number(totalDeductions) || Number(selected.netIncome);
        const activitySummary = [
            { label: "Entries", value: String(rows.length) },
            { label: "Reported earnings", value: formatCurrency(totals.gross) },
            { label: "Paid hours", value: totals.paidHours > 0 ? totals.paidHours.toFixed(2) : "—" },
            { label: "Tips", value: formatSummaryCurrency(totals.tips) },
            ...(hasReportedCash ? [{ label: "Reported cash", value: formatSummaryCurrency(totals.reported) }] : []),
            ...(hasUnreportedCash ? [{ label: "Personal cash", value: formatSummaryCurrency(totals.unreported) }] : []),
        ];
        const ytd = selected.ytdTotals || {
            grossIncome: 0,
            netIncome: 0,
            totalDeductions: 0,
            tips: 0,
            reportedCash: 0,
            unreportedCash: 0,
        };
        return (<>
        <StackInHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 text-foreground">
          <div id="earnings-content" className="space-y-5">
            <div className="flex items-center justify-between gap-3 no-print">
              <Button variant="ghost" size="sm" onClick={handleBackToList} className="-ml-2 rounded-full text-muted-foreground hover:text-foreground">
                ← All pay periods
              </Button>
              <SimpleMenu onPrint={handlePrint} onDownload={handleDownloadPDF} onShare={handleShare}/>
            </div>

            <section className="rounded-[22px] bg-card p-5">
              <h1 className="text-sm text-muted-foreground">
                Pay period · {formatHeaderDateRange(selected.periodStart, selected.periodEnd)}
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {taxEnabled ? "Estimated take-home" : "Reported earnings"}
              </p>
              <div className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
                {formatCurrency(taxEnabled ? Number(computedNet) : Number(selected.grossIncome))}
              </div>

              {taxEnabled || (selected.totalUnreported !== undefined && selected.totalUnreported > 0) ? (<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-3">
                  {taxEnabled ? (<SummaryStat label="Reported earnings" value={formatCurrency(Number(selected.grossIncome))}/>) : null}
                  {taxEnabled ? (<SummaryStat label="Estimated deductions" value={formatCurrency(totalDeductions)}/>) : null}
                  {selected.totalUnreported !== undefined && selected.totalUnreported > 0 ? (<SummaryStat label="Personal cash" value={formatCurrency(Number(selected.totalUnreported))} tone="muted"/>) : null}
                </dl>) : null}

              <div className="mt-4 text-xs text-muted-foreground">
                <p>Calculated from current pay period entries.</p>
                {needsMarylandCounty ? (
                  <p className="mt-1 text-amber-600 dark:text-amber-400">
                    Add a Maryland residence county in tax settings to make this withholding estimate more accurate.
                  </p>
                ) : null}
              </div>
            </section>

            <EarningsPositionBreakdown lines={positionLines}/>

            <section className="rounded-[22px] bg-card px-4 pb-2 pt-4">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-lg font-semibold text-foreground">
                  Pay period activity
                </h2>
                <span className="text-sm text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
              </div>

              <ul className="mt-1 divide-y divide-border/70">
                {rows.map((row: Record<string, any>, idx: number) => {
                    const tips = getRowTips(row);
                    const paidHours = getRowPaidHours(row);
                    const rate = getRowRate(row);
                    const reportedCash = getRowReportedCash(row);
                    const unreportedCash = getRowUnreportedCash(row);
                    const gross = getRowGross(row);
                    const entryDateLabel = row.date ? formatDate(row.date) : `Entry ${idx + 1}`;
                    const rowKey = `${row.date ?? "entry"}-${idx}`;
                    const isExpanded = expandedActivityKey === rowKey;
                    const detailRows = [
                        ...(tips > 0 ? [{ label: "Tips", value: formatCurrency(tips) }] : []),
                        ...(paidHours > 0 ? [{ label: "Paid hours", value: paidHours.toFixed(2) }] : []),
                        ...(showPositions && rate != null ? [{ label: "Position", value: getEntryPositionTitle(row.w2, settings) }] : []),
                        ...(rate != null ? [{ label: "Hourly rate", value: formatCurrency(rate) }] : []),
                        ...(reportedCash > 0 ? [{ label: "Reported cash", value: formatCurrency(reportedCash) }] : []),
                        ...(unreportedCash > 0 ? [{ label: "Personal cash", value: formatCurrency(unreportedCash), subtle: true }] : []),
                    ];

                    return (
                        <motion.li key={rowKey} layout>
                          <button
                            type="button"
                            onClick={() => setExpandedActivityKey((current) => current === rowKey ? null : rowKey)}
                            className="flex w-full items-center gap-3 px-1 py-3 text-left"
                            aria-expanded={isExpanded}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-foreground">{entryDateLabel}</span>
                              {paidHours > 0 ? (<span className="block text-sm text-muted-foreground">{paidHours.toFixed(2)} hrs</span>) : null}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-semibold tabular-nums text-foreground">{formatGridCurrency(gross)}</span>
                              {unreportedCash > 0 ? (<span className="block text-xs tabular-nums text-amber-600 dark:text-amber-400">
                                  + {formatCurrency(unreportedCash)} personal
                                </span>) : null}
                            </span>
                            <motion.span
                              animate={{ rotate: isExpanded ? 180 : 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="flex shrink-0 items-center text-muted-foreground"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </motion.span>
                          </button>

                          <AnimatePresence initial={false}>
                            {isExpanded ? (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                {detailRows.length > 0 ? (
                                  <dl className="mb-3 divide-y divide-border/70 rounded-xl bg-muted px-3">
                                    {detailRows.map((metric) => (
                                      <div key={`${metric.label}-${idx}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                                        <dt className="text-muted-foreground">{metric.label}</dt>
                                        <dd className={`font-semibold tabular-nums ${metric.subtle === true ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                                          {metric.value}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : (
                                  <p className="mb-3 rounded-xl bg-muted px-3 py-3 text-sm text-muted-foreground">
                                    No additional pay details were recorded for this entry.
                                  </p>
                                )}
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </motion.li>
                    );
                })}
              </ul>

              <dl className="grid grid-cols-2 gap-2 border-t border-border/70 py-4 sm:grid-cols-3">
                {activitySummary.map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted px-3 py-3">
                    <dt className="text-xs text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {taxEnabled ? (
              <section className="space-y-5">
                <div className="rounded-[22px] bg-card px-4 py-4 deduction-box">
                  <h2 className="px-1 text-lg font-semibold text-foreground">
                    Estimated taxes and deductions
                  </h2>

                  <div className="mt-1 divide-y divide-border/70">
                    {deductionRows.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatSummaryCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                    {dedFica > 0 ? (
                      <div className="px-1 py-2.5 text-xs text-muted-foreground">
                        Includes Medicare {formatSummaryCurrency(dedMedicare)} and Social Security {formatSummaryCurrency(dedSocialSecurity)}.
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3 px-1 pt-3 font-semibold">
                      <span>Total deductions</span>
                      <span className="tabular-nums">{formatCurrency(totalDeductions)}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[22px] bg-card p-4">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <h2 className="text-lg font-semibold text-foreground">
                      Year to date
                    </h2>
                    <button type="button" onClick={() => setShowYTD((prev) => !prev)} className="inline-flex items-center gap-1 text-sm font-medium text-primary" aria-expanded={showYTD}>
                      {showYTD ? "Show less" : "Show more"}
                      <motion.span
                        animate={{ rotate: showYTD ? 180 : 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="flex items-center"
                      >
                        <ChevronDown size={16}/>
                      </motion.span>
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetricCell label="Gross" value={formatCurrency(ytd.grossIncome)} />
                    <MetricCell label="Net" value={formatCurrency(ytd.netIncome)} />
                    {showYTD ? (<>
                        <MetricCell label="Deductions" value={formatCurrency(ytd.totalDeductions)} />
                        <MetricCell label="Tips" value={formatCurrency(ytd.tips)} />
                        <MetricCell label="Reported cash" value={formatCurrency(ytd.reportedCash)} />
                        <MetricCell label="Personal cash" value={formatCurrency(ytd.unreportedCash)} subtle />
                      </>) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </>);
    }
    return (<>
    <StackInHeader />
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10 pt-4">
      <YearlyEarningsGaugeCard year={yearlyGaugeSummary.year} payPeriods={yearlyGaugeSummary.payPeriods} totalGross={yearlyGaugeSummary.totalGross} breakdown={yearlyGaugeSummary.breakdown} cashBreakdown={yearlyGaugeSummary.cashBreakdown} avgPerHour={yearlyGaugeSummary.avgPerHour}/>

      <HoursWorkedCard variant="trend" monthlyBuckets={monthlyHoursBuckets} />

      <HoursGoalCard
        goal={hoursGoal}
        hoursSinceGoalStart={hoursSinceGoalStart}
        defaultStartDate={defaultGoalStartDate}
        onSetGoal={persistHoursGoal}
        onClearGoal={() => persistHoursGoal(null)}
      />

      <section aria-labelledby="pay-periods-heading">
        <h1 id="pay-periods-heading" className="mb-2 px-1 text-lg font-semibold text-foreground">Pay periods</h1>
        {stubs.length === 0 ? (<p className="rounded-[22px] bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No earnings estimates available yet.
          </p>) : (<ul className="divide-y divide-border/70 rounded-[22px] bg-card px-4">
            {stubs.map((stub) => {
                const hasPersonalCash = stub.totalUnreported !== undefined && stub.totalUnreported > 0;
                const details = [
                    ...(taxEnabled ? [`Take-home ${formatCurrency(Number(stub.netIncome))}`] : []),
                    ...(hasPersonalCash ? [`Personal cash ${formatCurrency(Number(stub.totalUnreported))}`] : []),
                ];
                return (<li key={stub.periodId}>
                  <button type="button" onClick={() => router.push(`/app/earnings?periodId=${encodeURIComponent(stub.periodId)}`)} className="flex w-full items-center gap-3 py-3.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {formatHeaderDateRange(stub.periodStart, stub.periodEnd)}
                      </span>
                      {details.length > 0 ? (<span className="block truncate text-sm tabular-nums text-muted-foreground">{details.join(" · ")}</span>) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs text-muted-foreground">Gross</span>
                      <span className="block font-semibold tabular-nums text-foreground">{formatCurrency(Number(stub.grossIncome))}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
                  </button>
                </li>);
            })}
          </ul>)}
      </section>
    </div>
  </>);
}
