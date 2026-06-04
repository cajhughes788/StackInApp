"use client"

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Diagnostics Configuration
//
// This is the single source of truth for all architectural tracing in the app.
//
// TOGGLE: Set `enabled: false` to silence all tracing with near-zero overhead.
//         Set individual domain or layer flags to narrow the signal.
//
// LEVEL:
//   "verbose"  — every architectural step (cache reads, store patches, etc.)
//   "normal"   — major lifecycle transitions only (create, API response, final state)
//   "errors"   — failures only (rollbacks, dropped mutations, API errors)
//   "off"      — no output, even if enabled is true
// ─────────────────────────────────────────────────────────────────────────────

export type DiagnosticsLevel = "verbose" | "normal" | "errors" | "off"

export type DiagnosticsConfigShape = {
  readonly enabled: boolean
  readonly level: DiagnosticsLevel

  // Domain channels — set false to silence an entire domain
  readonly entries: boolean
  readonly expenses: boolean
  readonly settings: boolean

  // Layer channels — set false to silence a specific cross-cutting layer
  readonly store: boolean
  readonly cache: boolean
  readonly queue: boolean
  readonly api: boolean
  readonly replay: boolean
  readonly reconciliation: boolean
}

export const DiagnosticsConfig: DiagnosticsConfigShape = {
  enabled: true,

  level: "verbose",

  // Domain channels
  entries: true,
  expenses: true,
  settings: true,

  // Layer channels
  store: true,
  cache: true,
  queue: true,
  api: true,
  replay: true,
  reconciliation: true,
}
