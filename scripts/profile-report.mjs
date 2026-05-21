#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

function parseArgs(argv) {
  const args = {
    frontend: [],
    backend: [],
    flow: "all",
    format: "text",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--frontend") {
      args.frontend.push(argv[index + 1])
      index += 1
      continue
    }

    if (arg === "--backend") {
      args.backend.push(argv[index + 1])
      index += 1
      continue
    }

    if (arg === "--flow") {
      args.flow = argv[index + 1] ?? "all"
      index += 1
      continue
    }

    if (arg === "--format") {
      args.format = argv[index + 1] ?? "text"
      index += 1
      continue
    }

    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/profile-report.mjs --frontend frontend-events.json --backend backend.log

Options:
  --frontend <path>   Frontend trace export JSON or log file. Repeatable.
  --backend <path>    Backend log file with [profile-trace] JSON lines. Repeatable.
  --flow <name>       startup | settings_save | entry_create | all
  --format <type>     text | json

Examples:
  node scripts/profile-report.mjs --frontend traces/web-prod.json --backend traces/functions.log
  node scripts/profile-report.mjs --frontend traces/native.json --flow entry_create
`)
}

function readFileSafe(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8")
}

function parseFrontendFile(filePath) {
  const raw = readFileSafe(filePath).trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map((event) => ({
        ...event,
        source: "frontend",
        inputFile: filePath,
      }))
    }
  } catch {}

  return parseTraceLines(raw, "frontend", filePath)
}

function parseBackendFile(filePath) {
  const raw = readFileSafe(filePath)
  return parseTraceLines(raw, "backend", filePath)
}

function parseTraceLines(raw, source, filePath) {
  const events = []
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const markerIndex = line.indexOf("[profile-trace]")
    if (markerIndex === -1) continue

    const jsonStart = line.indexOf("{", markerIndex)
    if (jsonStart === -1) continue

    const payload = line.slice(jsonStart).trim()

    try {
      const parsed = JSON.parse(payload)
      events.push({
        ...parsed,
        source,
        inputFile: filePath,
      })
    } catch {}
  }

  return events
}

function groupByTrace(events) {
  const traces = new Map()

  for (const event of events) {
    if (!event?.traceId || !event?.flow) continue
    const key = `${event.flow}::${event.traceId}`

    if (!traces.has(key)) {
      traces.set(key, {
        traceId: event.traceId,
        flow: event.flow,
        frontend: [],
        backend: [],
      })
    }

    const trace = traces.get(key)
    if (event.source === "backend") {
      trace.backend.push(event)
    } else {
      trace.frontend.push(event)
    }
  }

  for (const trace of traces.values()) {
    trace.frontend.sort((a, b) => a.ts - b.ts)
    trace.backend.sort((a, b) => a.ts - b.ts)
  }

  return [...traces.values()]
}

function getInstantTs(events, step) {
  const event = events.find((candidate) => candidate.step === step)
  return event?.ts ?? null
}

function getSpanDuration(events, step) {
  const start = events.find(
    (candidate) => candidate.step === step && candidate.phase === "start"
  )
  const end = events.find(
    (candidate) => candidate.step === step && candidate.phase === "end"
  )

  if (!start || !end) return null
  return end.ts - start.ts
}

function getDurationBetween(events, startStep, endStep) {
  const start = getInstantTs(events, startStep)
  const end = getInstantTs(events, endStep)

  if (start == null || end == null) return null
  return end - start
}

function percentile(values, ratio) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil(sorted.length * ratio) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[middle]
}

function round(value) {
  return value == null ? null : Math.round(value * 10) / 10
}

function collectMetrics(trace) {
  const frontend = trace.frontend
  const backend = trace.backend

  const common = {
    traceId: trace.traceId,
    flow: trace.flow,
    platform: frontend[0]?.platform ?? null,
    buildType: frontend[0]?.buildType ?? null,
  }

  if (trace.flow === "startup") {
    return {
      ...common,
      appOpenToFirstShellMs: getDurationBetween(
        frontend,
        "startup.app_open",
        "startup.first_shell_render"
      ),
      appOpenToFirstUsefulMs: getDurationBetween(
        frontend,
        "startup.app_open",
        "startup.first_useful_render"
      ),
      appOpenToReadyMs: getDurationBetween(
        frontend,
        "startup.app_open",
        "startup.ready"
      ),
      workspaceHydrateMs: getSpanDuration(frontend, "startup.workspace_hydrate"),
      membershipsFetchMs: getSpanDuration(
        frontend,
        "startup.workspace_memberships_fetch"
      ),
      workspaceDocsFetchMs: getSpanDuration(
        frontend,
        "startup.workspace_docs_fetch"
      ),
      tokenFetchMs: getSpanDuration(
        frontend,
        "startup.bootstrap_request.token_fetch"
      ),
      requestMs: getSpanDuration(frontend, "startup.bootstrap_request"),
      backendFirestoreReadsMs: getSpanDuration(
        backend,
        "startup.firestore_reads"
      ),
      backendTotalMs: getDurationBetween(
        backend,
        "startup.bootstrap_handler_invoked",
        "startup.response_sent"
      ),
    }
  }

  if (trace.flow === "settings_save") {
    return {
      ...common,
      tapToLocalUiMs: getDurationBetween(
        frontend,
        "settings_save.tap",
        "settings_save.local_ui_pending"
      ),
      tapToUiSuccessMs: getDurationBetween(
        frontend,
        "settings_save.tap",
        "settings_save.ui_success"
      ),
      tapToCompleteMs: getDurationBetween(
        frontend,
        "settings_save.tap",
        "settings_save.complete"
      ),
      patchComputeMs: getSpanDuration(frontend, "settings_save.patch_compute"),
      requestMs: getSpanDuration(frontend, "settings_save.network_request"),
      tokenFetchMs: getSpanDuration(
        frontend,
        "settings_save.network_request.token_fetch"
      ),
      storeUpdateMs: getSpanDuration(frontend, "settings_save.store_update"),
      backendPatchSettingsMs: getSpanDuration(
        backend,
        "settings_save.patch_settings"
      ),
      backendMembershipCheckMs: getSpanDuration(
        backend,
        "settings_save.membership_check"
      ),
      firestoreWriteMs: getSpanDuration(backend, "settings_save.firestore_write"),
      firestoreReadbackMs: getSpanDuration(
        backend,
        "settings_save.firestore_readback"
      ),
      backendTotalMs: getDurationBetween(
        backend,
        "settings_save.handler_invoked",
        "settings_save.response_sent"
      ),
    }
  }

  if (trace.flow === "entry_create") {
    return {
      ...common,
      tapToRowVisibleMs: getDurationBetween(
        frontend,
        "entry_create.tap",
        "entry_create.ui_row_visible"
      ),
      tapToUiSuccessMs: getDurationBetween(
        frontend,
        "entry_create.tap",
        "entry_create.ui_success"
      ),
      tapToCompleteMs: getDurationBetween(
        frontend,
        "entry_create.tap",
        "entry_create.complete"
      ),
      validationMs: getSpanDuration(frontend, "entry_create.validation"),
      settingsLoadMs: getSpanDuration(frontend, "entry_create.settings_load"),
      optimisticComputeMs: getSpanDuration(
        frontend,
        "entry_create.optimistic_compute"
      ),
      localCacheReadMs: getSpanDuration(
        frontend,
        "entry_create.local_cache_read"
      ),
      optimisticCacheWriteMs: getSpanDuration(
        frontend,
        "entry_create.optimistic_cache_write"
      ),
      requestMs: getSpanDuration(frontend, "entry_create.network_request"),
      tokenFetchMs: getSpanDuration(
        frontend,
        "entry_create.network_request.token_fetch"
      ),
      canonicalCacheWriteMs: getSpanDuration(
        frontend,
        "entry_create.canonical_cache_write"
      ),
      canonicalStoreUpdateMs: getSpanDuration(
        frontend,
        "entry_create.canonical_store_update"
      ),
      backendServiceMs: getSpanDuration(backend, "entry_create.service_create"),
      backendMembershipCheckMs: getSpanDuration(
        backend,
        "entry_create.membership_check"
      ),
      backendSettingsFetchMs: getSpanDuration(
        backend,
        "entry_create.settings_fetch"
      ),
      firestoreWriteMs: getSpanDuration(backend, "entry_create.firestore_write"),
      backendTotalMs: getDurationBetween(
        backend,
        "entry_create.handler_invoked",
        "entry_create.response_sent"
      ),
    }
  }

  return common
}

function summarizeMetrics(traceMetrics) {
  const byFlow = new Map()

  for (const row of traceMetrics) {
    if (!byFlow.has(row.flow)) {
      byFlow.set(row.flow, [])
    }
    byFlow.get(row.flow).push(row)
  }

  const result = {}

  for (const [flow, rows] of byFlow.entries()) {
    const metricNames = Object.keys(rows[0]).filter(
      (key) =>
        !["traceId", "flow", "platform", "buildType"].includes(key) &&
        typeof rows[0][key] !== "string"
    )

    result[flow] = {
      runs: rows.length,
      metrics: {},
    }

    for (const metricName of metricNames) {
      const values = rows
        .map((row) => row[metricName])
        .filter((value) => typeof value === "number")

      result[flow].metrics[metricName] = {
        count: values.length,
        median: round(median(values)),
        p90: round(percentile(values, 0.9)),
        max: round(values.length ? Math.max(...values) : null),
      }
    }
  }

  return result
}

function formatText(summary, rows) {
  const lines = []
  lines.push("StackIn Latency Report")
  lines.push("")

  for (const [flow, details] of Object.entries(summary)) {
    lines.push(`${flow} (${details.runs} runs)`)
    const metrics = Object.entries(details.metrics)
      .filter(([, value]) => value.count > 0)
      .sort((a, b) => {
        const aMedian = a[1].median ?? Number.POSITIVE_INFINITY
        const bMedian = b[1].median ?? Number.POSITIVE_INFINITY
        return aMedian - bMedian
      })

    for (const [metricName, value] of metrics) {
      lines.push(
        `  ${metricName}: median=${value.median ?? "-"}ms p90=${value.p90 ?? "-"}ms max=${value.max ?? "-"}ms n=${value.count}`
      )
    }

    lines.push("")
  }

  lines.push("Per-trace rows")
  for (const row of rows) {
    lines.push(
      `  ${row.flow} ${row.traceId} platform=${row.platform ?? "-"} build=${row.buildType ?? "-"}`
    )
  }

  return lines.join("\n")
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.frontend.length === 0 && args.backend.length === 0) {
    printHelp()
    process.exit(1)
  }

  const frontendEvents = args.frontend.flatMap(parseFrontendFile)
  const backendEvents = args.backend.flatMap(parseBackendFile)
  const allEvents = [...frontendEvents, ...backendEvents]

  const traces = groupByTrace(allEvents)
    .filter((trace) => args.flow === "all" || trace.flow === args.flow)
    .sort((a, b) => a.flow.localeCompare(b.flow) || a.traceId.localeCompare(b.traceId))

  const rows = traces.map(collectMetrics)
  const summary = summarizeMetrics(rows)

  if (args.format === "json") {
    console.log(
      JSON.stringify(
        {
          summary,
          rows,
        },
        null,
        2
      )
    )
    return
  }

  console.log(formatText(summary, rows))
}

main()
