// earnings-page.tsx
"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    ChevronDown,
    FileSpreadsheet,
    MoreVertical,
    Printer,
    Share2,
} from "lucide-react";
import AppLoader from "@/components/app-loader";
import { exportCsvFile } from "@/lib/documentExport";
import { formatCurrency, formatDate } from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import { Type as PayStub } from "@shared/schemas/paystub";
import { useAuth } from "@/contexts/auth-context";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import StackInHeader from "@/components/stackin-header";
import YearlyEarningsGaugeCard from "@/components/yearly-earnings-gauge-card";
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
      <Button variant="ghost" size="icon" className="rounded-full text-slate-900 hover:bg-slate-100 hover:text-slate-900" onClick={() => setOpen(!open)}>
        <MoreVertical className="h-5 w-5"/>
      </Button>

      {open && (<div className="absolute right-0 mt-2 w-40 rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg z-[9999]">
          <button onClick={() => {
                setOpen(false);
                onPrint();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100">
            <Printer className="h-4 w-4"/>
            Print
          </button>
          <button onClick={() => {
                setOpen(false);
                onShare();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100">
            <Share2 className="h-4 w-4"/>
            Share
          </button>
          <button onClick={() => {
                setOpen(false);
                onDownload();
            }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100">
            <FileSpreadsheet className="h-4 w-4"/>
            Export CSV
          </button>
        </div>)}
    </div>);
}

type SummaryStatCardProps = {
    label: string;
    value: string;
    tone?: "default" | "accent" | "muted";
    scale?: "default" | "compact";
};

function SummaryStatCard({
    label,
    value,
    tone = "default",
    scale = "default",
}: SummaryStatCardProps) {
    const toneClasses = tone === "accent"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : tone === "muted"
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-slate-200 bg-white text-slate-950";
    const labelClasses = scale === "compact"
        ? "text-[10px] tracking-[0.17em]"
        : "text-[11px] tracking-[0.2em]";
    const valueClasses = scale === "compact"
        ? "text-[clamp(0.95rem,1.45vw,1.55rem)]"
        : "text-[clamp(1rem,1.7vw,1.75rem)]";
    const heightClasses = scale === "compact"
        ? "min-h-[5.35rem] min-[420px]:min-h-[5.85rem]"
        : "min-h-[5.75rem] min-[420px]:min-h-[6.25rem]";

    return (
        <div className={`flex min-w-0 flex-col justify-between rounded-3xl border px-4 py-3.5 shadow-sm min-[420px]:px-4 min-[420px]:py-4 ${heightClasses} ${toneClasses}`}>
            <div className={`uppercase text-slate-500 ${labelClasses}`}>
                {label}
            </div>
            <div className={`mt-2 w-full min-w-0 whitespace-nowrap font-semibold leading-tight tracking-tight tabular-nums ${valueClasses}`}>
                {value}
            </div>
        </div>
    );
}

type MetricCellProps = {
    label: string;
    value: string;
    subtle?: boolean;
};

function MetricCell({ label, value, subtle = false }: MetricCellProps) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {label}
            </div>
            <div className={`mt-2 text-sm font-semibold tabular-nums ${subtle ? "text-slate-600" : "text-slate-900"}`}>
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
        return Number(row.totals?.dayTotal ?? row.dayTotal ?? 0);
    }

    function getRowHourlyGross(row: Record<string, any>) {
        return Math.max(getRowGross(row) - getRowTips(row) - getRowReportedCash(row), 0);
    }

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
                ? `Unreported Cash: ${formatCurrency(Number(stub.totalUnreported))}`
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

        const csvRows = [
            ["Section", "Date", "Label", "Amount", "Hours", "Rate"],
            ["Summary", "", "Gross Income", Number(stub.grossIncome), "", ""],
            ["Summary", "", "Net Income", Number(stub.netIncome), "", ""],
            ...(stub.totalUnreported !== undefined
                ? [["Summary", "", "Unreported Cash", Number(stub.totalUnreported), "", ""]]
                : []),
            ...rows.map((row) => [
                "Entries",
                row.date ?? "",
                "Earnings Entry",
                getRowGross(row),
                getRowPaidHours(row),
                getRowRate(row) ?? "",
            ]),
            ...rows.map((row) => ["Entry Details", row.date ?? "", "Tips", getRowTips(row), "", ""]),
            ...rows
                .filter((row) => getRowReportedCash(row) !== 0)
                .map((row) => ["Entry Details", row.date ?? "", "Reported Cash", getRowReportedCash(row), "", ""]),
            ...rows
                .filter((row) => getRowUnreportedCash(row) !== 0)
                .map((row) => ["Entry Details", row.date ?? "", "Unreported Cash", getRowUnreportedCash(row), "", ""]),
            ...deductions.map(([label, amount]) => ["Deductions", "", label, Number(amount), "", ""]),
        ];

        return csvRows
            .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
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
            }
        }
        const cash = reportedCash + unreportedCash;
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
            totalGross: hourly + cash + card,
        };
    }, [stubs]);
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
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900">Pay period not found</h1>
              <p className="text-sm text-slate-600">
                We couldn&apos;t find an earnings detail view for this pay period.
              </p>
            </div>

            <Button className="mt-5" variant="outline" onClick={handleBackToList}>
              Back to Earnings
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
        const summaryCardValues = [
            Number(selected.grossIncome),
            ...(taxEnabled ? [totalDeductions, Number(computedNet)] : []),
            ...(selected.totalUnreported !== undefined && selected.totalUnreported > 0
                ? [Number(selected.totalUnreported)]
                : []),
        ];
        const largestSummaryWholeDigits = summaryCardValues.reduce((max, value) => {
            const wholeDigits = Math.trunc(Math.abs(value)).toString().length;
            return Math.max(max, wholeDigits);
        }, 0);
        const summaryCardScale = largestSummaryWholeDigits >= 6 ? "compact" : "default";
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
        <div className="mx-auto w-full max-w-6xl px-3 py-4 text-slate-900 md:px-5 xl:max-w-7xl">
          <div id="earnings-content" className="space-y-5 rounded-[2rem] border border-slate-200/80 bg-white/95 p-4 shadow-sm backdrop-blur md:p-6">
            <div className="flex items-start justify-between gap-3 no-print">
              <Button variant="outline" size="sm" onClick={handleBackToList} className="shrink-0 rounded-full border-slate-200 bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900">
                ← Back
              </Button>
              <SimpleMenu onPrint={handlePrint} onDownload={handleDownloadPDF} onShare={handleShare}/>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.98)_42%,rgba(15,23,42,0.04))] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <Badge variant="secondary" className="rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-800">
                    Pay Period
                  </Badge>
                  <h1 className="text-2xl font-bold md:text-3xl">
                    Estimated Earnings
                  </h1>
                  <p className="text-sm text-slate-600">
                    {formatHeaderDateRange(selected.periodStart, selected.periodEnd)}
                  </p>
                </div>
              </div>

              <div className={`mt-5 grid gap-3 ${taxEnabled ? "min-[520px]:grid-cols-2" : "min-[520px]:grid-cols-2 xl:grid-cols-3"}`}>
                <SummaryStatCard
                  label="Reported Earnings"
                  value={formatCurrency(Number(selected.grossIncome))}
                  scale={summaryCardScale}
                />
                {taxEnabled ? (
                  <SummaryStatCard
                    label="Estimated Deductions"
                    value={formatCurrency(totalDeductions)}
                    scale={summaryCardScale}
                  />
                ) : null}
                {taxEnabled ? (
                  <SummaryStatCard
                    label="Estimated Take-Home"
                    value={formatCurrency(Number(computedNet))}
                    tone="accent"
                    scale={summaryCardScale}
                  />
                ) : null}
                {selected.totalUnreported !== undefined && selected.totalUnreported > 0 ? (
                  <SummaryStatCard
                    label="Personal Cash"
                    value={formatCurrency(Number(selected.totalUnreported))}
                    tone="muted"
                    scale={summaryCardScale}
                  />
                ) : null}
              </div>

              <div className="mt-4 text-xs text-slate-500">
                <p>Calculated from current pay period entries.</p>
                {needsMarylandCounty ? (
                  <p className="mt-1 text-amber-700">
                    Add a Maryland residence county in tax settings to make this withholding estimate more accurate.
                  </p>
                ) : null}
              </div>
            </div>

            <section className="rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Pay Period Activity
                  </h2>
                </div>
                <Badge variant="outline" className="rounded-full border-slate-300 bg-white px-3 py-1 text-slate-700">
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
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
                        ...(paidHours > 0 ? [{ label: "Paid Hours", value: paidHours.toFixed(2) }] : []),
                        ...(rate != null ? [{ label: "Hourly Rate", value: formatCurrency(rate) }] : []),
                        ...(reportedCash > 0 ? [{ label: "Reported Cash", value: formatCurrency(reportedCash) }] : []),
                        ...(unreportedCash > 0 ? [{ label: "Personal Cash", value: formatCurrency(unreportedCash), subtle: true }] : []),
                    ];

                    return (
                        <motion.article
                          key={rowKey}
                          layout
                          className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-sm"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedActivityKey((current) => current === rowKey ? null : rowKey)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3.5 py-3 text-left min-[420px]:px-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                            aria-expanded={isExpanded}
                          >
                            <div className="min-w-0">
                              <p className="text-base font-semibold leading-tight text-slate-900 sm:text-[1.05rem]">
                                {entryDateLabel}
                              </p>
                            </div>

                            <motion.span
                              animate={{ rotate: isExpanded ? 180 : 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="row-span-2 flex h-9 w-9 items-center justify-center self-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 sm:row-span-1"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </motion.span>

                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold tabular-nums text-emerald-800">
                                Reported {formatGridCurrency(gross)}
                              </span>
                              {unreportedCash > 0 ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold tabular-nums text-amber-800">
                                  Personal {formatCurrency(unreportedCash)}
                                </span>
                              ) : null}
                            </div>
                          </button>

                          <AnimatePresence initial={false}>
                            {isExpanded ? (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden border-t border-slate-100"
                              >
                                <div className="space-y-2 px-4 py-3">
                                  {detailRows.length > 0 ? (
                                    detailRows.map((metric) => (
                                      <div
                                        key={`${metric.label}-${idx}`}
                                        className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 ${
                                          metric.subtle === true
                                            ? "border-amber-200/70 bg-amber-50/70"
                                            : "border-slate-200 bg-slate-50/90"
                                        }`}
                                      >
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                          {metric.label}
                                        </div>
                                        <div className={`text-sm font-semibold tabular-nums ${metric.subtle === true ? "text-amber-900" : "text-slate-900"}`}>
                                          {metric.value}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                                      No additional pay details were recorded for this entry.
                                    </p>
                                  )}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </motion.article>
                    );
                })}
              </div>

              <div className={`mt-4 grid gap-2 rounded-[1.5rem] border border-slate-200 bg-white p-4 ${activitySummary.length >= 5 ? "md:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
                {activitySummary.map((item) => (
                  <div key={item.label} className="rounded-2xl bg-slate-50 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {item.label}
                    </div>
                    <div className="mt-2 text-sm font-semibold tabular-nums text-slate-900">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {taxEnabled ? (
              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm deduction-box">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
                    <h2 className="text-lg font-semibold text-slate-900">
                      Estimated Taxes and Deductions
                    </h2>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {deductionRows.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="text-slate-600">{item.label}</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {formatSummaryCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                    {dedFica > 0 ? (
                      <div className="bg-slate-50 px-4 py-3 text-xs text-slate-600">
                        Includes Medicare {formatSummaryCurrency(dedMedicare)} and Social Security {formatSummaryCurrency(dedSocialSecurity)}.
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 font-semibold">
                      <span>Total Deductions</span>
                      <span className="tabular-nums">{formatCurrency(totalDeductions)}</span>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">
                          Year-to-Date
                        </h2>
                      </div>
                      <button type="button" onClick={() => setShowYTD((prev) => !prev)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900">
                        <motion.span
                          animate={{ rotate: showYTD ? 180 : 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="flex items-center"
                        >
                          <ChevronDown size={16}/>
                        </motion.span>
                        {showYTD ? "Hide" : "Expand"}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-2">
                    <MetricCell label="YTD Gross" value={formatCurrency(ytd.grossIncome)} />
                    <MetricCell label="YTD Net" value={formatCurrency(ytd.netIncome)} />
                  </div>

                  {showYTD ? (
                    <div className="grid gap-2 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
                      <MetricCell label="YTD Deductions" value={formatCurrency(ytd.totalDeductions)} />
                      <MetricCell label="YTD Tips" value={formatCurrency(ytd.tips)} />
                      <MetricCell label="YTD Reported Cash" value={formatCurrency(ytd.reportedCash)} />
                      <MetricCell label="YTD Personal Cash" value={formatCurrency(ytd.unreportedCash)} subtle />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </>);
    }
    return (<>
    <StackInHeader />
    <div className="mx-auto max-w-6xl space-y-4 p-4 xl:max-w-7xl">
      <YearlyEarningsGaugeCard year={yearlyGaugeSummary.year} payPeriods={yearlyGaugeSummary.payPeriods} totalGross={yearlyGaugeSummary.totalGross} breakdown={yearlyGaugeSummary.breakdown} cashBreakdown={yearlyGaugeSummary.cashBreakdown}/>

      <div>
        <div>
          <h1 className="mb-1 text-2xl font-bold">Earnings by Pay Period</h1>
          <p className="text-sm text-muted-foreground">
            Review your saved earnings estimates for each pay period.
          </p>
        </div>
      </div>

      {stubs.length === 0 ? (<p>No earnings estimates available yet.</p>) : (stubs.map((stub) => (<Card key={stub.periodId} className="transition shadow-sm hover:shadow-md">
            <CardHeader>
              <CardTitle>
                {formatHeaderDateRange(stub.periodStart, stub.periodEnd)}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className={`grid gap-2 text-sm ${stub.totalUnreported !== undefined && stub.totalUnreported > 0 ? "grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-3" : taxEnabled ? "grid-cols-1 min-[520px]:grid-cols-2" : "grid-cols-1"}`}>
                <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 min-[420px]:py-3.5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Gross</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(Number(stub.grossIncome))}
                  </div>
                </div>

                {taxEnabled && (<div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 min-[420px]:py-3.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Net</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(stub.netIncome))}
                    </div>
                  </div>)}

                {stub.totalUnreported !== undefined && stub.totalUnreported > 0 && (<div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 min-[420px]:py-3.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Unreported Cash</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(stub.totalUnreported))}
                    </div>
                  </div>)}
              </div>

              <Button className="mt-3" onClick={() => router.push(`/app/earnings?periodId=${encodeURIComponent(stub.periodId)}`)}>
                View Earnings
              </Button>
            </CardContent>
          </Card>)))}
    </div>
  </>);
}
