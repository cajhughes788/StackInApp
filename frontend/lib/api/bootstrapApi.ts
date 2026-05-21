import type { AppBootstrapResponse } from "@shared/contracts/appBootstrap"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"

export async function getAppBootstrap(
  workspaceId: string,
  options: {
    traceId?: string
    flow?: string
    step?: string
  } = {}
): Promise<AppBootstrapResponse> {
  return apiFetch<AppBootstrapResponse>(API_ENDPOINTS.bootstrap.get(workspaceId), {
    method: "GET",
    profile:
      options.traceId && options.flow
        ? {
            traceId: options.traceId,
            flow: options.flow,
            step: options.step ?? "startup.bootstrap_request",
            metadata: {
              workspaceId,
            },
          }
        : undefined,
  })
}
