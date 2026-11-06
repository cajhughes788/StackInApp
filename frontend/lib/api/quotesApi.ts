import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { QuoteSchema, type QuoteAction, type QuoteCreateInput, type QuotePatch, type QuoteType } from "@shared/schemas/quote"

// Quotes need a connection like invoices (invoicesApi.ts): numbering and the
// client's answer are decided by the server. Same longer timeout for cold starts.
const QUOTE_TIMEOUT_MS = 30_000

function readQuote(raw: unknown): QuoteType | null {
  const parsed = QuoteSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.warn("quotesApi: skipping a quote that doesn't parse", parsed.error.issues)
  return null
}

function requireQuote(raw: unknown): QuoteType {
  const quote = readQuote(raw)
  if (!quote) throw new Error("The server sent back a quote this version of the app can't read. Refresh and try again.")
  return quote
}

function query(workspaceId: string, quoteId?: string): string {
  const base = `workspaceId=${encodeURIComponent(workspaceId)}`
  return quoteId ? `${base}&quoteId=${encodeURIComponent(quoteId)}` : base
}

/** All quotes, newest first. */
export async function getQuotes(workspaceId: string): Promise<QuoteType[]> {
  const res = await apiFetch<{ quotes: QuoteType[] }>(`${API_ENDPOINTS.quotes.get}?${query(workspaceId)}`, {
    timeout: QUOTE_TIMEOUT_MS,
    method: "GET",
  })
  return (res.quotes ?? []).flatMap((raw) => readQuote(raw) ?? [])
}

export async function createQuote(workspaceId: string, input: QuoteCreateInput): Promise<QuoteType> {
  const res = await apiFetch<{ quote: QuoteType }>(`${API_ENDPOINTS.quotes.save}?${query(workspaceId)}`, {
    timeout: QUOTE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(input),
  })
  return requireQuote(res.quote)
}

export async function editQuote(workspaceId: string, quoteId: string, patch: QuotePatch): Promise<QuoteType> {
  const res = await apiFetch<{ quote: QuoteType }>(`${API_ENDPOINTS.quotes.save}?${query(workspaceId, quoteId)}`, {
    timeout: QUOTE_TIMEOUT_MS,
    method: "PATCH",
    body: JSON.stringify(patch),
  })
  return requireQuote(res.quote)
}

/** Drafts only — a sent quote is withdrawn instead. */
export async function deleteQuote(workspaceId: string, quoteId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.quotes.save}?${query(workspaceId, quoteId)}`, {
    timeout: QUOTE_TIMEOUT_MS,
    method: "DELETE",
    body: JSON.stringify({}),
  })
}

/** share (returns the link; sends a draft) / email / withdraw. */
export async function updateQuoteStatus(
  workspaceId: string,
  quoteId: string,
  action: QuoteAction
): Promise<{ quote: QuoteType; shareUrl: string | null }> {
  const res = await apiFetch<{ quote: QuoteType; shareUrl?: string }>(`${API_ENDPOINTS.quotes.status}?${query(workspaceId, quoteId)}`, {
    timeout: QUOTE_TIMEOUT_MS,
    method: "POST",
    body: JSON.stringify(action),
  })
  return { quote: requireQuote(res.quote), shareUrl: res.shareUrl ?? null }
}
