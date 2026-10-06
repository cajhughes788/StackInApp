import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import type { RecurringCadence } from "@shared/schemas/recurringRule"

export type PlaidLinkedAccount = {
  accountId: string
  name: string
  mask: string | null
  type: string
  subtype: string | null
  defaultBusiness: boolean | null
}

export type PlaidItem = {
  id: string
  workspaceId: string
  institutionId: string | null
  institutionName: string | null
  status: "active" | "error" | "revoked"
  linkedAccounts: PlaidLinkedAccount[]
  lastSyncAt: string | null
  lastError: string | null
}

export type PlaidPendingTransaction = {
  id: string
  workspaceId: string
  plaidItemId: string
  accountId: string
  date: string
  amount: number
  merchantName: string | null
  rawName: string
  /** Server-resolved merchant identity (may be a legacy key); absent on very old records. */
  merchantKey?: string
  suggestedExpenseAccount: string | null
  isBusinessGuess: boolean | null
  confidence: number
  isLikelyFuelPurchase: boolean
  status: "pending" | "confirmed" | "dismissed"
}

export async function getPlaidLinkToken(): Promise<string> {
  const res = await tryWrite<{ linkToken: string }>(API_ENDPOINTS.plaid.createLinkToken, "POST", {})
  return res.linkToken
}

// Update mode — repairs an existing, broken bank connection in place rather
// than creating a new one. See createUpdateLinkToken in plaidService.ts.
export async function getPlaidUpdateLinkToken(workspaceId: string, itemId: string): Promise<string> {
  const res = await tryWrite<{ linkToken: string }>(API_ENDPOINTS.plaid.createUpdateLinkToken, "POST", {
    workspaceId,
    itemId,
  })
  return res.linkToken
}

export async function exchangePlaidPublicToken(
  workspaceId: string,
  publicToken: string,
  linkMetadata?: { institutionId: string | null; accounts: Array<{ name: string; mask: string | null }> }
): Promise<{ itemId: string }> {
  const res = await tryWrite<{ itemId: string }>(
    `${API_ENDPOINTS.plaid.exchangePublicToken}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    {
      publicToken,
      institutionId: linkMetadata?.institutionId ?? null,
      accounts: linkMetadata?.accounts ?? [],
    }
  )
  return { itemId: res.itemId }
}

export async function getPlaidItems(workspaceId: string): Promise<PlaidItem[]> {
  const url = `${API_ENDPOINTS.plaid.items}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await apiFetch<{ items: PlaidItem[] }>(url, { method: "GET" })
  return res.items ?? []
}


export async function updatePlaidAccountDefault(
  workspaceId: string,
  itemId: string,
  accountId: string,
  defaultBusiness: boolean | null
): Promise<void> {
  await tryWrite(
    `${API_ENDPOINTS.plaid.updateAccountDefault}?workspaceId=${encodeURIComponent(workspaceId)}&itemId=${encodeURIComponent(itemId)}&accountId=${encodeURIComponent(accountId)}`,
    "POST",
    { defaultBusiness }
  )
}

export async function unlinkPlaidItem(workspaceId: string, itemId: string): Promise<void> {
  await tryWrite(
    `${API_ENDPOINTS.plaid.unlinkItem}?workspaceId=${encodeURIComponent(workspaceId)}&itemId=${encodeURIComponent(itemId)}`,
    "DELETE",
    {}
  )
}

export async function getPlaidPendingTransactions(workspaceId: string): Promise<PlaidPendingTransaction[]> {
  const url = `${API_ENDPOINTS.plaid.pendingTransactions}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await apiFetch<{ transactions: PlaidPendingTransaction[] }>(url, { method: "GET" })
  return res.transactions ?? []
}

export type PlaidRecurringSuggestion = {
  merchantKey: string
  cadence: RecurringCadence
  anchorDate: string
  vendor: string
  account: string
  amount: number
}

export type PlaidPersonalSuggestion = {
  merchantKey: string
  displayName: string
  dismissCount: number
}

export async function confirmPlaidPendingTransaction(
  workspaceId: string,
  pendingId: string,
  decision: { isBusiness: boolean; account?: string; alwaysPersonal?: boolean; receiptAssetId?: string }
): Promise<{
  committedExpenseId?: string
  recurringSuggestion?: PlaidRecurringSuggestion
  personalSuggestion?: PlaidPersonalSuggestion
}> {
  return tryWrite(
    `${API_ENDPOINTS.plaid.confirmPendingTransaction}?workspaceId=${encodeURIComponent(workspaceId)}&pendingId=${encodeURIComponent(pendingId)}`,
    "POST",
    decision
  )
}

export async function linkPlaidMerchantToRecurringRule(workspaceId: string, merchantKey: string): Promise<void> {
  await tryWrite(
    `${API_ENDPOINTS.plaid.linkMerchantToRecurringRule}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    { merchantKey }
  )
}

export type PlaidMerchantMemory = {
  id: string
  workspaceId: string
  merchantKey: string
  displayName: string
  isBusiness: boolean
  expenseCategory: string | null
  mode: "ask_every_time" | "always_personal" | "covered_by_recurring_rule"
  decisionCount: number
  lastDecisionAt: string
  createdAt: string
  updatedAt: string
}

export async function getPlaidMerchantMemory(workspaceId: string): Promise<PlaidMerchantMemory[]> {
  const url = `${API_ENDPOINTS.plaid.merchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await apiFetch<{ merchants: PlaidMerchantMemory[] }>(url, { method: "GET" })
  return res.merchants ?? []
}

export async function updatePlaidMerchantMemory(
  workspaceId: string,
  merchantKey: string,
  patch: { mode?: "ask_every_time" | "always_personal"; expenseCategory?: string | null }
): Promise<PlaidMerchantMemory> {
  const res = await tryWrite<{ merchant: PlaidMerchantMemory }>(
    `${API_ENDPOINTS.plaid.updateMerchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}&merchantKey=${encodeURIComponent(merchantKey)}`,
    "POST",
    patch
  )
  return res.merchant
}

export async function resetPlaidMerchantMemory(workspaceId: string, merchantKey: string): Promise<void> {
  await tryWrite(
    `${API_ENDPOINTS.plaid.resetMerchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}&merchantKey=${encodeURIComponent(merchantKey)}`,
    "DELETE",
    {}
  )
}
