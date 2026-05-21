import { PayStub } from "@shared/schemas"

import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { debugError, debugLog } from "@/lib/debugLoop"

type PayStubsResponse = { paystubs: PayStub.Type[] }

export async function getPayStubs(workspaceId: string): Promise<PayStub.Type[]> {
  debugLog("paystubs-api", "get_paystubs_start", {
    workspaceId,
  })
  const data = await apiFetch<PayStubsResponse>(
    `${API_ENDPOINTS.paystubs.get}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" }
  )
  debugLog("paystubs-api", "get_paystubs_success", {
    workspaceId,
    count: Array.isArray(data.paystubs) ? data.paystubs.length : 0,
    periodIds: Array.isArray(data.paystubs)
      ? data.paystubs.map((stub) => stub.periodId)
      : [],
  })
  return data.paystubs
}

export async function generatePayStub() {
  return tryWrite(API_ENDPOINTS.paystubs.generate, "POST", {})
}

export async function generateCurrentPayStub(workspaceId: string) {
  const endpoint = `${API_ENDPOINTS.paystubs.generateCurrent}?workspaceId=${encodeURIComponent(workspaceId)}`

  debugLog("paystubs-api", "generate_current_start", {
    workspaceId,
    endpoint,
  })

  try {
    const result = await tryWrite(
      endpoint,
      "POST",
      { force: true }
    )

    debugLog("paystubs-api", "generate_current_success", {
      workspaceId,
      result,
    })

    return result
  } catch (error) {
    debugError("paystubs-api", "generate_current_error", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
