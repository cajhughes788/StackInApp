"use client"

// ─────────────────────────────────────────────────────────────────────────────
// Central Trace Utility
//
// All architectural tracing routes through this file.
// No feature should call console.log directly.
//
// Usage:
//   trace({
//     category: "entries",
//     layer: "cache",
//     event: "CACHE_WRITE",
//     phase: "optimistic_write",
//     traceId,
//     data: { entryId, scopedKey },
//   })
//
// Performance:
//   When DiagnosticsConfig.enabled === false the function returns on the very
//   first line — no string formatting, no object allocation in the call path.
// ─────────────────────────────────────────────────────────────────────────────

import { DiagnosticsConfig, type DiagnosticsLevel } from "./diagnosticsConfig"

// ── Types ─────────────────────────────────────────────────────────────────────

export type TraceCategory = "entries" | "expenses" | "settings"
export type TraceLayer =
  | "store"
  | "cache"
  | "queue"
  | "api"
  | "replay"
  | "reconciliation"

export type TracePayload = Record<string, string | number | boolean | null | undefined>

export type TraceEvent = {
  /** Which domain this trace belongs to */
  category: TraceCategory
  /** Which architectural layer emits this trace */
  layer: TraceLayer
  /** Upper-snake-case event name, e.g. ENTRY_CREATE */
  event: string
  /** The current step within the operation, e.g. optimistic_update */
  phase: string
  /** Correlation ID — every log for the same operation shares this */
  traceId: string
  /** Structured key/value data — keep concise, no large objects */
  data?: TracePayload
  /** Only set on error traces */
  error?: unknown
  /** Override the minimum level for this trace (default: "verbose") */
  level?: DiagnosticsLevel
}

// ── Level ordering ────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<DiagnosticsLevel, number> = {
  verbose: 0,
  normal: 1,
  errors: 2,
  off: 3,
}

function meetsLevel(eventLevel: DiagnosticsLevel, configLevel: DiagnosticsLevel): boolean {
  return LEVEL_RANK[eventLevel] >= LEVEL_RANK[configLevel]
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function makeTraceId(operation: string): string {
  const ts = Math.floor(Date.now() / 1000)
  const rand = Math.floor(Math.random() * 100_000).toString().padStart(5, "0")
  return `${operation}_${ts}_${rand}`
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatTrace(event: TraceEvent): string {
  const parts: string[] = [`[${event.event}][${event.phase}]`, `traceId=${event.traceId}`]

  if (event.data) {
    for (const [key, value] of Object.entries(event.data)) {
      if (value !== undefined && value !== null) {
        parts.push(`${key}=${String(value)}`)
      }
    }
  }

  if (event.error !== undefined) {
    const msg =
      event.error instanceof Error
        ? `${event.error.name}: ${event.error.message}`
        : String(event.error)
    parts.push(`error=${msg}`)
  }

  return parts.join("  |  ")
}

// ── Core trace() ──────────────────────────────────────────────────────────────

export function trace(event: TraceEvent): void {
  // Fast exit — no work done when globally disabled
  if (!DiagnosticsConfig.enabled) return
  if (DiagnosticsConfig.level === "off") return

  // Domain filter
  if (!DiagnosticsConfig[event.category]) return

  // Layer filter
  if (!DiagnosticsConfig[event.layer]) return

  // Level filter
  const eventLevel = event.level ?? "verbose"
  if (!meetsLevel(eventLevel, DiagnosticsConfig.level)) return

  const line = formatTrace(event)

  if (event.error !== undefined || eventLevel === "errors") {
    console.error(`[diag] ${line}`)
  } else if (eventLevel === "normal") {
    console.info(`[diag] ${line}`)
  } else {
    console.log(`[diag] ${line}`)
  }
}

// ── Typed helpers ─────────────────────────────────────────────────────────────
// Narrowed wrappers so call sites don't repeat boilerplate.

export function traceStoreUpdate(
  category: TraceCategory,
  traceId: string,
  event: string,
  data?: TracePayload
): void {
  trace({ category, layer: "store", event, phase: "store_update", traceId, data })
}

export function traceCacheRead(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({ category, layer: "cache", event: "CACHE_READ", phase: "cache_read", traceId, data })
}

export function traceCacheWrite(
  category: TraceCategory,
  traceId: string,
  phase: string,
  data?: TracePayload
): void {
  trace({ category, layer: "cache", event: "CACHE_WRITE", phase, traceId, data })
}

export function traceCacheRemove(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({ category, layer: "cache", event: "CACHE_REMOVE", phase: "cache_remove", traceId, data })
}

export function traceQueueAdd(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "queue",
    event: "QUEUE_ADD",
    phase: "queue_enqueue",
    traceId,
    data,
    level: "normal",
  })
}

export function traceQueueRemove(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({ category, layer: "queue", event: "QUEUE_REMOVE", phase: "queue_remove", traceId, data })
}

export function traceReplayStart(traceId: string, data?: TracePayload): void {
  // Replay spans all categories — emit for each enabled domain
  const categories: TraceCategory[] = ["entries", "expenses", "settings"]
  for (const category of categories) {
    if (!DiagnosticsConfig[category]) continue
    trace({
      category,
      layer: "replay",
      event: "QUEUE_REPLAY_START",
      phase: "replay_start",
      traceId,
      data,
      level: "normal",
    })
    return // emit once (first enabled category is enough for the log)
  }
}

export function traceReplaySuccess(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "replay",
    event: "QUEUE_REPLAY_SUCCESS",
    phase: "replay_success",
    traceId,
    data,
    level: "normal",
  })
}

export function traceReplayFailure(
  category: TraceCategory,
  traceId: string,
  error: unknown,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "replay",
    event: "QUEUE_REPLAY_FAILURE",
    phase: "replay_failure",
    traceId,
    data,
    error,
    level: "errors",
  })
}

export function traceApiRequest(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "api",
    event: "API_REQUEST",
    phase: "api_request",
    traceId,
    data,
    level: "normal",
  })
}

export function traceApiResponse(
  category: TraceCategory,
  traceId: string,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "api",
    event: "API_RESPONSE",
    phase: "api_response",
    traceId,
    data,
    level: "normal",
  })
}

export function traceApiFailure(
  category: TraceCategory,
  traceId: string,
  error: unknown,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "api",
    event: "API_FAILURE",
    phase: "api_failure",
    traceId,
    data,
    error,
    level: "errors",
  })
}

export function traceReconciliation(
  category: TraceCategory,
  traceId: string,
  decision: string,
  data?: TracePayload
): void {
  trace({
    category,
    layer: "reconciliation",
    event: "RECONCILIATION",
    phase: decision,
    traceId,
    data,
    level: "normal",
  })
}
