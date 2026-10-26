// /shared/taxPackage.ts
// ------------------------------------------------------------
// The tax-time package: a year's records organized the way an accountant
// asks for them — a Schedule C summary, income by payment app, the mileage
// log, estimated tax payments, and a receipts index (with the receipt
// files alongside, added by the backend). Pure: data in, files out.
// It's records, not a tax return.
// ------------------------------------------------------------
import type { EntryType, PaymentMethod } from "./schemas/entry"
import { getIncomeBreakdownTotal } from "./independentIncome"
import type { ZipEntry } from "./zip"

// Form 1099-K reporting limits: a payment app or processor reports a
// year's payments once BOTH are passed. Set in the Code, not adjusted for
// inflation, and the same for 2025 onward — so it isn't a yearly figure.
export const FORM_1099K_THRESHOLD = {
  amountOver: 20_000,
  transactionsOver: 200,
  source: "IRC §6050W(e) as restored by the One Big Beautiful Bill Act (July 2025): over $20,000 and over 200 payments per platform.",
}

export type IncomeByApp = {
  key: string
  label: string
  amount: number
  // Days with income from this app (each entry is a day's total, so the
  // number of individual payments isn't known).
  days: number
  // Over the dollar limit for a 1099-K (the payment-count limit still has
  // to be met too); "near" is within 75% of it.
  over1099KAmount: boolean
  near1099KAmount: boolean
}

export type TaxPackageData = {
  taxYear: number
  workspaceName: string
  generatedAt: string
  scheduleC: {
    grossReceipts: number // line 1
    returnsAndAllowances: number // line 2
    netIncomeFromSales: number // line 1 − line 2
    expenseLines: Array<{ category: string; line: string; amount: number; count: number }>
    totalExpenses: number
    netProfit: number
    processingFees: number
  }
  incomeByApp: IncomeByApp[]
  form1099K: { amountOver: number; transactionsOver: number }
  mileage: Array<{ date: string; description: string; businessMiles: number; amount: number }>
  estimatedPayments: Array<{ paidOn: string; amount: number }>
  expenses: Array<{
    date: string
    vendor: string
    description: string
    category: string
    amount: number
    // Path of the receipt inside the zip, or null.
    receiptFile: string | null
    receiptMissing: boolean
  }>
}

// Schedule C (Form 1040) Part II lines for the app's CPA categories.
const SCHEDULE_C_LINES: Record<string, string> = {
  Advertising: "8",
  "Car and truck expenses": "9",
  "Commissions and fees": "10",
  "Equipment / depreciation review": "13 (review with your accountant)",
  Insurance: "15",
  "Legal and professional services": "17",
  "Office expense": "18",
  "Rent or lease - other business property": "20b",
  Supplies: "22",
  "Taxes and licenses": "23",
  Travel: "24a",
  Utilities: "25",
  "Other expenses": "27a (list in Part V)",
}

export function scheduleCLine(category: string): string {
  return SCHEDULE_C_LINES[category] ?? "27a (list in Part V)"
}

const APP_LABELS: Record<string, string> = {
  venmo: "Venmo",
  cash_app: "Cash App",
  card_pos: "Card / POS (Square, Stripe…)",
  zelle: "Zelle",
  apple_cash: "Apple Pay / Apple Cash",
  check: "Checks",
  cash: "Cash",
  other: "Other",
}

function appKey(method: PaymentMethod): string {
  return method === "card" || method === "pos" ? "card_pos" : method
}

function round2(value: number): number {
  return Math.round(Number((value * 100).toPrecision(15))) / 100
}

/** Business income per payment app for the year (refunds left out, as a
 * processor's 1099-K reports gross payments). Highest first. */
export function computeIncomeByApp(
  entries: Array<Pick<EntryType, "workspace" | "kind" | "date" | "independent">>,
  form1099K: { amountOver: number }
): IncomeByApp[] {
  const byKey = new Map<string, { amount: number; days: Set<string> }>()
  for (const entry of entries) {
    if (entry.workspace !== "independent" || entry.kind === "refund") continue
    for (const line of entry.independent?.incomeBreakdowns ?? []) {
      const amount = getIncomeBreakdownTotal(line)
      if (!(amount > 0)) continue
      const key = appKey(line.paymentMethod)
      const current = byKey.get(key) ?? { amount: 0, days: new Set<string>() }
      current.amount += amount
      current.days.add(entry.date)
      byKey.set(key, current)
    }
  }
  return [...byKey.entries()]
    .map(([key, value]) => {
      const amount = round2(value.amount)
      return {
        key,
        label: APP_LABELS[key] ?? key,
        amount,
        days: value.days.size,
        over1099KAmount: key !== "cash" && key !== "check" && amount > form1099K.amountOver,
        near1099KAmount: key !== "cash" && key !== "check" && amount > form1099K.amountOver * 0.75 && amount <= form1099K.amountOver,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

// Same guard as the app's CSV export: a cell starting with = + - @ is read
// as a formula by spreadsheets, so it's prefixed to stay literal text.
function csvField(value: unknown): string {
  const text = String(value ?? "")
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function csv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n"
}

const money = (value: number) => value.toFixed(2)

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/** A file name for a receipt inside the zip: date, vendor, amount. */
export function receiptZipName(
  receipt: { date: string; vendor: string; amount: number },
  extension: string,
  used: Set<string>
): string {
  const vendor = receipt.vendor.replace(/[^\p{L}\p{N} &.-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Receipt"
  const base = `Receipts/${receipt.date} ${vendor} ${money(receipt.amount)}`
  let name = `${base}.${extension}`
  for (let n = 2; used.has(name); n += 1) name = `${base} (${n}).${extension}`
  used.add(name)
  return name
}

// Schedule C order: by line number ("8" < "20b" < "27a"), then name.
function byScheduleCLine(a: { line: string; category: string }, b: { line: string; category: string }): number {
  const number = (line: string) => Number.parseInt(line, 10) || 99
  return number(a.line) - number(b.line) || a.line.localeCompare(b.line) || a.category.localeCompare(b.category)
}

export function buildTaxPackageFiles(data: TaxPackageData): ZipEntry[] {
  const y = data.taxYear
  const s = data.scheduleC
  const files: ZipEntry[] = []

  files.push({
    path: `Schedule C summary ${y}.csv`,
    data: csv([
      ["Schedule C line", "Item", "Amount", "Count"],
      ["1", "Gross receipts or sales", money(s.grossReceipts), ""],
      ["2", "Returns and allowances (refunds)", money(s.returnsAndAllowances), ""],
      ["3", "Gross receipts minus returns", money(s.netIncomeFromSales), ""],
      ...[...s.expenseLines].sort(byScheduleCLine).map((line) => [line.line, line.category, money(line.amount), line.count]),
      ["28", "Total expenses", money(s.totalExpenses), ""],
      ["31", "Net profit (loss)", money(s.netProfit), ""],
      ["", "Includes payment processing fees", money(s.processingFees), ""],
    ]),
  })

  files.push({
    path: `Income by payment app ${y}.csv`,
    data: csv([
      ["Payment app", "Business income", "Days with income", "Over the 1099-K dollar limit"],
      ...data.incomeByApp.map((app) => [app.label, money(app.amount), app.days, app.over1099KAmount ? "Yes" : "No"]),
    ]),
  })

  if (data.mileage.length > 0) {
    files.push({
      path: `Mileage log ${y}.csv`,
      data: csv([
        ["Date", "Purpose", "Business miles", "Deduction"],
        ...data.mileage.map((trip) => [trip.date, trip.description, trip.businessMiles, money(trip.amount)]),
        ["", "Total", data.mileage.reduce((sum, t) => sum + t.businessMiles, 0), money(data.mileage.reduce((sum, t) => sum + t.amount, 0))],
      ]),
    })
  }

  files.push({
    path: `Estimated tax payments ${y}.csv`,
    data: csv([
      ["Date paid", "Amount"],
      ...data.estimatedPayments.map((p) => [p.paidOn, money(p.amount)]),
      ["Total", money(data.estimatedPayments.reduce((sum, p) => sum + p.amount, 0))],
    ]),
  })

  files.push({
    path: `Expenses and receipts ${y}.csv`,
    data: csv([
      ["Date", "Vendor", "Description", "Category", "Amount", "Receipt file", "Receipt needed"],
      ...data.expenses.map((e) => [e.date, e.vendor, e.description, e.category, money(e.amount), e.receiptFile ?? "", e.receiptMissing ? "Missing" : ""]),
    ]),
  })

  files.push({ path: `Start here - ${y} summary.html`, data: buildSummaryHtml(data) })
  return files
}

function buildSummaryHtml(data: TaxPackageData): string {
  const y = data.taxYear
  const s = data.scheduleC
  const fmt = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
  const row = (label: string, value: string) => `<tr><td>${escapeHtml(label)}</td><td class="n">${escapeHtml(value)}</td></tr>`
  const missing = data.expenses.filter((e) => e.receiptMissing).length
  const withReceipts = data.expenses.filter((e) => e.receiptFile).length
  const totalPaid = data.estimatedPayments.reduce((sum, p) => sum + p.amount, 0)
  const miles = data.mileage.reduce((sum, t) => sum + t.businessMiles, 0)
  const apps = data.incomeByApp
    .map((app) => row(app.label + (app.over1099KAmount ? " *" : ""), fmt(app.amount)))
    .join("")
  const anyOver = data.incomeByApp.some((app) => app.over1099KAmount)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.workspaceName)} · ${y} tax records</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#161B1E}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}p.muted{color:#5b6168;margin:0}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #e4e3de}td.n{text-align:right;font-variant-numeric:tabular-nums}
tr.total td{font-weight:600}.note{background:#f3f2ee;border-radius:10px;padding:10px 12px;margin-top:10px}</style></head><body>
<h1>${escapeHtml(data.workspaceName)} · ${y} tax records</h1>
<p class="muted">Prepared by 521 on ${escapeHtml(data.generatedAt.slice(0, 10))}. These are organized records for your tax preparer, not a tax return.</p>
<h2>Profit (Schedule C)</h2><table>
${row("Gross receipts (line 1)", fmt(s.grossReceipts))}${row("Refunds (line 2)", fmt(-s.returnsAndAllowances || 0))}
${row("Total expenses (line 28)", fmt(-s.totalExpenses || 0))}<tr class="total"><td>Net profit (line 31)</td><td class="n">${escapeHtml(fmt(s.netProfit))}</td></tr></table>
<p class="muted">Expenses include ${escapeHtml(fmt(s.processingFees))} in payment processing fees. Line-by-line totals: “Schedule C summary ${y}.csv”.</p>
<h2>Income by payment app</h2><table>${apps || row("No income recorded", "")}</table>
<div class="note">All business income is taxable, whether or not you get a 1099-K.${anyOver ? ` * Over ${escapeHtml(fmt(data.form1099K.amountOver))} on one app: if you also had more than ${data.form1099K.transactionsOver} payments there, expect a 1099-K from it.` : ""}</div>
<h2>Also in this package</h2><table>
${row("Estimated tax payments made", fmt(totalPaid))}
${data.mileage.length > 0 ? row("Business miles", `${miles.toLocaleString("en-US")} miles`) : ""}
${row("Expenses with a receipt attached", String(withReceipts))}
${missing > 0 ? row("Expenses over $75 missing a receipt", String(missing)) : ""}</table>
</body></html>`
}
