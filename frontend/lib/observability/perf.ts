"use client"

import { isDiagnosticsEnabled } from "@/lib/observability/diagnostics"
import { recordSupportLog } from "@/lib/support/supportLogBuffer"

type PerfPayload = Record<string, unknown>

function isPerfLoggingEnabled(): boolean {
  return isDiagnosticsEnabled()
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }

  return Date.now()
}

export function logPerf(event: string, payload: PerfPayload = {}): void {
  if (!isPerfLoggingEnabled()) return

  recordSupportLog({
    ts: new Date().toISOString(),
    level: payload.status === "error" ? "error" : "info",
    source: "perf",
    event,
    payload,
  })

  console.log(`[perf] ${event}`, {
    ts: new Date().toISOString(),
    ...payload,
  })
}

export async function measureAsync<T>(
  event: string,
  fn: () => Promise<T>,
  payload: PerfPayload = {}
): Promise<T> {
  const startedAt = nowMs()

  try {
    const result = await fn()
    logPerf(event, {
      ...payload,
      durationMs: Math.round(nowMs() - startedAt),
      status: "ok",
    })
    return result
  } catch (error) {
    logPerf(event, {
      ...payload,
      durationMs: Math.round(nowMs() - startedAt),
      status: "error",
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    })
    throw error
  }
}

export function startPerfTimer(event: string, payload: PerfPayload = {}) {
  const startedAt = nowMs()

  return {
    success(extra: PerfPayload = {}) {
      logPerf(event, {
        ...payload,
        ...extra,
        durationMs: Math.round(nowMs() - startedAt),
        status: "ok",
      })
    },
    failure(error: unknown, extra: PerfPayload = {}) {
      logPerf(event, {
        ...payload,
        ...extra,
        durationMs: Math.round(nowMs() - startedAt),
        status: "error",
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      })
    },
  }
}
