//paystubs/page.tsx
"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    ChevronUp,
    FileSpreadsheet,
    MoreVertical,
    Printer,
    Share2,
} from "lucide-react";
import AppLoader from "@/components/app-loader";
import { exportCsvFile } from "@/lib/documentExport";
import { formatCurrency } from "@/lib/helpers"; // added for consistent currency formatting
import { printHtmlDocument } from "@/lib/print";
import { Type as PayStub } from "@shared/schemas/paystub";
import { useAuth } from "@/contexts/auth-context";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { usePayStubsStore } from "@/lib/stores/usePaystubsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import StackInHeader from "@/components/stackin-header";
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
export default function PayStubsPage() {
    const router = useRouter();
    const [selected, setSelected] = useState<PayStub | null>(null);
    const [showYTD, setShowYTD] = useState(false);
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
            || (payStubsHasHydrated && payStubsStatus === "ready" && stubs.length === 0 && payStubsEntry?.lastBackendSync == null)
        : true;
    const hydratePayStubsFromCacheOnce = usePayStubsStore((s) => s.hydrateFromCacheOnce);
    const refreshPayStubs = usePayStubsStore((s) => s.refreshFromBackend);
    const taxEnabled = settings?.w2?.autoTaxCalculation === true;

    function formatHeaderDateRange(start: string, end: string) {
        const format = (value: string) => {
            const [year, month, day] = value.split("-");
            return `${month}/${day}/${year.slice(-2)}`;
        };
        return `${format(start)} - ${format(end)}`;
    }

    function formatGridDate(value: string) {
        const [, month, day] = value.split("-");
        return `${month}-${day}`;
    }

    function formatGridCurrency(value: number) {
        return value === 0 ? "—" : formatCurrency(value);
    }

    function formatGridNumber(value: number, digits = 2) {
        return value === 0 ? "—" : value.toFixed(digits);
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
            `Pay Stub: ${stub.periodStart} - ${stub.periodEnd}`,
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
                "Pay Stub Entry",
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
    // === PDF Download Handler (disabled for now) ===
    const handleDownloadPDF = async () => {
        if (!selected)
            return;
        const csv = buildCsv(selected);
        try {
            await exportCsvFile(`pay-stub-${selected.periodStart}-to-${selected.periodEnd}.csv`, csv, "Pay Stub CSV");
        }
        catch {
            alert("We couldn't export your pay stub CSV.");
        }
    };

    const handleShare = async () => {
        if (!selected)
            return;
        const text = buildShareText(selected);
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Pay Stub: ${selected.periodStart} - ${selected.periodEnd}`,
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
            window.alert("Pay stub summary copied so you can paste it into text or email.");
        }
        catch {
            window.alert(text);
        }
    };
    // === Print Handler (desktop + iOS friendly) ===
    const handlePrint = () => {
        const content = document.getElementById("paystub-content");
        if (!content)
            return;
        const printMarkup = `
        <html>
          <head>
            <title>Pay Stub</title>
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
            title: "Pay Stub",
            html: printMarkup,
        }).catch(() => {
            alert("We couldn't prepare your pay stub for printing.");
        });
    };
    if (authLoading ||
        workspaceState.status !== "ready" ||
        settingsLoading ||
        payStubsLoading) {
        return <AppLoader label="Loading pay stubs..."/>;
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
        const ytd = selected.ytdTotals || {
            grossIncome: 0,
            netIncome: 0,
            totalDeductions: 0,
            tips: 0,
            reportedCash: 0,
            unreportedCash: 0,
        };
        return (<div className="px-2 md:px-4 py-4 w-full max-w-5xl mx-auto overflow-y-auto text-slate-900">
        {/* === Paystub Content === */}
        <div id="paystub-content" className="bg-white rounded-lg shadow-sm space-y-4 p-4 md:p-6">
          <div className="flex items-start justify-between gap-3 no-print">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} className="shrink-0 border-slate-200 bg-gray-100 text-slate-900 hover:bg-gray-200 hover:text-slate-900">
              ← Back
            </Button>
            <SimpleMenu onPrint={handlePrint} onDownload={handleDownloadPDF} onShare={handleShare}/>
          </div>

          <h1 className="text-2xl font-bold">
            Estimated Pay Earnings: {formatHeaderDateRange(selected.periodStart, selected.periodEnd)}
          </h1>
          <p className="text-sm text-slate-500">
            Based on your entries and current tax settings.
          </p>

          {/* === Earnings Table (Reported vs Unreported) === */}
          <div className="mt-4 -mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100 sm:mx-0 sm:px-0" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="min-w-[40rem] border-collapse border border-gray-300 bg-white text-xs sm:min-w-full sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="sticky left-0 z-10 border border-gray-300 bg-gray-100 px-2 py-2 text-left whitespace-nowrap sm:px-3">Date</th>
                  <th className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3">Tips</th>
                  <th className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3">Hours</th>
                  <th className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3">Rate</th>
                  {hasReportedCash && (<th className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3">Reported Cash</th>)}
                  <th className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3">Reported Earnings</th>
                  {hasUnreportedCash && (<th className="border border-gray-300 px-2 py-2 text-right text-slate-700 whitespace-nowrap sm:px-3">Personal Cash</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: Record<string, any>, idx: number) => (<tr key={idx} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-[1] border border-gray-300 bg-white px-2 py-2 text-left whitespace-nowrap sm:px-3 sm:text-sm">{formatGridDate(row.date)}</td>
                    <td className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3 sm:text-sm">
                      {formatGridCurrency(getRowTips(row))}
                    </td>
                    <td className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3 sm:text-sm">
                      {formatGridNumber(getRowPaidHours(row))}
                    </td>
                    <td className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3 sm:text-sm">
                      {getRowRate(row) != null
                    ? formatGridCurrency(getRowRate(row) as number)
                        : "—"}
                    </td>
                    {hasReportedCash && (<td className="border border-gray-300 px-2 py-2 text-right whitespace-nowrap sm:px-3 sm:text-sm">
                        {formatGridCurrency(getRowReportedCash(row))}
                      </td>)}
                    <td className="border border-gray-300 px-2 py-2 font-medium text-right whitespace-nowrap sm:px-3 sm:text-sm">
                      {formatGridCurrency(getRowGross(row))}
                    </td>
                    {hasUnreportedCash && (<td className="border border-gray-300 px-2 py-2 text-slate-600 text-right whitespace-nowrap sm:px-3 sm:text-sm">
                        {formatGridCurrency(getRowUnreportedCash(row))}
                      </td>)}
                  </tr>))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="sticky left-0 z-[1] border border-gray-300 bg-gray-50 px-2 py-1.5 text-left whitespace-nowrap sm:px-3">Totals</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right whitespace-nowrap sm:px-3">
                    {formatCurrency(totals.tips)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right whitespace-nowrap sm:px-3">
                    {totals.paidHours.toFixed(2)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1.5 sm:px-3"></td>
                  {hasReportedCash && (<td className="border border-gray-300 px-2 py-1.5 text-right whitespace-nowrap sm:px-3">
                      {formatCurrency(totals.reported)}
                    </td>)}
                  <td className="border border-gray-300 px-2 py-1.5 text-right whitespace-nowrap sm:px-3">
                    {formatCurrency(totals.gross)}
                  </td>
                  {hasUnreportedCash && (<td className="border border-gray-300 px-2 py-1.5 text-slate-600 text-right whitespace-nowrap sm:px-3">
                      {formatCurrency(totals.unreported)}
                    </td>)}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* === Deductions Summary === */}
          {taxEnabled && (<>
              <div className="mt-8 border border-gray-300 rounded-lg overflow-hidden w-full max-w-md deduction-box">
                <div className="bg-gray-100 border-b border-gray-300 px-3 py-2 font-semibold">
                  Estimated Taxes and Deductions
                </div>
                <div className="divide-y divide-gray-200">
                  {deductionRows.map((item) => (<div key={item.label} className="flex justify-between px-4 py-2">
                      <span>{item.label}</span>
                      <span>{formatSummaryCurrency(item.amount)}</span>
                    </div>))}
                  {dedFica > 0 && (<div className="px-4 py-2 text-xs text-gray-600 bg-gray-50">
                      Includes Medicare {formatSummaryCurrency(dedMedicare)} and Social Security {formatSummaryCurrency(dedSocialSecurity)}.
                    </div>)}
                  <div className="flex justify-between px-4 py-2 font-semibold bg-gray-50">
                    <span>Total Deductions</span>
                    <span>{formatCurrency(totalDeductions)}</span>
                  </div>
                </div>

                {ytd && (<div className="p-3 bg-gray-50 border-t border-gray-300">
                    <button type="button" onClick={() => setShowYTD((prev) => !prev)} className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900">
                      {showYTD ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                      {showYTD ? "Hide YTD Totals" : "View YTD Totals"}
                    </button>

                    {showYTD && (<div className="mt-3 text-sm text-gray-700 space-y-1">
                        <div className="flex justify-between">
                          <span>YTD Gross:</span>
                          <span>{formatCurrency(ytd.grossIncome)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>YTD Net:</span>
                          <span>{formatCurrency(ytd.netIncome)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>YTD Deductions:</span>
                          <span>{formatCurrency(ytd.totalDeductions)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>YTD Tips:</span>
                          <span>{formatCurrency(ytd.tips)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>YTD Reported Cash:</span>
                          <span>{formatCurrency(ytd.reportedCash)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>YTD Unreported Cash:</span>
                          <span>{formatCurrency(ytd.unreportedCash)}</span>
                        </div>
                      </div>)}
                  </div>)}
              </div>

              {/* === Summary row: Gross – Deductions = Net === */}
              <div className="mt-6 w-full max-w-xl">
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <div className="flex flex-col items-center justify-center border rounded-md bg-white py-2">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      Gross
                    </span>
                    <span className="font-semibold text-gray-800">
                      {formatCurrency(Number(selected.grossIncome))}
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center border rounded-md bg-white py-2">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      Deductions
                    </span>
                    <span className="font-semibold text-gray-800">
                      −{formatCurrency(totalDeductions)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center border rounded-md bg-gray-50 py-2">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      Net
                    </span>
                    <span className="font-bold text-emerald-700">
                      {formatCurrency(Number(computedNet))}
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-xs text-slate-500 text-center">
                  <p>Calculated from current pay period entries.</p>
                  {needsMarylandCounty && (<p className="mt-1 text-amber-700">
                      Add a Maryland residence county in tax settings to make this withholding estimate more accurate.
                    </p>)}
                </div>
              </div>
            </>)}

          {selected.totalUnreported !== undefined && selected.totalUnreported > 0 && (<div className="mt-6 w-full max-w-xl">
              <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-gray-50 text-sm">
                <span className="font-medium">Unreported Cash (Personal)</span>
                <span>{formatCurrency(Number(selected.totalUnreported))}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                This amount was excluded from taxable income and paycheck calculations.
              </p>
            </div>)}
        </div>
      </div>);
    }
    return (<>
    <StackInHeader />
    <div className="space-y-4 p-4">
      <div>
        <div>
          <h1 className="mb-1 text-2xl font-bold">Estimated Paychecks</h1>
          <p className="text-sm text-muted-foreground">
            Review your saved estimated paychecks for each pay period.
          </p>
        </div>
      </div>

      {stubs.length === 0 ? (<p>No estimated paychecks available yet.</p>) : (stubs.map((stub) => (<Card key={stub.periodId} className="transition shadow-sm hover:shadow-md">
            <CardHeader>
              <CardTitle>
                {formatHeaderDateRange(stub.periodStart, stub.periodEnd)}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className={`grid gap-2 text-sm ${stub.totalUnreported !== undefined && stub.totalUnreported > 0 ? "grid-cols-1 sm:grid-cols-3" : taxEnabled ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
                <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Gross</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(Number(stub.grossIncome))}
                  </div>
                </div>

                {taxEnabled && (<div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Net</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(stub.netIncome))}
                    </div>
                  </div>)}

                {stub.totalUnreported !== undefined && stub.totalUnreported > 0 && (<div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Unreported Cash</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(stub.totalUnreported))}
                    </div>
                  </div>)}
              </div>

              <Button className="mt-3" onClick={() => setSelected(stub)}>
                View Estimate
              </Button>
            </CardContent>
          </Card>)))}
    </div>
  </>);
}
