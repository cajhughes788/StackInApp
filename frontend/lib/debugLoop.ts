"use client"

import { isDiagnosticsEnabled } from "@/lib/observability/diagnostics"
import { recordSupportLog } from "@/lib/support/supportLogBuffer"

const renderCounts = new Map<string, number>()
const lastRenderPayloads = new Map<string, string>()

function isDebugEnabled(): boolean {
  if (!isDiagnosticsEnabled() || typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem("stackin:debug-renders") === "1"
}

export function debugLog(scope: string, event: string, payload: Record<string, unknown> = {}) {
  if (!isDiagnosticsEnabled()) {
    return
  }

  recordSupportLog({
    ts: new Date().toISOString(),
    level: "info",
    source: `debug:${scope}`,
    event,
    payload,
  })

  console.info(`[debug:${scope}] ${event}`, payload)
}

export function debugError(scope: string, event: string, payload: Record<string, unknown> = {}) {
  if (!isDiagnosticsEnabled()) {
    return
  }

  recordSupportLog({
    ts: new Date().toISOString(),
    level: "error",
    source: `debug:${scope}`,
    event,
    payload,
  })

  console.error(`[debug:${scope}] ${event}`, payload)
}

export function debugRender(scope: string, payload: Record<string, unknown> = {}) {
  const nextCount = (renderCounts.get(scope) ?? 0) + 1
  renderCounts.set(scope, nextCount)

  if (!isDebugEnabled()) {
    return
  }

  const serializedPayload = JSON.stringify(payload)
  const previousPayload = lastRenderPayloads.get(scope)
  lastRenderPayloads.set(scope, serializedPayload)

  if (previousPayload === serializedPayload) {
    return
  }

  console.info(`[debug:${scope}] render`, {
    renderCount: nextCount,
    ...payload,
  })
}
