"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  Printer,
  Share2,
} from "lucide-react"
import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import HoursWorkedCard from "@/components/hours-worked-card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/contexts/auth-context"
import { exportCsvFile } from "@/lib/documentExport"
import { formatDate, formatCurrency } from "@/lib/helpers"
import { printHtmlDocument } from "@/lib/print"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useProfitLossStore } from "@/lib/stores/useProfitLossStore"
import type {
  ProfitLossDetailItem,
  ProfitLossExpenseCategory,
  ProfitLossIncomeCategoryDetail,
  ProfitLossPeriodType,
  ProfitLossStatement,
} from "@shared/schemas/profitLoss"

const OTHER_EXPENSE_SUBCATEGORY_PRIORITY = [
  "Education & Training",
  "Software & Subscriptions",
  "Work Clothing",
] as const

type ExpenseDisplaySubcategory = {
  label: string
  amount: number
  count: number
  items: ProfitLossDetailItem[]
}

type ExpenseDisplayRow = {
  rowKey: string
  label: string
  amount: number
  items: ProfitLossDetailItem[]
  countLabel: string
  subcategories?: ExpenseDisplaySubcategory[]
}

function buildExpenseDisplayRows(
  categories: ProfitLossExpenseCategory[]
): ExpenseDisplayRow[] {
  return categories
    .filter((item) => item.amount > 0)
    .map((item) => {
      if (item.category !== "Other expenses") {
        return {
          rowKey: `expense-${item.category}`,
          label: item.category,
          amount: item.amount,
          items: item.items,
          countLabel: `${item.count} ${item.count === 1 ? "expense" : "expenses"}`,
        }
      }

      const grouped = new Map<string, ExpenseDisplaySubcategory>()
      for (const detail of item.items) {
        const subcategoryLabel = detail.appCategory?.trim() || "Other Expenses"
        const current = grouped.get(subcategoryLabel) ?? {
          label: subcategoryLabel,
          amount: 0,
          count: 0,
          items: [],
        }
        current.amount += detail.amount
        current.count += 1
        current.items.push(detail)
        grouped.set(subcategoryLabel, current)
      }

      const subcategories = [...grouped.values()]
        .map((subcategory) => ({
          ...subcategory,
          amount: Math.round(subcategory.amount * 100) / 100,
          items: [...subcategory.items].sort(
            (left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label)
          ),
        }))
        .sort((left, right) => {
          const leftPriority = OTHER_EXPENSE_SUBCATEGORY_PRIORITY.indexOf(
            left.label as (typeof OTHER_EXPENSE_SUBCATEGORY_PRIORITY)[number]
          )
          const rightPriority = OTHER_EXPENSE_SUBCATEGORY_PRIORITY.indexOf(
            right.label as (typeof OTHER_EXPENSE_SUBCATEGORY_PRIORITY)[number]
          )

          if (leftPriority !== -1 || rightPriority !== -1) {
            if (leftPriority === -1) return 1
            if (rightPriority === -1) return -1
            return leftPriority - rightPriority
          }

          return left.label.localeCompare(right.label)
        })

      return {
        rowKey: `expense-${item.category}`,
        label: "Other Expenses",
        amount: item.amount,
        items: item.items,
        countLabel: `${item.count} ${item.count === 1 ? "expense" : "expenses"}`,
        subcategories,
      }
    })
}

const periodOptions: Array<{
  value: ProfitLossPeriodType
  label: string
}> = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
]

function StatementValue({ value, negativeClassName = "text-red-600" }: {
  value: number
  negativeClassName?: string
}) {
  return (
    <span className={value < 0 ? negativeClassName : undefined}>
      {formatCurrency(value)}
    </span>
  )
}

function StatementDetailList({ items, emptyLabel }: {
  items: ProfitLossDetailItem[]
  emptyLabel: string
}) {
  if (items.length === 0) {
    return (
      <div className="border-t border-[rgba(16,24,40,0.08)] px-4 py-3 text-sm text-slate-500">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="border-t border-[rgba(16,24,40,0.08)] bg-[rgba(248,250,252,0.9)]">
      {items.map((item) => (
        <div
          key={item.id}
          className="grid gap-2 border-b border-[rgba(16,24,40,0.08)] px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_120px] sm:gap-3"
        >
          <div className="text-slate-500 sm:self-start">{formatDate(item.date)}</div>
          <div className="min-w-0">
            <div className="whitespace-normal break-words font-medium text-slate-900">
              {item.label}
            </div>
            {item.description ? (
              <div className="mt-0.5 whitespace-normal break-words text-xs text-slate-500">
                {item.description}
              </div>
            ) : null}
          </div>
          <div className="font-medium text-slate-900 sm:text-right">
            {formatCurrency(item.amount)}
          </div>
        </div>
      ))}
    </div>
  )
}

function StatementSubcategoryList({
  subcategories,
  emptyLabel,
}: {
  subcategories: ExpenseDisplaySubcategory[]
  emptyLabel: string
}) {
  if (subcategories.length === 0) {
    return (
      <div className="border-t border-[rgba(16,24,40,0.08)] px-4 py-3 text-sm text-slate-500">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="border-t border-[rgba(16,24,40,0.08)] bg-[rgba(248,250,252,0.9)]">
      {subcategories.map((subcategory) => (
        <div key={subcategory.label} className="border-b border-[rgba(16,24,40,0.08)] last:border-b-0">
          <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {subcategory.label}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {subcategory.count} {subcategory.count === 1 ? "expense" : "expenses"}
              </div>
            </div>
            <div className="font-medium tabular-nums text-slate-900 sm:text-right">
              {formatCurrency(subcategory.amount)}
            </div>
          </div>
          <StatementDetailList
            items={subcategory.items}
            emptyLabel={`No ${subcategory.label.toLowerCase()} expenses in this period.`}
          />
        </div>
      ))}
    </div>
  )
}

function StatementCategoryRow({
  rowKey,
  label,
  amount,
  items,
  countLabel,
  subcategories,
}: {
  rowKey: string
  label: string
  amount: number
  items: ProfitLossDetailItem[]
  countLabel: string
  subcategories?: ExpenseDisplaySubcategory[]
}) {
  const expandable = items.length > 0

  if (!expandable) {
    return (
      <div className="grid grid-cols-1 items-start gap-1 border-b border-[rgba(16,24,40,0.08)] px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_140px] sm:items-center sm:gap-4">
        <div className="font-medium text-slate-900">{label}</div>
        <div className="font-medium tabular-nums text-slate-900 sm:text-right">{formatCurrency(amount)}</div>
      </div>
    )
  }

  return (
    <AccordionItem value={rowKey} className="border-b-0">
      <AccordionTrigger className="grid grid-cols-[minmax(0,1fr)_16px] items-start gap-3 px-4 py-3 hover:no-underline sm:grid-cols-[minmax(0,1fr)_140px_16px] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{label}</div>
          <div className="mt-1 text-xs text-slate-500">{countLabel}</div>
        </div>
        <div className="hidden font-medium tabular-nums text-slate-900 sm:block sm:text-right">{formatCurrency(amount)}</div>
        <div className="col-span-2 -mt-1 font-medium tabular-nums text-slate-900 sm:hidden">{formatCurrency(amount)}</div>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        {subcategories && subcategories.length > 0 ? (
          <StatementSubcategoryList
            subcategories={subcategories}
            emptyLabel={`No ${label.toLowerCase()} transactions in this period.`}
          />
        ) : (
          <StatementDetailList items={items} emptyLabel={`No ${label.toLowerCase()} transactions in this period.`} />
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

function StatementSection({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: Array<{
    rowKey: string
    label: string
    amount: number
    items: ProfitLossDetailItem[]
    countLabel: string
  }>
  emptyLabel: string
}) {
  return (
    <section className="border-t border-[rgba(16,24,40,0.14)]">
      <div className="border-b border-[rgba(16,24,40,0.08)] bg-[rgba(248,250,252,0.85)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(17,24,39,0.7)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-4 text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <Accordion type="multiple" className="w-full">
          {rows.map((row) => (
            <StatementCategoryRow key={row.rowKey} {...row} />
          ))}
        </Accordion>
      )}
    </section>
  )
}

function StatementActionMenu({
  className,
  onPrint,
  onShare,
  onExportCsv,
}: {
  className?: string
  onPrint: () => void
  onShare: () => void
  onExportCsv: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [])

  return (
    <div ref={ref} className={className ?? "relative"}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <MoreVertical className="h-5 w-5" />
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-[9999] mt-2 w-40 rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onPrint()
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onShare()
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100"
          >
            <Share2 className="h-4 w-4" />
            Share
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onExportCsv()
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-100"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function ProfitLossPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const [periodType, setPeriodType] = useState<ProfitLossPeriodType>("month")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)

  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const entry = useProfitLossStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId]?.[periodType] : undefined
  )
  const monthEntry = useProfitLossStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId]?.["month"] : undefined
  )
  const yearEntry = useProfitLossStore((s) =>
    activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId]?.["year"] : undefined
  )
  const hydrateFromCacheOnce = useProfitLossStore((s) => s.hydrateFromCacheOnce)
  const refreshFromBackend = useProfitLossStore((s) => s.refreshFromBackend)

  const statements = entry?.statements ?? []
  const hasHydrated = entry?.hasHydrated ?? false
  const status = entry?.status ?? "idle"
  const loading = activeWorkspaceId
    ? !hasHydrated ||
      status === "loading" ||
      (hasHydrated &&
        status === "ready" &&
        statements.length === 0 &&
        entry?.lastSuccessfulSyncAt == null)
    : true

  useEffect(() => {
    if (authLoading || workspaceState.status !== "ready") return

    if (!user) {
      router.replace("/login")
      return
    }

    if (activeWorkspace?.type === "w2") {
      router.replace("/app/earnings")
    }
  }, [authLoading, workspaceState.status, user, activeWorkspace?.type, router])

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    hydrateFromCacheOnce(activeWorkspaceId, periodType)
  }, [activeWorkspaceId, activeWorkspace?.type, periodType, hydrateFromCacheOnce])

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    if (!hasHydrated) return
    refreshFromBackend(activeWorkspaceId, periodType, { force: false })
  }, [
    activeWorkspaceId,
    activeWorkspace?.type,
    hasHydrated,
    periodType,
    refreshFromBackend,
  ])

  // Hours Worked card always shows this-month/this-year figures regardless of
  // which statement tab is active, so month + year statements are kept hydrated independently.
  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    hydrateFromCacheOnce(activeWorkspaceId, "month")
    hydrateFromCacheOnce(activeWorkspaceId, "year")
  }, [activeWorkspaceId, activeWorkspace?.type, hydrateFromCacheOnce])

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspace?.type !== "independent") return
    if (monthEntry?.hasHydrated) refreshFromBackend(activeWorkspaceId, "month", { force: false })
    if (yearEntry?.hasHydrated) refreshFromBackend(activeWorkspaceId, "year", { force: false })
  }, [
    activeWorkspaceId,
    activeWorkspace?.type,
    monthEntry?.hasHydrated,
    yearEntry?.hasHydrated,
    refreshFromBackend,
  ])

  useEffect(() => {
    setSelectedId((current) => {
      if (statements.length === 0) return null
      if (current && statements.some((statement) => statement.id === current)) return current
      return null
    })
  }, [statements])

  const selected = useMemo(
    () => statements.find((statement) => statement.id === selectedId) ?? null,
    [statements, selectedId]
  )

  const hoursStats = useMemo(() => {
    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const currentYearKey = String(now.getFullYear())
    const thisMonthStatement = monthEntry?.statements.find((s) => s.periodKey === currentMonthKey) ?? null
    const thisYearStatement = yearEntry?.statements.find((s) => s.periodKey === currentYearKey) ?? null
    return {
      thisMonthHours: thisMonthStatement?.hours.total ?? 0,
      thisYearHours: thisYearStatement?.hours.total ?? 0,
      avgPerWeek: thisYearStatement?.hours.avgPerWeek ?? 0,
    }
  }, [monthEntry?.statements, yearEntry?.statements])

  const detailLabel = useMemo(() => {
    if (periodType === "month") return "Month P&L"
    if (periodType === "quarter") return "Quarter P&L"
    return "Year P&L"
  }, [periodType])

  const incomeCategoryDetails = useMemo<ProfitLossIncomeCategoryDetail[]>(
    () => (selected?.income.categories ?? []).filter((item) => item.amount > 0),
    [selected]
  )

  const expenseCategoryDetails = useMemo<ProfitLossExpenseCategory[]>(
    () => (selected?.expenses.byCategory ?? []).filter((item) => item.amount > 0),
    [selected]
  )

  const expenseDisplayRows = useMemo<ExpenseDisplayRow[]>(() => {
    return buildExpenseDisplayRows(expenseCategoryDetails)
  }, [expenseCategoryDetails])

  function buildShareText(statement: ProfitLossStatement) {
    return [
      `${statement.label} Profit & Loss Statement`,
      `${statement.periodStart} to ${statement.periodEnd}`,
      `Gross Income: ${formatCurrency(statement.income.total)}`,
      `Gross Expenses: ${formatCurrency(statement.expenses.total)}`,
      `Net Income: ${formatCurrency(statement.netProfit)}`,
    ].join("\n")
  }

  function buildCsv(statement: ProfitLossStatement) {
    const expenseRows = buildExpenseDisplayRows(statement.expenses.byCategory)
    const rows = [
      ["Section", "Label", "Amount", "Count", "Transaction Date", "Transaction Label", "Transaction Description"],
      ["Summary", "Gross Income", statement.income.total, "", "", "", ""],
      ["Summary", "Gross Expenses", statement.expenses.total, "", "", "", ""],
      ["Summary", "Net Income", statement.netProfit, "", "", "", ""],
      ...statement.income.categories.filter((item) => item.amount > 0).flatMap((item) => [
        ["Revenue", item.label, item.amount, item.count, "", "", ""],
        ...item.items.map((detail) => [
          "Revenue Detail",
          item.label,
          detail.amount,
          "",
          detail.date,
          detail.label,
          detail.description ?? "",
        ]),
      ]),
      ...expenseRows.flatMap((item) => [
        ["Operating Expenses", item.label, item.amount, item.items.length, "", "", ""],
        ...(item.subcategories && item.subcategories.length > 0
          ? item.subcategories.flatMap((subcategory) => [
              ["Operating Expense Subcategory", subcategory.label, subcategory.amount, subcategory.count, "", "", ""],
              ...subcategory.items.map((detail) => [
                "Operating Expense Detail",
                `${item.label} / ${subcategory.label}`,
                detail.amount,
                "",
                detail.date,
                detail.label,
                detail.description ?? "",
              ]),
            ])
          : item.items.map((detail) => [
              "Operating Expense Detail",
              item.label,
              detail.amount,
              "",
              detail.date,
              detail.label,
              detail.description ?? "",
            ])),
      ]),
    ]

    return rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n")
  }

  function handleExportCsv(statement: ProfitLossStatement) {
    const csv = buildCsv(statement)
    void exportCsvFile(
      `${statement.label.toLowerCase().replace(/\s+/g, "-")}-profit-loss.csv`,
      csv,
      `${statement.label} Profit & Loss CSV`
    ).catch(() => {
      window.alert("We couldn't export your profit & loss CSV.")
    })
  }

  async function handleShare(statement: ProfitLossStatement) {
    const text = buildShareText(statement)

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${statement.label} Profit & Loss Statement`,
          text,
        })
        return
      } catch {
        // Fall through to clipboard if share sheet is dismissed or unavailable.
      }
    }

    try {
      await navigator.clipboard.writeText(text)
      window.alert("Profit & loss summary copied so you can paste it into text or email.")
    } catch {
      window.alert(text)
    }
  }

  function buildPrintMarkup(statement: ProfitLossStatement) {
    const expenseRowsForPrint = buildExpenseDisplayRows(statement.expenses.byCategory)
    const renderDetailRows = (
      items: ProfitLossDetailItem[],
      emptyLabel: string
    ) =>
      items.length > 0
        ? items
            .map(
              (item) => `
                <tr class="detail-row">
                  <td class="detail-date">${formatDate(item.date)}</td>
                  <td>
                    <div class="detail-label">${item.label}</div>
                    ${item.description ? `<div class="detail-description">${item.description}</div>` : ""}
                  </td>
                  <td class="amount">${formatCurrency(item.amount)}</td>
                </tr>
              `
            )
            .join("")
        : `
            <tr class="detail-row">
              <td colspan="3" class="detail-empty">${emptyLabel}</td>
            </tr>
          `

    const revenueRows = statement.income.categories
      .filter((item) => item.amount > 0)
      .map(
        (item) => `
          <tr class="summary-row">
            <td colspan="2">${item.label}</td>
            <td class="amount">${formatCurrency(item.amount)}</td>
          </tr>
          ${renderDetailRows(item.items, `No ${item.label.toLowerCase()} transactions in this period.`)}
        `
      )
      .join("")

    const expenseRows =
      expenseRowsForPrint.length > 0
        ? expenseRowsForPrint
            .map(
              (item) => `
                <tr class="summary-row">
                  <td colspan="2">${item.label}</td>
                  <td class="amount">${formatCurrency(item.amount)}</td>
                </tr>
                ${item.subcategories && item.subcategories.length > 0
                  ? item.subcategories
                      .map(
                        (subcategory) => `
                          <tr class="detail-row">
                            <td></td>
                            <td>
                              <div class="detail-label" style="font-weight:700;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#64748b;">
                                ${subcategory.label}
                              </div>
                            </td>
                            <td class="amount">${formatCurrency(subcategory.amount)}</td>
                          </tr>
                          ${renderDetailRows(
                            subcategory.items,
                            `No ${subcategory.label.toLowerCase()} expenses in this period.`
                          )}
                        `
                      )
                      .join("")
                  : renderDetailRows(item.items, `No ${item.label.toLowerCase()} transactions in this period.`)}
              `
            )
            .join("")
        : `<tr><td colspan="3" class="detail-empty">No expenses in this period.</td></tr>`

    return `
      <html>
        <head>
          <title>${statement.label} Profit & Loss Statement</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            @page { margin: 0.65in; }
            body {
              font-family: "Times New Roman", Georgia, serif;
              color: #1f2937;
              margin: 0;
              padding: 24px;
              background: #fff;
            }
            .statement {
              border: 1px solid #cbd5e1;
            }
            .header {
              text-align: center;
              padding: 18px 24px;
              border-bottom: 1px solid #cbd5e1;
            }
            .business-name {
              font-size: 20px;
              font-weight: 700;
            }
            .statement-title {
              margin-top: 4px;
              font-size: 18px;
              font-weight: 700;
            }
            .statement-period {
              margin-top: 4px;
              font-size: 14px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            td, th {
              border-bottom: 1px solid #e5e7eb;
              padding: 10px 16px;
              text-align: left;
              vertical-align: top;
            }
            .section-title td {
              padding-top: 14px;
              padding-bottom: 8px;
              font-size: 12px;
              font-weight: 700;
              letter-spacing: 0.14em;
              color: #475569;
              text-transform: uppercase;
              background: #f8fafc;
            }
            .amount {
              text-align: right;
            }
            .summary-row td {
              font-size: 15px;
            }
            .detail-row td {
              font-size: 13px;
              color: #475569;
              background: #fcfcfd;
            }
            .detail-date {
              width: 100px;
              white-space: nowrap;
            }
            .detail-label {
              color: #111827;
            }
            .detail-description {
              margin-top: 2px;
              font-size: 12px;
              color: #6b7280;
            }
            .detail-empty {
              font-style: italic;
              color: #6b7280;
            }
            .total-row td {
              font-weight: 700;
              background: #f8fafc;
            }
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="statement">
            <div class="header">
              <div class="business-name">${activeWorkspace?.name ?? "Business Name"}</div>
              <div class="statement-title">Profit & Loss Statement</div>
              <div class="statement-period">For ${statement.label}</div>
            </div>

            <table>
              <tbody>
                <tr class="section-title"><td colspan="3">Revenue</td></tr>
                ${revenueRows}
                <tr class="total-row">
                  <td colspan="2">Gross Profit</td>
                  <td class="amount">${formatCurrency(statement.income.total)}</td>
                </tr>

                <tr class="section-title"><td colspan="3">Operating Expenses</td></tr>
                ${expenseRows}
                <tr class="total-row">
                  <td colspan="2">Total Operating Expenses</td>
                  <td class="amount">${formatCurrency(statement.expenses.total)}</td>
                </tr>
                <tr class="total-row">
                  <td colspan="2">Net Income</td>
                  <td class="amount">${formatCurrency(statement.netProfit)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style="margin-top:24px;color:#6b7280;font-size:12px;">
            Generated ${new Date(statement.meta.generatedAt).toLocaleString()}.
          </p>
        </body>
      </html>
    `
  }

  function handlePrint(statement: ProfitLossStatement) {
    const printMarkup = buildPrintMarkup(statement)
    void printHtmlDocument({
      title: `${statement.label} Profit & Loss Statement`,
      html: printMarkup,
    }).catch(() => {
      window.alert("We couldn't open the print dialog for your profit & loss statement.")
    })
  }

  if (authLoading || workspaceState.status !== "ready") {
    return <AppLoader label="Loading profit and loss..." />
  }

  if (activeWorkspace?.type !== "independent") {
    return null
  }

  return (
    <>
      <StackInHeader />
      <div className="w-full max-w-6xl mx-auto space-y-6 px-4 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
            <p className="text-sm text-muted-foreground">
              Statements refresh automatically when income entries or expenses change, including
              in-progress quarter and year rollups.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              {periodOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={periodType === option.value ? "default" : "outline"}
                  className="rounded-full px-4 sm:px-5"
                  onClick={() => setPeriodType(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <HoursWorkedCard
          variant="simple"
          thisMonthHours={hoursStats.thisMonthHours}
          thisYearHours={hoursStats.thisYearHours}
          avgPerWeek={hoursStats.avgPerWeek}
          hideWhenEmpty
        />

        <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-900">
              {periodType === "month"
                ? "Monthly Statements"
                : periodType === "quarter"
                  ? "Quarterly Statements"
                  : "Yearly Statements"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">
                Select a {periodType === "month" ? "month" : periodType === "quarter" ? "quarter" : "year"}
              </div>
              <Select
                value={selectedId ?? undefined}
                onValueChange={(value) => {
                  setSelectedId(value)
                  setDetailsCollapsed(false)
                }}
              >
                <SelectTrigger className="w-full justify-between rounded-xl border-slate-200 bg-white text-slate-900 hover:bg-slate-50 data-[placeholder]:text-slate-500 [&_svg]:text-slate-500">
                  <SelectValue
                    placeholder={
                      statements.length > 0
                        ? `Choose a ${periodType === "month" ? "month" : periodType === "quarter" ? "quarter" : "year"}`
                        : `No ${periodType} statements available`
                    }
                  />
                </SelectTrigger>
                <SelectContent
                  sideOffset={12}
                  collisionPadding={{ top: 88, bottom: 16, left: 16, right: 16 }}
                  className="z-[3000] border-slate-200 bg-white text-slate-900 shadow-lg"
                >
                  {statements.map((statement) => (
                    <SelectItem
                      key={statement.id}
                      value={statement.id}
                      className="text-slate-900 focus:bg-slate-100 focus:text-slate-900"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{statement.label}</span>
                        <span className="text-xs text-slate-500">
                          Net {formatCurrency(statement.netProfit)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading && statements.length === 0 ? (
              <div className="flex items-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading saved statements...
              </div>
            ) : null}

            {!loading && statements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                No {periodType} statements available yet.
              </div>
            ) : null}

            {selected ? (
              <div className="rounded-xl border border-slate-200 bg-[rgba(248,250,252,0.7)] px-4 py-3 text-sm text-slate-900">
                <div className="font-medium text-slate-900">{selected.label}</div>
                <div className="mt-1 text-slate-500 sm:hidden">
                  <div className="tabular-nums">Income {formatCurrency(selected.income.total)}</div>
                  <div className="tabular-nums">Expenses {formatCurrency(selected.expenses.total)}</div>
                  <div className="tabular-nums">Net {formatCurrency(selected.netProfit)}</div>
                </div>
                <div className="mt-1 hidden text-slate-500 sm:block">
                  Income {formatCurrency(selected.income.total)} · Expenses{" "}
                  {formatCurrency(selected.expenses.total)} · Net {formatCurrency(selected.netProfit)}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="items-start grid gap-6">
          <Card
            id="profit-loss-content"
            className="self-start overflow-hidden border-slate-200 bg-white text-slate-900 shadow-sm"
          >
            {selected ? (
              <>
                <CardHeader className="relative flex flex-col items-center gap-4 border-b border-slate-200 bg-[linear-gradient(180deg,#fefefe_0%,#f8fafc_100%)] pr-16 text-center sm:items-start sm:pr-20 sm:text-left">
                  <StatementActionMenu
                    className="absolute right-6 top-6"
                    onPrint={() => handlePrint(selected)}
                    onShare={() => void handleShare(selected)}
                    onExportCsv={() => handleExportCsv(selected)}
                  />
                  <div className="w-full text-center sm:text-left">
                    <p className="text-lg font-semibold text-slate-900">Profit &amp; Loss Statement</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">{activeWorkspace?.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{selected.label}</p>
                  </div>
                  <div className="flex w-full shrink-0 flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-slate-200 bg-white text-slate-900 hover:bg-slate-50 hover:text-slate-900"
                      onClick={() => setDetailsCollapsed((current) => !current)}
                    >
                      {detailsCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                      {detailsCollapsed ? "Expand" : "Collapse"}
                    </Button>
                  </div>
                </CardHeader>
                {!detailsCollapsed ? (
                <CardContent className="space-y-6 px-0 pb-6">
                  <div className="grid grid-cols-1 gap-1 border-b border-[rgba(16,24,40,0.14)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(17,24,39,0.55)] sm:grid-cols-[minmax(0,1fr)_140px]">
                    <div>Description</div>
                    <div className="sm:text-right">Amount</div>
                  </div>

                  <StatementSection
                    title="Revenue"
                    rows={incomeCategoryDetails.map((item) => ({
                      rowKey: `income-${item.category}`,
                      label: item.label,
                      amount: item.amount,
                      items: item.items,
                      countLabel: `${item.count} ${item.count === 1 ? "transaction" : "transactions"}`,
                    }))}
                    emptyLabel="No revenue recorded in this period."
                  />

                  <div className="grid grid-cols-1 gap-1 border-t border-[rgba(16,24,40,0.14)] border-b border-[rgba(16,24,40,0.08)] bg-[rgba(248,250,252,0.85)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(17,24,39,0.7)] sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-4">
                    <div>Gross Profit</div>
                    <div className="normal-case tracking-normal text-sm font-semibold tabular-nums text-slate-900 sm:text-right">
                      <StatementValue value={selected.income.total} />
                    </div>
                  </div>

                  <StatementSection
                    title="Operating Expenses"
                    rows={expenseDisplayRows}
                    emptyLabel="No operating expenses recorded in this period."
                  />

                  <div className="grid grid-cols-1 gap-1 border-t border-[rgba(16,24,40,0.14)] border-b border-[rgba(16,24,40,0.08)] bg-[rgba(248,250,252,0.85)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(17,24,39,0.7)] sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-4">
                    <div>Total Operating Expenses</div>
                    <div className="normal-case tracking-normal text-sm font-semibold tabular-nums text-slate-900 sm:text-right">
                      <StatementValue value={selected.expenses.total} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-1 border-t border-[rgba(16,24,40,0.14)] bg-[linear-gradient(180deg,rgba(255,251,235,0.72)_0%,rgba(255,247,237,0.92)_100%)] px-4 py-4 text-sm font-semibold text-slate-900 sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-4">
                    <div className="font-serif text-lg tracking-[0.01em]">Net Income</div>
                    <div className="font-serif text-lg tabular-nums sm:text-right">
                      <StatementValue value={selected.netProfit} />
                    </div>
                  </div>

                  <div className="text-xs text-slate-500">
                    Generated {new Date(selected.meta.generatedAt).toLocaleString()}.
                  </div>
                </CardContent>
                ) : null}
              </>
              ) : (
                <>
                  <CardHeader className="border-b border-slate-200 bg-[linear-gradient(180deg,#fefefe_0%,#f8fafc_100%)]">
                    <CardTitle className="text-xl text-slate-900">{detailLabel}</CardTitle>
                    <p className="mt-2 text-sm text-slate-500">
                      Choose a saved {periodType === "month" ? "monthly" : periodType === "quarter" ? "quarterly" : "yearly"} statement above to open the full view.
                    </p>
                  </CardHeader>
                  <CardContent className="flex min-h-[520px] items-center justify-center p-8 text-sm text-slate-500">
                    Select a statement from the dropdown to open the full profit &amp; loss view.
                  </CardContent>
                </>
              )}
          </Card>
        </div>
      </div>
    </>
  )
}
