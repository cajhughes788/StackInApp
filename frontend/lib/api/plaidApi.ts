import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import type { RecurringCadence } from "@shared/schemas/recurringRule"
import type { IncomeCategory, PaymentMethod } from "@shared/schemas/entry"
import type { PlaidInvoiceMatch } from "@shared/schemas/plaidPendingTransaction"

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
  /** Always positive — `direction` says whether money left or arrived. */
  amount: number
  /** "income" for deposits (reviewed on the Income tab), "expense" for spending. */
  direction: "expense" | "income"
  merchantName: string | null
  rawName: string
  /** Server-resolved merchant identity (may be a legacy key); absent on very old records. */
  merchantKey?: string
  suggestedExpenseAccount: string | null
  /** Income direction only — remembered from this payer's last confirmed deposit. */
  suggestedIncomeCategory?: IncomeCategory | null
  /** Income direction only — remembered, or guessed from the descriptor. */
  suggestedPaymentMethod?: PaymentMethod | null
  /** Income direction only — "Who paid you?" pre-fill for an "Other" deposit. */
  suggestedIncomeLabel?: string | null
  isBusinessGuess: boolean | null
  confidence: number
  isLikelyFuelPurchase: boolean
  status: "pending" | "confirmed" | "dismissed"
  /** See classifyPlaidTransferSignal in shared/plaidClassification.ts. */
  transferSignal?: "transfer" | "possible_transfer" | "unknown" | null
  /** Money back from a merchant — reviewed with expenses, booked as a negative expense. */
  isRefund?: boolean
  /** The confirmed purchase this refund most likely reverses. */
  refundOf?: { pendingId: string; expenseId: string; date: string; amount: number } | null
  /** A deposit cashed out from Venmo — see isVenmoCashoutDescriptor. */
  isVenmoCashout?: boolean
  /** Income direction only — the invoice(s) this deposit most likely pays. */
  invoiceMatch?: PlaidInvoiceMatch | null
  /** Why it was dismissed without a plain "not income/personal" decision. */
  dismissReason?: "transfer" | "invoice_already_paid"
  /** The other half of a matched transfer, when it was hidden by pairing. */
  transferPairId?: string
}

// "ios-native" = Plaid's native iOS SDK, which needs a different OAuth
// redirect_uri than the browser flow — see redirectUriFor in plaidService.ts.
export type PlaidLinkClient = "ios-native" | "browser"

// apiFetch, not tryWrite: a link token is only useful right now, so a
// request that fails offline must never be queued to replay later.
export async function getPlaidLinkToken(client: PlaidLinkClient = "browser"): Promise<string> {
  const res = await apiFetch<{ linkToken: string }>(API_ENDPOINTS.plaid.createLinkToken, {
    method: "POST",
    body: JSON.stringify({ client }),
  })
  return res.linkToken
}

// Update mode — repairs an existing, broken bank connection in place rather
// than creating a new one. See createUpdateLinkToken in plaidService.ts.
export async function getPlaidUpdateLinkToken(
  workspaceId: string,
  itemId: string,
  client: PlaidLinkClient = "browser"
): Promise<string> {
  const res = await apiFetch<{ linkToken: string }>(API_ENDPOINTS.plaid.createUpdateLinkToken, {
    method: "POST",
    body: JSON.stringify({ workspaceId, itemId, client }),
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
  decision: {
    isBusiness: boolean
    account?: string
    alwaysPersonal?: boolean
    receiptAssetId?: string
    incomeCategory?: IncomeCategory
    paymentMethod?: PaymentMethod
    /** "Who paid you?" — only used with paymentMethod "other". */
    incomeLabel?: string
    /** Income: the invoice group from invoiceMatch (suggested or an alternative) this deposit pays. */
    invoiceIds?: string[]
    /** With isBusiness false: money for an invoice already marked paid (invoiceMatch.alreadyPaid). */
    invoiceAlreadyPaid?: boolean
  }
): Promise<{
  committedExpenseId?: string
  committedEntryId?: string
  /** Invoice payments: one Entry per invoice. */
  committedEntryIds?: string[]
  /** Invoice payments that arrived net of fees: the processing-fee Expense. */
  feeExpenseId?: string
  recurringSuggestion?: PlaidRecurringSuggestion
  personalSuggestion?: PlaidPersonalSuggestion
  /** Income dismissals: a one-time "stop asking about this payer?" offer. */
  notIncomeSuggestion?: PlaidPersonalSuggestion
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

/** Learned income payers — see shared/schemas/plaidIncomeMemory.ts. */
export type PlaidIncomeMemory = {
  id: string
  payerKey: string
  displayName: string
  lastOutcome: "income" | "not_income"
  incomeCategory: IncomeCategory | null
  paymentMethod: PaymentMethod | null
  incomeLabel?: string | null
  mode: "ask_every_time" | "always_not_income"
  incomeCount: number
  notIncomeCount: number
  lastDecisionAt: string
  updatedAt: string
}

export async function getPlaidMerchantMemory(
  workspaceId: string
): Promise<{ merchants: PlaidMerchantMemory[]; payers: PlaidIncomeMemory[] }> {
  const url = `${API_ENDPOINTS.plaid.merchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await apiFetch<{ merchants: PlaidMerchantMemory[]; payers?: PlaidIncomeMemory[] }>(url, { method: "GET" })
  return { merchants: res.merchants ?? [], payers: res.payers ?? [] }
}

export async function updatePlaidIncomeMemory(
  workspaceId: string,
  payerKey: string,
  patch: { mode?: PlaidIncomeMemory["mode"]; incomeCategory?: IncomeCategory | null }
): Promise<PlaidIncomeMemory> {
  const res = await tryWrite<{ payer: PlaidIncomeMemory }>(
    `${API_ENDPOINTS.plaid.updateMerchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}&merchantKey=${encodeURIComponent(payerKey)}&kind=income`,
    "POST",
    patch
  )
  return res.payer
}

export async function resetPlaidIncomeMemory(workspaceId: string, payerKey: string): Promise<void> {
  await tryWrite(
    `${API_ENDPOINTS.plaid.resetMerchantMemory}?workspaceId=${encodeURIComponent(workspaceId)}&merchantKey=${encodeURIComponent(payerKey)}&kind=income`,
    "DELETE",
    {}
  )
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

export async function getPlaidHiddenTransfers(workspaceId: string): Promise<PlaidPendingTransaction[]> {
  const url = `${API_ENDPOINTS.plaid.hiddenTransfers}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await apiFetch<{ transactions: PlaidPendingTransaction[] }>(url, { method: "GET" })
  return res.transactions ?? []
}

// Returns every transaction put back into review — the one restored, plus
// its paired other half when that was only hidden because of the pairing.
export async function restorePlaidHiddenTransfer(workspaceId: string, pendingId: string): Promise<{ restoredIds: string[] }> {
  return tryWrite(
    `${API_ENDPOINTS.plaid.restoreHiddenTransfer}?workspaceId=${encodeURIComponent(workspaceId)}&pendingId=${encodeURIComponent(pendingId)}`,
    "POST",
    {}
  )
}
