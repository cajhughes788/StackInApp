import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"

export type SupportReportPayload = {
  kind: "help" | "problem" | "question" | "feedback"
  message: string
  context: {
    route: string
    workspaceId: string | null
    workspaceType: string | null
    workspaceName: string | null
    deviceType: string
    platform: string
    buildId: string | null
    userAgent: string
    capturedAt: string
    recentLogs: Array<{
      ts: string
      level: "info" | "error"
      source: string
      event: string
      payload?: Record<string, unknown>
    }>
  }
}

export async function submitSupportReport(payload: SupportReportPayload) {
  return apiFetch<{ ok: boolean }>(API_ENDPOINTS.support.submit, {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 15000,
  })
}
