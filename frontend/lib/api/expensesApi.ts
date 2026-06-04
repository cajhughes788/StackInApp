import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function postExpense(
  workspaceId: string,
  body: any & { clientMutationId?: string }
): Promise<{ ok: boolean; id: string; expense: any; error?: string }> {
  const res = await tryWrite(
    `${API_ENDPOINTS.expenses.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    body
  )

  return {
    ok: true,
    id: (res as any).id,
    expense: (res as any).expense,
  }
}

export async function editExpense(
  workspaceId: string,
  expenseId: string,
  body: any
): Promise<{ ok: boolean; id: string; expense: any; error?: string }> {
  const res = await tryWrite(
    `${API_ENDPOINTS.expenses.patch}?workspaceId=${encodeURIComponent(workspaceId)}&expenseId=${encodeURIComponent(expenseId)}`,
    "PATCH",
    body
  )

  return {
    ok: true,
    id: (res as any).id,
    expense: (res as any).expense,
  }
}

export async function deleteExpenseAPI(
  workspaceId: string,
  expenseId: string
): Promise<{ ok: boolean; error?: string }> {
  const res = (await tryWrite(
    `${API_ENDPOINTS.expenses.delete}?workspaceId=${encodeURIComponent(workspaceId)}&expenseId=${encodeURIComponent(expenseId)}`,
    "DELETE",
    {}
  )) as any

  return {
    ok: res?.ok ?? true,
    error: res?.error,
  }
}

export async function getExpensesForPeriod(
  workspaceId: string,
  periodId: string
): Promise<any[]> {
  const url = `${API_ENDPOINTS.expenses.get}?workspaceId=${encodeURIComponent(workspaceId)}&periodId=${encodeURIComponent(periodId)}`
  const res = await apiFetch<{ expenses: any[] }>(url, { method: "GET" })
  return res.expenses ?? []
}

type ExpenseSummary = {
  id: string
  date: string
  amount: number
  vendor: string
  account: string
}

export type DuplicateCheckResult = {
  // Exact date + amount + merchant match — strong signal, soft-warn with "Save Anyway".
  possibleDuplicate: boolean
  matchingExpenses: ExpenseSummary[]
  // ±3 day date + amount + merchant match — weaker signal, informational only.
  possibleNearDuplicate: boolean
  nearDateExpenses: ExpenseSummary[]
}

export async function checkDuplicateExpense(
  workspaceId: string,
  payload: { date: string; amount: number; merchant: string }
): Promise<DuplicateCheckResult> {
  const res = await tryWrite<DuplicateCheckResult & { ok: boolean }>(
    `${API_ENDPOINTS.expenseDuplicateCheck.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    "POST",
    payload
  )
  return {
    possibleDuplicate: res.possibleDuplicate ?? false,
    matchingExpenses: res.matchingExpenses ?? [],
    possibleNearDuplicate: res.possibleNearDuplicate ?? false,
    nearDateExpenses: res.nearDateExpenses ?? [],
  }
}
