import {
  ReceiptFieldConfidenceSchema,
  ReceiptLineItemSchema,
  type ReceiptFieldConfidence,
  type ReceiptLineItem,
} from "@shared/schemas/receiptAnalysis"

type TextractField = {
  Type?: { Text?: string }
  LabelDetection?: { Text?: string; Confidence?: number }
  ValueDetection?: { Text?: string; Confidence?: number }
}

type TextractExpenseDocument = {
  SummaryFields?: TextractField[]
  LineItemGroups?: Array<{
    LineItems?: Array<{
      LineItemExpenseFields?: TextractField[]
    }>
  }>
}

type TextractAnalyzeExpenseResponse = {
  ExpenseDocuments?: TextractExpenseDocument[]
}

type NormalizedReceiptAnalysis = {
  merchant: string | null
  description: string | null
  receiptDate: string | null
  subtotal: number | null
  tax: number | null
  tip: number | null
  total: number | null
  currency: string | null
  lineItems: ReceiptLineItem[]
  confidence: number | null
  fieldConfidence: ReceiptFieldConfidence
  summaryFieldsRaw: unknown
  lineItemsRaw: unknown
  normalized: Record<string, unknown>
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function parseCurrencyAmount(value: string | null | undefined): number | null {
  if (!value) return null
  const normalized = value.replace(/[^0-9.\-]/g, "")
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseMoneyCandidates(value: string | null | undefined): number[] {
  if (!value) return []

  const matches = value.match(/-?\$?\d[\d,]*\.\d{2}\b/g) ?? []
  return matches
    .map((match) => Number(match.replace(/[$,]/g, "")))
    .filter((candidate) => Number.isFinite(candidate))
}

function parseReceiptMoneyAmount(value: string | null | undefined): number | null {
  const candidates = parseMoneyCandidates(value)
  if (candidates.length > 0) {
    return candidates[candidates.length - 1] ?? null
  }

  return parseCurrencyAmount(value)
}

function stripMoneyText(value: string): string {
  return value
    .replace(/-?\$?\d[\d,]*\.\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    const slash = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/)
    if (!slash) return null
    const month = slash[1].padStart(2, "0")
    const day = slash[2].padStart(2, "0")
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3]
    return `${year}-${month}-${day}`
  }
  return parsed.toISOString().slice(0, 10)
}

function getFieldValue(field: TextractField): string | null {
  return field.ValueDetection?.Text?.trim() || null
}

function listFieldValues(fields: TextractField[]): string[] {
  return fields
    .map((field) => getFieldValue(field))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function isBarcodeLike(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.replace(/\s+/g, "")
  return /^[0-9]{8,14}$/.test(normalized)
}

function isMostlyNumericLike(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.replace(/\s+/g, "")
  if (!normalized) return false
  const alphaCount = (normalized.match(/[A-Za-z]/g) ?? []).length
  const digitCount = (normalized.match(/[0-9]/g) ?? []).length
  return digitCount > 0 && alphaCount === 0
}

function sanitizeDescriptionFragment(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  if (isBarcodeLike(trimmed) || isMostlyNumericLike(trimmed)) return null
  if (parseCurrencyAmount(trimmed) != null) return null

  const collapsed = trimmed.replace(/\s+/g, " ")
  const alphaCount = (collapsed.match(/[A-Za-z]/g) ?? []).length
  if (alphaCount === 0) return null

  return collapsed
}

function normalizeLineItemDescription(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

// Returns a description suitable for storing on the draft:
// - 0 items  → null   (no semantic description available)
// - 1 item   → that item's description (it IS the expense)
// - 2+ items → null   (no single description represents the receipt;
//               the line items themselves are the source of truth)
function buildStoredDescription(lineItems: ReceiptLineItem[]): string | null {
  if (lineItems.length === 1) {
    return normalizeLineItemDescription(lineItems[0].description)
  }
  return null
}

function getFieldConfidence(field: TextractField): number | null {
  const confidence = field.ValueDetection?.Confidence ?? field.LabelDetection?.Confidence
  return typeof confidence === "number" ? Math.max(0, Math.min(1, confidence / 100)) : null
}

function resolveLineItemDescription(fields: TextractField[]): string | null {
  const itemField = findSummaryField(fields, ["item"])
  const descriptionField = findSummaryField(fields, ["description"])
  const productCodeField = findSummaryField(fields, ["product_code"])

  const labeledFragments = dedupePreservingOrder(
    [
      sanitizeDescriptionFragment(getFieldValue(itemField ?? {})),
      sanitizeDescriptionFragment(getFieldValue(descriptionField ?? {})),
    ].filter((value): value is string => typeof value === "string")
  )
  if (labeledFragments.length > 0) {
    return normalizeLineItemDescription(labeledFragments.join(" "))
  }

  const textualValues = dedupePreservingOrder(
    listFieldValues(fields)
      .map((value) => sanitizeDescriptionFragment(value))
      .filter((value): value is string => typeof value === "string")
  )
  if (textualValues.length > 0) {
    return normalizeLineItemDescription(textualValues.join(" "))
  }

  const productCodeDescription = sanitizeDescriptionFragment(getFieldValue(productCodeField ?? {}))
  return normalizeLineItemDescription(productCodeDescription)
}

function resolveRawLineItemDescription(
  fields: TextractField[],
  ignoredFields: Array<TextractField | undefined>
): string | null {
  const ignoredValues = new Set(
    ignoredFields
      .map((field) => getFieldValue(field ?? {}))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  )

  const rawFragments = dedupePreservingOrder(
    fields
      .map((field) => getFieldValue(field))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .filter((value) => !ignoredValues.has(value))
      .map((value) => stripMoneyText(value))
      .filter((value) => value.length > 0)
  )

  if (rawFragments.length > 0) {
    return normalizeLineItemDescription(rawFragments.join(" "))
  }

  const rawValues = dedupePreservingOrder(
    fields
      .map((field) => getFieldValue(field))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .filter((value) => !ignoredValues.has(value))
  )

  if (rawValues.length > 0) {
    return normalizeLineItemDescription(rawValues.join(" "))
  }

  return null
}

function resolveLineItemAmount(
  fields: TextractField[],
  explicitAmount: TextractField | undefined
): number | null {
  const directAmount = parseReceiptMoneyAmount(getFieldValue(explicitAmount ?? {}))
  if (directAmount != null) {
    return directAmount
  }

  const amounts = listFieldValues(fields)
    .flatMap((value) => parseMoneyCandidates(value))
    .filter((value): value is number => typeof value === "number" && value > 0)

  if (!amounts.length) return null
  return Math.max(...amounts)
}

function findSummaryField(
  fields: TextractField[],
  candidates: string[]
): TextractField | undefined {
  return fields.find((field) => {
    const fieldType = normalizeText(field.Type?.Text)
    const label = normalizeText(field.LabelDetection?.Text)
    return candidates.some((candidate) => fieldType === candidate || label === candidate)
  })
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

export function normalizeTextractExpense(raw: unknown): NormalizedReceiptAnalysis {
  const parsed = raw as TextractAnalyzeExpenseResponse
  const expenseDocument = parsed.ExpenseDocuments?.[0]
  const summaryFields = expenseDocument?.SummaryFields ?? []
  const merchantField = findSummaryField(summaryFields, [
    "vendor_name",
    "supplier_name",
    "merchant_name",
  ])
  const dateField = findSummaryField(summaryFields, ["invoice_receipt_date", "date"])
  const subtotalField = findSummaryField(summaryFields, ["subtotal"])
  const taxField = findSummaryField(summaryFields, ["tax"])
  const tipField = findSummaryField(summaryFields, ["tip"])
  const totalField = findSummaryField(summaryFields, ["total", "amount_due"])
  const currencyField = findSummaryField(summaryFields, ["currency"])

  const lineItemsRaw = expenseDocument?.LineItemGroups ?? []
  const lineItems: ReceiptLineItem[] = []
  for (const group of lineItemsRaw) {
    for (const item of group.LineItems ?? []) {
      const fields = item.LineItemExpenseFields ?? []
      const quantityField = findSummaryField(fields, ["quantity"])
      const unitPriceField = findSummaryField(fields, ["price", "unit_price"])
      const amountField = findSummaryField(fields, ["item_price", "amount", "line_total"])
      const resolvedAmount = resolveLineItemAmount(fields, amountField)
      const description =
        resolveLineItemDescription(fields) ??
        resolveRawLineItemDescription(fields, [amountField, unitPriceField, quantityField])
      if (!description && resolvedAmount == null) continue

      const quantity =
        parseCurrencyAmount(getFieldValue(quantityField ?? {})) ??
        (resolvedAmount != null ? 1 : null)
      const unitPrice = parseReceiptMoneyAmount(getFieldValue(unitPriceField ?? {}))
      const amount =
        resolvedAmount ??
        (quantity != null && unitPrice != null ? quantity * unitPrice : null)

      const parsedItem = ReceiptLineItemSchema.parse({
        ...stripUndefined({
          description: description ?? `Receipt line ${lineItems.length + 1}`,
          quantity: quantity ?? undefined,
          unitPrice: unitPrice ?? undefined,
          amount: amount ?? undefined,
          confidence:
            getFieldConfidence(findSummaryField(fields, ["item"]) ?? {}) ??
            getFieldConfidence(findSummaryField(fields, ["description"]) ?? {}) ??
            getFieldConfidence(findSummaryField(fields, ["product_code"]) ?? {}) ??
            getFieldConfidence(amountField ?? {}) ??
            undefined,
        }),
      })
      lineItems.push(parsedItem)
    }
  }

  const fieldConfidence = ReceiptFieldConfidenceSchema.parse(
    Object.fromEntries(
      [
        ["merchant", getFieldConfidence(merchantField ?? {})],
        ["receiptDate", getFieldConfidence(dateField ?? {})],
        ["subtotal", getFieldConfidence(subtotalField ?? {})],
        ["tax", getFieldConfidence(taxField ?? {})],
        ["tip", getFieldConfidence(tipField ?? {})],
        ["total", getFieldConfidence(totalField ?? {})],
        ["currency", getFieldConfidence(currencyField ?? {})],
      ].filter((entry): entry is [string, number] => typeof entry[1] === "number")
    )
  )

  const allConfidences = [
    ...Object.values(fieldConfidence),
    ...lineItems
      .map((item) => item.confidence)
      .filter((value): value is number => typeof value === "number"),
  ]
  const description = buildStoredDescription(lineItems)

  return {
    merchant: getFieldValue(merchantField ?? {}),
    description,
    receiptDate: parseDate(getFieldValue(dateField ?? {})),
    subtotal: parseCurrencyAmount(getFieldValue(subtotalField ?? {})),
    tax: parseCurrencyAmount(getFieldValue(taxField ?? {})),
    tip: parseCurrencyAmount(getFieldValue(tipField ?? {})),
    total: parseCurrencyAmount(getFieldValue(totalField ?? {})),
    currency: getFieldValue(currencyField ?? {}),
    lineItems,
    confidence:
      allConfidences.length > 0
        ? allConfidences.reduce((sum, value) => sum + value, 0) / allConfidences.length
        : null,
    fieldConfidence,
    summaryFieldsRaw: summaryFields,
    lineItemsRaw,
    normalized: {
      ...stripUndefined({
        merchant: getFieldValue(merchantField ?? {}),
        description,
        receiptDate: parseDate(getFieldValue(dateField ?? {})),
        subtotal: parseCurrencyAmount(getFieldValue(subtotalField ?? {})),
        tax: parseCurrencyAmount(getFieldValue(taxField ?? {})),
        tip: parseCurrencyAmount(getFieldValue(tipField ?? {})),
        total: parseCurrencyAmount(getFieldValue(totalField ?? {})),
        currency: getFieldValue(currencyField ?? {}),
        lineItems,
        confidence:
          allConfidences.length > 0
            ? allConfidences.reduce((sum, value) => sum + value, 0) / allConfidences.length
            : null,
      }),
    },
  }
}
