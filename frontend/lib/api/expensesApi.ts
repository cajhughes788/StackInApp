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
