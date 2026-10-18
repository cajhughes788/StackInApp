import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import type {
  InvoiceCreateInput,
  InvoicePatch,
  InvoiceSettings,
  InvoiceSettingsPatch,
  InvoiceStatusAction,
  InvoiceType,
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
  return { invoices: res.invoices ?? [], settings: res.settings, paymentAccount: res.paymentAccount ?? null }
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
  return res.settings
}

export async function createInvoice(workspaceId: string, input: InvoiceCreateInput): Promise<InvoiceType> {
  const res = await apiFetch<{ invoice: InvoiceType }>(`${API_ENDPOINTS.invoices.post}?${query(workspaceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(input),
  })
  return res.invoice
}

export async function editInvoice(workspaceId: string, invoiceId: string, patch: InvoicePatch): Promise<InvoiceType> {
  const res = await apiFetch<{ invoice: InvoiceType }>(`${API_ENDPOINTS.invoices.patch}?${query(workspaceId, invoiceId)}`, {
    timeout: INVOICE_TIMEOUT_MS,
    method: "PATCH",
    body: JSON.stringify(patch),
  })
  return res.invoice
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
  return { invoice: res.invoice, entryId: res.entryId ?? null, shareUrl: res.shareUrl ?? null }
}
