import { apiFetch } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

// Deliberately NOT using tryWrite here — recurring rule mutations require
// connectivity by design (see plan: rare, deliberate action, not worth
// wiring into the offline-queue replay machinery). Callers in
// lib/domain/recurringRulesService.ts check getIsOnline() before calling
// these and surface a toast instead of queuing on failure.

export async function postRecurringRule(
  workspaceId: string,
  body: any
): Promise<{ id: string; rule: any; generatedExpense: any | null; generatedEntry: any | null }> {
  const res = await apiFetch<any>(
    `${API_ENDPOINTS.recurringRules.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "POST", body: JSON.stringify(body) }
  )
  return {
    id: res.id,
    rule: res.rule,
    generatedExpense: res.generatedExpense ?? null,
    generatedEntry: res.generatedEntry ?? null,
  }
}

export async function patchRecurringRule(
  workspaceId: string,
  ruleId: string,
  patch: any
): Promise<{ id: string; rule: any }> {
  const res = await apiFetch<any>(
    `${API_ENDPOINTS.recurringRules.patch}?workspaceId=${encodeURIComponent(workspaceId)}&ruleId=${encodeURIComponent(ruleId)}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  )
  return { id: res.id, rule: res.rule }
}

export async function deleteRecurringRuleAPI(workspaceId: string, ruleId: string): Promise<void> {
  await apiFetch<any>(
    `${API_ENDPOINTS.recurringRules.delete}?workspaceId=${encodeURIComponent(workspaceId)}&ruleId=${encodeURIComponent(ruleId)}`,
    { method: "DELETE", body: JSON.stringify({}) }
  )
}

export async function getRecurringRulesForWorkspace(workspaceId: string): Promise<any[]> {
  const res = await apiFetch<{ rules: any[] }>(
    `${API_ENDPOINTS.recurringRules.get}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" }
  )
  return res.rules ?? []
}
