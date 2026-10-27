import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import {
  InvoiceSchema,
  InvoiceSettingsSchema,
  type InvoiceCreateInput,
  type InvoicePatch,
  type InvoiceSettings,
  type InvoiceSettingsPatch,
  type InvoiceStatusAction,
  type InvoiceType,
  type QuickChargeInput,
} from "@shared/schemas/invoice"
import type { PaymentAccount, PaymentAccountAction } from "@shared/schemas/paymentAccount"

// apiFetch, not tryWrite — like recurring rules, invoice changes need a
// connection: numbering and the paid/void transitions are decided by the
// server, and a queued replay could act on an invoice that changed since.
//
// A longer timeout than apiFetch's 12s default: invoice functions are used
// rarely, so they often cold-start, and a cold start alone measured ~12s.
// Writes are idempotent (client mutation ids / server-side state checks),
// so waiting longer never double-books.
const INVOICE_TIMEOUT_MS = 30_000

// Everything the invoice API returns goes through the shared schemas, which
// fill in defaults for fields a server one release behind doesn't send yet
// (the web app and the functions deploy separately). An invoice that still
// can't be read is left out of the list rather than crashing a screen.
function readInvoice(raw: unknown): InvoiceType | null {
  const parsed = InvoiceSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.warn("invoicesApi: skipping an invoice that doesn't parse", parsed.error.issues)
  return null
}

function requireInvoice(raw: unknown): InvoiceType {
  const invoice = readInvoice(raw)
  if (!invoice) throw new Error("The server sent back an invoice this version of the app can't read. Refresh and try again.")
  return invoice
}

function readSettings(raw: unknown): InvoiceSettings {
  const parsed = InvoiceSettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : InvoiceSettingsSchema.parse({})
}

function query(workspaceId: string, invoiceId?: string): string {
  const base = `workspaceId=${encodeURIComponent(workspaceId)}`
  return invoiceId ? `${base}&invoiceId=${encodeURIComponent(invoiceId)}` : base
}

/** All invoices, newest first, plus the workspace's invoice settings and Stripe account (null if none). */
export async function getInvoices(
  workspaceId: string
): Promise<{ invoices: InvoiceType[]; settings: InvoiceSettings; paymentAccount: PaymentAccount | null }> {
  const res = await apiFetch<{ invoices: InvoiceType[]; settings: InvoiceSettings; paymentAccount: PaymentAccount | null }>(
    `${API_ENDPOINTS.invoices.get}?${query(workspaceId)}`,
    { timeout: INVOICE_TIMEOUT_MS, method: "GET" }
  )
  return {
    invoices: (res.invoices ?? []).flatMap((raw) => readInvoice(raw) ?? []),
    settings: readSettings(res.settings),
    paymentAccount: res.paymentAccount ?? null,
  }
}

/**
 * Stripe Connect: onboard (returns a Stripe sign-up link), refresh, dashboard
 * (returns a one-time Express dashboard link), set_accept_online.
 */
export async function updatePaymentAccount(
  workspaceId: string,
  action: PaymentAccountAction
): Promise<{ paymentAccount: PaymentAccount | null; url: string | null }> {
  const res = await apiFetch<{ paymentAccount: PaymentAccount | null; url: string | null }>(
    `${API_ENDPOINTS.invoices.paymentAccount}?${query(workspaceId)}`,
    { timeout: INVOICE_TIMEOUT_MS, method: "POST", body: JSON.stringify(action) }
  )
  return { paymentAccount: res.paymentAccount ?? null, url: res.url ?? null }
}

/** Omitted fields keep their saved value; logoDataUrl null removes the logo. */
export async function saveInvoiceSettings(workspaceId: string, patch: InvoiceSettingsPatch): Promise<InvoiceSettings> {
  const res = await apiFetch<{ settings: InvoiceSettings }>(`${API_ENDPOINTS.invoices.saveSettings}?${query(workspaceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(patch),
  })
  return readSettings(res.settings)
}

export async function createInvoice(workspaceId: string, input: InvoiceCreateInput): Promise<InvoiceType> {
  const res = await apiFetch<{ invoice: InvoiceType }>(`${API_ENDPOINTS.invoices.post}?${query(workspaceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(input),
  })
  return requireInvoice(res.invoice)
}

/** Makes a quick charge (a one-line invoice, shared at once) and returns its pay link. */
export async function createQuickCharge(
  workspaceId: string,
  input: QuickChargeInput
): Promise<{ invoice: InvoiceType; shareUrl: string }> {
  const res = await apiFetch<{ invoice: InvoiceType; shareUrl: string }>(
    `${API_ENDPOINTS.invoices.quickCharge}?${query(workspaceId)}`,
    { timeout: INVOICE_TIMEOUT_MS, method: "POST", body: JSON.stringify(input) }
  )
  return { invoice: requireInvoice(res.invoice), shareUrl: res.shareUrl }
}

export async function editInvoice(workspaceId: string, invoiceId: string, patch: InvoicePatch): Promise<InvoiceType> {
  const res = await apiFetch<{ invoice: InvoiceType }>(`${API_ENDPOINTS.invoices.patch}?${query(workspaceId, invoiceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "PATCH",
    body: JSON.stringify(patch),
  })
  return requireInvoice(res.invoice)
}

/** Drafts only — a sent invoice is voided instead. */
export async function deleteInvoice(workspaceId: string, invoiceId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.invoices.delete}?${query(workspaceId, invoiceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "DELETE",
    body: JSON.stringify({}),
  })
}

/**
 * send / void / close / share / email / refund / record_payment.
 * record_payment books the payment's income Entry and returns its id; share
 * returns the public link (and sends a draft).
 */
export async function updateInvoiceStatus(
  workspaceId: string,
  invoiceId: string,
  action: InvoiceStatusAction
): Promise<{ invoice: InvoiceType; entryId: string | null; shareUrl: string | null }> {
  const res = await apiFetch<{ invoice: InvoiceType; entryId: string | null; shareUrl: string | null }>(
    `${API_ENDPOINTS.invoices.status}?${query(workspaceId, invoiceId)}`,
    { timeout: INVOICE_TIMEOUT_MS, method: "POST", body: JSON.stringify(action) }
  )
  return { invoice: requireInvoice(res.invoice), entryId: res.entryId ?? null, shareUrl: res.shareUrl ?? null }
}
