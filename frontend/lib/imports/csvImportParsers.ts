import type {
  CreateImportBatchInput,
  ImportItemInput,
  ImportSource,
} from "@shared/schemas/import"

type ParsedCsvRow = {
  rawRow: Record<string, string>
  occurredAt: string | null
  amount: number | null
  description: string | null
  counterparty: string | null
  parseWarnings: string[]
  transactionType?: string | null
  transactionStatus?: string | null
}

export type SupportedImportSource =
  | "venmo_csv"
  | "stripe_csv"
  | "square_csv"
  | "bank_csv"

export const SUPPORTED_IMPORT_SOURCES: Array<{
  source: SupportedImportSource
  label: string
  accept: string
}> = [
  { source: "venmo_csv", label: "Venmo CSV", accept: ".csv,text/csv" },
  { source: "stripe_csv", label: "Stripe CSV", accept: ".csv,text/csv" },
  { source: "square_csv", label: "Square CSV", accept: ".csv,text/csv" },
  { source: "bank_csv", label: "Bank CSV", accept: ".csv,text/csv" },
]

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "")
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let currentCell = ""
  let currentRow: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell)
      currentCell = ""
      continue
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1
      }
      currentRow.push(currentCell)
      if (currentRow.some((cell) => cell.trim() !== "")) {
        rows.push(currentRow)
      }
      currentRow = []
      currentCell = ""
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.trim() !== "")) {
    rows.push(currentRow)
  }

  return rows
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header))
}

function findHeaderRowIndex(
  rows: string[][],
  requiredColumns: string[],
  optionalColumns: string[] = []
): number {
  return rows.findIndex((row) => {
    const normalized = row.map((value) => normalizeHeader(value))
    const hasRequiredColumns = requiredColumns.every((column) =>
      normalized.includes(column)
    )

    if (!hasRequiredColumns) {
      return false
    }

    if (optionalColumns.length === 0) {
      return true
    }

    return optionalColumns.some((column) => normalized.includes(column))
  })
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const negative =
    trimmed.includes("(") ||
    trimmed.startsWith("-") ||
    trimmed.toLowerCase().includes("minus") ||
    trimmed.toLowerCase().includes("debit")

  const normalized = trimmed.replace(/[^0-9.]/g, "")
  if (!normalized) return null

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

function parseOccurredAt(value: string | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function buildRowRecord(headers: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {}
  const usedKeys = new Set<string>()

  headers.forEach((header, index) => {
    const trimmedHeader = header.trim()
    const baseKey =
      trimmedHeader ||
      normalizeHeader(header) ||
      `column_${index + 1}`

    let key = baseKey
    let duplicateCount = 2
    while (usedKeys.has(key)) {
      key = `${baseKey}_${duplicateCount}`
      duplicateCount += 1
    }

    usedKeys.add(key)
    record[key] = values[index] ?? ""
  })
  return record
}

function makeBatch(
  source: ImportSource,
  fileName: string,
  items: ImportItemInput[],
  notes: string
): CreateImportBatchInput {
  if (items.length === 0) {
    throw new Error(
      "No usable transactions were found in this CSV. Try a different export or statement range."
    )
  }

  return {
    batch: {
      source,
      label: fileName.replace(/\.csv$/i, "") || source,
      fileName,
      notes,
    },
    items,
  }
}

function incomeItemFromRow(source: ImportSource, row: ParsedCsvRow): ImportItemInput {
  return {
    kind: "income",
    source,
    status: "pending",
    occurredAt: row.occurredAt,
    amount: row.amount,
    currency: "USD",
    description: row.description,
    counterparty: row.counterparty,
    rawRow: row.rawRow,
    parseWarnings: row.parseWarnings,
    confidence: row.parseWarnings.length === 0 ? 0.95 : 0.7,
    suggestedDirection: "income",
    suggestedIncomeCategory: null,
    userDecision: {
      isBusiness: null,
      finalKind: "income",
    },
    completion: {
      missingFields: ["isBusiness", "incomeCategory"],
      readyToCommit: false,
    },
    notes: "",
  }
}

function expenseCategorySuggestion(description: string | null): string | null {
  const normalized = (description ?? "").toLowerCase()
  if (!normalized) return null
  if (normalized.includes("uber") || normalized.includes("lyft") || normalized.includes("shell") || normalized.includes("chevron")) {
    return "Vehicle & Transportation"
  }
  if (normalized.includes("supply") || normalized.includes("sally") || normalized.includes("cosmoprof") || normalized.includes("amazon")) {
    return "Supplies"
  }
  if (normalized.includes("rent") || normalized.includes("booth")) {
    return "Rent / Booth Rent"
  }
  if (normalized.includes("ad") || normalized.includes("meta") || normalized.includes("instagram")) {
    return "Marketing & Advertising"
  }
  if (normalized.includes("quickbooks") || normalized.includes("glossgenius") || normalized.includes("vagaro") || normalized.includes("square")) {
    return "Software & Subscriptions"
  }
  return null
}

function expenseItemFromRow(source: ImportSource, row: ParsedCsvRow): ImportItemInput {
  return {
    kind: "expense",
    source,
    status: "pending",
    occurredAt: row.occurredAt,
    amount: row.amount == null ? null : Math.abs(row.amount),
    currency: "USD",
    description: row.description,
    counterparty: row.counterparty,
    rawRow: row.rawRow,
    parseWarnings: row.parseWarnings,
    confidence: row.parseWarnings.length === 0 ? 0.9 : 0.65,
    suggestedDirection: "expense",
    suggestedExpenseAccount: expenseCategorySuggestion(row.description),
    userDecision: {
      isBusiness: null,
      finalKind: "expense",
    },
    completion: {
      missingFields: ["isBusiness", "expenseCategory"],
      readyToCommit: false,
    },
    notes: "",
  }
}

export function parseVenmoCsvToImportBatch(
  fileName: string,
  text: string
): CreateImportBatchInput {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    throw new Error("This Venmo CSV appears to be empty.")
  }

  const headerRowIndex = findHeaderRowIndex(
    rows,
    ["datetime", "amounttotal"],
    ["type", "status", "from", "to"]
  )

  if (headerRowIndex === -1) {
    throw new Error("This file does not look like a supported Venmo export.")
  }

  const dataRows = rows.slice(headerRowIndex + 1)
  const rawHeaders = rows[headerRowIndex].map((value) => value.trim())
  const headers = rawHeaders.map(normalizeHeader)

  const datetimeIndex = findColumnIndex(headers, ["datetime", "date", "createdat"])
  const typeIndex = findColumnIndex(headers, ["type"])
  const statusIndex = findColumnIndex(headers, ["status"])
  const noteIndex = findColumnIndex(headers, ["note", "notes"])
  const fromIndex = findColumnIndex(headers, ["from"])
  const toIndex = findColumnIndex(headers, ["to"])
  const amountIndex = findColumnIndex(headers, ["amounttotal", "amount", "total"])
  const idIndex = findColumnIndex(headers, ["id", "transactionid"])

  const items = dataRows
    .map((values) => {
      const amount = parseAmount(values[amountIndex])
      const occurredAt = parseOccurredAt(values[datetimeIndex])
      const statusRaw = statusIndex >= 0 ? values[statusIndex]?.trim() ?? "" : ""
      const typeRaw = typeIndex >= 0 ? values[typeIndex]?.trim() ?? "" : ""
      const noteRaw = noteIndex >= 0 ? values[noteIndex]?.trim() ?? "" : ""
      const fromRaw = fromIndex >= 0 ? values[fromIndex]?.trim() ?? "" : ""
      const toRaw = toIndex >= 0 ? values[toIndex]?.trim() ?? "" : ""
      const idRaw = idIndex >= 0 ? values[idIndex]?.trim() ?? "" : ""
      const parseWarnings: string[] = []

      if (amount == null) parseWarnings.push("Missing amount")
      if (!occurredAt) parseWarnings.push("Missing transaction date")
      if (statusRaw && !["complete", "completed", "settled"].includes(statusRaw.toLowerCase())) {
        parseWarnings.push(`Status: ${statusRaw}`)
      }

      return {
        rawRow: {
          ...buildRowRecord(rawHeaders, values),
          externalId: idRaw,
        },
        occurredAt,
        amount,
        description: noteRaw || typeRaw || "Venmo transaction",
        counterparty:
          amount != null && amount >= 0 ? fromRaw || toRaw || null : toRaw || fromRaw || null,
        parseWarnings,
        transactionType: typeRaw || null,
        transactionStatus: statusRaw || null,
      }
    })
    .flatMap((row) => {
      const amount = row.amount ?? 0
      const type = (row.transactionType ?? "").toLowerCase()

      if (!row.amount || amount === 0) {
        return []
      }

      if (type.includes("transfer")) {
        return []
      }

      if (amount > 0) {
        return [incomeItemFromRow("venmo_csv", row)]
      }

      return [expenseItemFromRow("venmo_csv", row)]
    })

  return makeBatch(
    "venmo_csv",
    fileName,
    items,
    "Imported from Venmo CSV account statement"
  )
}

function parseGenericIncomeCsv(
  fileName: string,
  text: string,
  source: "stripe_csv" | "square_csv",
  labelFallback: string
): CreateImportBatchInput {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    throw new Error(`This ${labelFallback} CSV appears to be empty.`)
  }

  const rawHeaders = rows[0].map((value) => value.trim())
  const headers = rawHeaders.map(normalizeHeader)

  const dateIndex = findColumnIndex(headers, ["created", "createdutc", "date", "datetime", "paidat", "transactiondate"])
  const amountIndex = findColumnIndex(headers, ["amount", "gross", "net", "total", "amountusd", "paymentamount"])
  const descriptionIndex = findColumnIndex(headers, ["description", "details", "productdescription", "item", "note"])
  const customerIndex = findColumnIndex(headers, ["customer", "customername", "name", "buyername", "cardholdername"])
  const statusIndex = findColumnIndex(headers, ["status", "paymentstatus"])
  const idIndex = findColumnIndex(headers, ["id", "chargeid", "paymentid", "transactionid"])

  if (dateIndex === -1 || amountIndex === -1) {
    throw new Error(`This file does not look like a supported ${labelFallback} export.`)
  }

  const items = rows
    .slice(1)
    .map((values) => {
      const amount = parseAmount(values[amountIndex])
      const occurredAt = parseOccurredAt(values[dateIndex])
      const description = descriptionIndex >= 0 ? values[descriptionIndex]?.trim() ?? "" : ""
      const customer = customerIndex >= 0 ? values[customerIndex]?.trim() ?? "" : ""
      const statusRaw = statusIndex >= 0 ? values[statusIndex]?.trim() ?? "" : ""
      const externalId = idIndex >= 0 ? values[idIndex]?.trim() ?? "" : ""
      const parseWarnings: string[] = []

      if (amount == null) parseWarnings.push("Missing amount")
      if (!occurredAt) parseWarnings.push("Missing transaction date")
      if (statusRaw && ["failed", "canceled", "cancelled", "refund"].includes(statusRaw.toLowerCase())) {
        parseWarnings.push(`Status: ${statusRaw}`)
      }

      return {
        rawRow: {
          ...buildRowRecord(rawHeaders, values),
          externalId,
        },
        occurredAt,
        amount,
        description: description || `${labelFallback} sale`,
        counterparty: customer || null,
        parseWarnings,
      }
    })
    .filter((row) => row.amount != null && row.amount > 0)
    .map((row) => incomeItemFromRow(source, row))

  return makeBatch(source, fileName, items, `Imported from ${labelFallback} CSV`)
}

export function parseStripeCsvToImportBatch(
  fileName: string,
  text: string
): CreateImportBatchInput {
  return parseGenericIncomeCsv(fileName, text, "stripe_csv", "Stripe")
}

export function parseSquareCsvToImportBatch(
  fileName: string,
  text: string
): CreateImportBatchInput {
  return parseGenericIncomeCsv(fileName, text, "square_csv", "Square")
}

export function parseBankCsvToImportBatch(
  fileName: string,
  text: string
): CreateImportBatchInput {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    throw new Error("This bank CSV appears to be empty.")
  }

  const rawHeaders = rows[0].map((value) => value.trim())
  const headers = rawHeaders.map(normalizeHeader)

  const dateIndex = findColumnIndex(headers, ["date", "postingdate", "transactiondate", "posteddate"])
  const descriptionIndex = findColumnIndex(headers, ["description", "memo", "name", "merchant", "details"])
  const amountIndex = findColumnIndex(headers, ["amount", "transactionamount"])
  const debitIndex = findColumnIndex(headers, ["debit", "withdrawal", "payments"])
  const creditIndex = findColumnIndex(headers, ["credit", "deposit", "paymentsreceived"])
  const idIndex = findColumnIndex(headers, ["id", "reference", "transactionid", "fitid"])

  if (dateIndex === -1 || (amountIndex === -1 && debitIndex === -1 && creditIndex === -1)) {
    throw new Error("This file does not look like a supported bank export.")
  }

  const items = rows
    .slice(1)
    .map((values) => {
      const occurredAt = parseOccurredAt(values[dateIndex])
      const debit = debitIndex >= 0 ? parseAmount(values[debitIndex]) : null
      const credit = creditIndex >= 0 ? parseAmount(values[creditIndex]) : null
      const amount =
        amountIndex >= 0
          ? parseAmount(values[amountIndex])
          : credit != null && credit > 0
            ? credit
            : debit != null && debit > 0
              ? -debit
              : null
      const description = descriptionIndex >= 0 ? values[descriptionIndex]?.trim() ?? "" : ""
      const externalId = idIndex >= 0 ? values[idIndex]?.trim() ?? "" : ""
      const parseWarnings: string[] = []

      if (amount == null) parseWarnings.push("Missing amount")
      if (!occurredAt) parseWarnings.push("Missing transaction date")

      return {
        rawRow: {
          ...buildRowRecord(rawHeaders, values),
          externalId,
        },
        occurredAt,
        amount,
        description: description || "Bank transaction",
        counterparty: description || null,
        parseWarnings,
      }
    })
    .filter((row) => row.amount != null && row.amount !== 0)
    .map((row) =>
      (row.amount ?? 0) > 0
        ? incomeItemFromRow("bank_csv", row)
        : expenseItemFromRow("bank_csv", row)
    )

  return makeBatch("bank_csv", fileName, items, "Imported from bank CSV")
}

export function parseImportCsvBySource(
  source: SupportedImportSource,
  fileName: string,
  text: string
): CreateImportBatchInput {
  switch (source) {
    case "venmo_csv":
      return parseVenmoCsvToImportBatch(fileName, text)
    case "stripe_csv":
      return parseStripeCsvToImportBatch(fileName, text)
    case "square_csv":
      return parseSquareCsvToImportBatch(fileName, text)
    case "bank_csv":
      return parseBankCsvToImportBatch(fileName, text)
    default:
      throw new Error("Unsupported import source.")
  }
}
