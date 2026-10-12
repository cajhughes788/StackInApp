"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
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
import { useAuth } from "@/contexts/auth-context"
import { exportCsvFile, escapeCsvField } from "@/lib/documentExport"
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
  // !== 0, not > 0: a category can net negative in a period that has a
  // refund but no matching purchase, and dropping it would leave the
  // visible rows not adding up to the expense total.
  return categories
    .filter((item) => item.amount !== 0)
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

function StatementValue({ value, negativeClassName = "text-destructive" }: {
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
      <div className="py-3 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <ul className="mb-3 divide-y divide-border/70 rounded-xl bg-muted px-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start justify-between gap-3 py-2.5 text-sm"
        >
          <div className="min-w-0">
            <div className="whitespace-normal break-words font-medium text-foreground">
              {item.label}
            </div>
            <div className="mt-0.5 whitespace-normal break-words text-xs text-muted-foreground">
              {formatDate(item.date)}
              {item.description ? ` · ${item.description}` : ""}
            </div>
          </div>
          <div className="shrink-0 font-medium tabular-nums text-foreground">
            {formatCurrency(item.amount)}
          </div>
        </li>
      ))}
    </ul>
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
      <div className="py-3 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {subcategories.map((subcategory) => (
        <div key={subcategory.label}>
          <div className="flex items-baseline justify-between gap-3 px-1 py-1.5">
            <div className="text-sm font-medium text-foreground">
              {subcategory.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {subcategory.count} {subcategory.count === 1 ? "expense" : "expenses"}
              </span>
            </div>
            <div className="text-sm font-medium tabular-nums text-foreground">
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
      <div className="flex items-center justify-between gap-3 border-b border-border/70 py-3 text-sm">
        <div className="font-medium text-foreground">{label}</div>
        <div className="font-medium tabular-nums text-foreground">{formatCurrency(amount)}</div>
      </div>
    )
  }

  return (
    <AccordionItem value={rowKey} className="border-b border-border/70">
      <AccordionTrigger className="items-center gap-3 py-3 hover:no-underline">
        <div className="min-w-0 flex-1 text-left">
          <div className="font-medium text-foreground">{label}</div>
          <div className="mt-0.5 text-xs font-normal text-muted-foreground">{countLabel}</div>
        </div>
        <div className="shrink-0 font-medium tabular-nums text-foreground">{formatCurrency(amount)}</div>
      </AccordionTrigger>
      <AccordionContent className="pb-1">
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

// One part of the statement (Revenue, Operating expenses) as its own card,
// with its total on the last line.
function StatementSection({
  title,
  rows,
  emptyLabel,
  totalLabel,
  total,
}: {
  title: string
  rows: Array<{
    rowKey: string
    label: string
    amount: number
    items: ProfitLossDetailItem[]
    countLabel: string
    subcategories?: ExpenseDisplaySubcategory[]
  }>
  emptyLabel: string
  totalLabel: string
  total: number
}) {
  return (
    <section className="rounded-[22px] bg-card px-4 pb-4 pt-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <div className="py-3 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <Accordion type="multiple" className="w-full">
          {rows.map((row) => (
            <StatementCategoryRow key={row.rowKey} {...row} />
          ))}
        </Accordion>
      )}
      <div className="flex items-center justify-between gap-3 pt-3 font-semibold text-foreground">
        <span>{totalLabel}</span>
        <span className="tabular-nums">
          <StatementValue value={total} />
        </span>
      </div>
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
        <div className="absolute right-0 top-full z-[9999] mt-2 w-40 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onPrint()
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted"
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

  const incomeCategoryDetails = useMemo<ProfitLossIncomeCategoryDetail[]>(
    () => (selected?.income.categories ?? []).filter((item) => item.amount > 0),
    [selected]
  )

  const expenseCategoryDetails = useMemo<ProfitLossExpenseCategory[]>(
    () => (selected?.expenses.byCategory ?? []).filter((item) => item.amount !== 0),
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
      .map((row) => row.map(escapeCsvField).join(","))
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

  const periodNoun = periodType === "month" ? "month" : periodType === "quarter" ? "quarter" : "year"

  return (
    <>
      <StackInHeader />
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-10 pt-4">
        {selected ? (
          <div id="profit-loss-content" className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedId(null)}
                className="-ml-2 rounded-full text-muted-foreground hover:text-foreground"
              >
                ← All statements
              </Button>
              <StatementActionMenu
                onPrint={() => handlePrint(selected)}
                onShare={() => void handleShare(selected)}
                onExportCsv={() => handleExportCsv(selected)}
              />
            </div>

            <section className="rounded-[22px] bg-card p-5">
              <h1 className="text-sm text-muted-foreground">
                Profit &amp; Loss · {activeWorkspace?.name}
              </h1>
              <p className="mt-1 text-lg font-semibold text-foreground">{selected.label}</p>
              <p className="mt-3 text-sm text-muted-foreground">Net income</p>
              <div className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
                <StatementValue value={selected.netProfit} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Income</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                    <StatementValue value={selected.income.total} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Expenses</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                    <StatementValue value={selected.expenses.total} />
                  </dd>
                </div>
              </dl>
            </section>

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
              totalLabel="Gross profit"
              total={selected.income.total}
            />

            <StatementSection
              title="Operating expenses"
              rows={expenseDisplayRows}
              emptyLabel="No operating expenses recorded in this period."
              totalLabel="Total operating expenses"
              total={selected.expenses.total}
            />

            <section className="flex items-center justify-between gap-3 rounded-[22px] bg-card px-5 py-4">
              <span className="text-lg font-semibold text-foreground">Net income</span>
              <span className="text-lg font-semibold tabular-nums text-foreground">
                <StatementValue value={selected.netProfit} />
              </span>
            </section>

            <p className="px-1 text-xs text-muted-foreground">
              Generated {new Date(selected.meta.generatedAt).toLocaleString()}.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1 px-1">
              <h1 className="text-2xl font-semibold text-foreground">Profit &amp; Loss</h1>
              <p className="text-sm text-muted-foreground">
                Statements update on their own when you add or change income and expenses.
              </p>
            </div>

            <div className="grid grid-cols-3 rounded-full bg-muted p-1" role="group" aria-label="Statement period">
              {periodOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={periodType === option.value}
                  onClick={() => setPeriodType(option.value)}
                  className={`rounded-full py-2 text-sm font-medium transition-colors ${
                    periodType === option.value
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <HoursWorkedCard
              variant="simple"
              thisMonthHours={hoursStats.thisMonthHours}
              thisYearHours={hoursStats.thisYearHours}
              avgPerWeek={hoursStats.avgPerWeek}
              hideWhenEmpty
            />

            <section aria-labelledby="statements-heading">
              <h2 id="statements-heading" className="mb-2 px-1 text-lg font-semibold text-foreground">
                {periodType === "month"
                  ? "Monthly statements"
                  : periodType === "quarter"
                    ? "Quarterly statements"
                    : "Yearly statements"}
              </h2>

              {loading && statements.length === 0 ? (
                <div className="flex items-center rounded-[22px] bg-card px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading saved statements...
                </div>
              ) : null}

              {!loading && statements.length === 0 ? (
                <p className="rounded-[22px] bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                  No {periodNoun} statements available yet.
                </p>
              ) : null}

              {statements.length > 0 ? (
                <ul className="divide-y divide-border/70 rounded-[22px] bg-card px-4">
                  {statements.map((statement) => (
                    <li key={statement.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(statement.id)}
                        className="flex w-full items-center gap-3 py-3.5 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">{statement.label}</span>
                          <span className="block text-sm tabular-nums text-muted-foreground">
                            Income {formatCurrency(statement.income.total)} · Expenses {formatCurrency(statement.expenses.total)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs text-muted-foreground">Net</span>
                          <span className="block font-semibold tabular-nums text-foreground">
                            <StatementValue value={statement.netProfit} />
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </>
        )}
      </div>
    </>
  )
}
