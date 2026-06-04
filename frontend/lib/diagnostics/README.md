# Centralized Diagnostics & Tracing System

## Architecture Map: State Transition Boundaries

```
UI Layer (Components / Forms)
  │
  ▼
Domain Services (entriesService, expenseService, settingsService)
  ├── [TRACE: ENTRY_CREATE / EXPENSE_CREATE / SETTINGS_SAVE → phase: initiated]
  │
  ├─► Zustand Stores (useEntriesStore, useExpensesStore, useSettingsStore)
  │     └── [TRACE: STORE_UPDATE → phase: optimistic_update / optimistic_mutation]
  │
  ├─► Storage Layer (domainEntries, domainExpenses, domainSettings)
  │     ├── [TRACE: CACHE_WRITE → phase: optimistic_write]
  │     ├── [TRACE: CACHE_READ  → phase: cache_read]
  │     └── [TRACE: CACHE_REMOVE → phase: cache_remove]
  │
  ├─► Offline Queue (offlineQueue.ts)
  │     ├── [TRACE: QUEUE_ADD → when offline or API retry]
  │     └── [TRACE: QUEUE_REMOVE → on cancel or drain]
  │
  └─► API Layer (client.ts → entriesApi / expensesApi / settingsApi)
        ├── [TRACE: API_REQUEST → before fetch]
        ├── [TRACE: API_RESPONSE → on success]
        └── [TRACE: API_FAILURE → on error]

Reconnect Path (useOfflineReplay → offlineReplay.ts)
  ├── [TRACE: QUEUE_REPLAY_START]
  ├── [TRACE: QUEUE_REPLAY_SUCCESS → per mutation]
  ├── [TRACE: QUEUE_REPLAY_FAILURE → dropped mutations]
  └── [TRACE: RECONCILIATION → optimistic_replaced_canonical / rollback_applied]

Reconciliation (entrySync, expenseService, offlineReplay)
  ├── [TRACE: RECONCILIATION → optimistic_replaced_canonical]
  ├── [TRACE: RECONCILIATION → rollback_applied]
  ├── [TRACE: RECONCILIATION → conflict_rebase]
  ├── [TRACE: RECONCILIATION → optimistic_dropped_deleted_guard]
  └── [TRACE: RECONCILIATION → save_committed]
```

---

## Configuration

**Single file:** `frontend/lib/diagnostics/diagnosticsConfig.ts`

```ts
export const DiagnosticsConfig = {
  enabled: true,        // Master switch — false = zero overhead
  level: "verbose",     // "verbose" | "normal" | "errors" | "off"

  entries: true,        // Domain: entries
  expenses: true,       // Domain: expenses
  settings: true,       // Domain: settings

  store: true,          // Layer: Zustand store mutations
  cache: true,          // Layer: IndexedDB reads/writes
  queue: true,          // Layer: offline queue operations
  api: true,            // Layer: HTTP requests/responses
  replay: true,         // Layer: offline replay
  reconciliation: true, // Layer: conflict resolution
}
```

**To silence all tracing:** set `enabled: false`  
**To see only failures:** set `level: "errors"`  
**To silence a domain:** set `entries: false`  
**To silence a layer:** set `cache: false`

---

## Output Format

Every log line follows this pattern:

```
[diag] [ENTRY_CREATE][initiated]  |  traceId=entry_create_1748883000_00142  |  workspaceId=ws_abc  |  periodId=2026-06  |  isOnline=true
[diag] [ENTRY_CREATE][optimistic_update]  |  traceId=entry_create_1748883000_00142  |  entryId=tmp-uuid  |  workspace=independent
[diag] [CACHE_WRITE][optimistic_write]  |  traceId=entry_create_1748883000_00142  |  scopedKey=ws_abc::2026-06
[diag] [API_REQUEST][api_request]  |  traceId=entry_create_1748883000_00142  |  endpoint=/api/workspaces/ws_abc/entries  |  method=POST
[diag] [API_RESPONSE][api_response]  |  traceId=entry_create_1748883000_00142  |  entryId=canonical_id
[diag] [RECONCILIATION][optimistic_replaced_canonical]  |  traceId=entry_create_1748883000_00142  |  optimisticId=tmp-uuid  |  canonicalId=canonical_id
[diag] [CACHE_WRITE][canonical_write]  |  traceId=entry_create_1748883000_00142  |  entryId=canonical_id
```

**Search by traceId** in Xcode, Safari DevTools, or Chrome DevTools to see the complete lifecycle of one operation.

---

## Instrumented Files

| File | What is traced |
|------|---------------|
| `lib/diagnostics/diagnosticsConfig.ts` | Master config |
| `lib/diagnostics/trace.ts` | Core `trace()` utility + typed helpers |
| `lib/domain/entriesService.ts` | ENTRY_CREATE, ENTRY_UPDATE, ENTRY_DELETE + all phases |
| `lib/domain/expenseService.ts` | EXPENSE_CREATE, EXPENSE_UPDATE, EXPENSE_DELETE + all phases |
| `lib/domain/settingsService.ts` | SETTINGS_LOAD, SETTINGS_SAVE + conflict rebase |
| `lib/api/core/offlineReplay.ts` | QUEUE_REPLAY_START/SUCCESS/FAILURE + reconciliation |

---

## Correlation IDs

Every operation generates a unique `traceId` via `makeTraceId(operation)`:

```
entry_create_1748883000_00142
entry_update_1748883001_00832
expense_create_1748883002_01204
settings_load_1748883003_00091
offline_replay_1748883004_00550
```

Format: `{operation}_{unix_seconds}_{random_5_digits}`

All logs within one operation share the same `traceId`. Search for it to reconstruct the full flow.

---

## Adding New Trace Points

Import from `@/lib/diagnostics/trace`:

```ts
import { makeTraceId, trace, traceApiRequest, traceReconciliation } from "@/lib/diagnostics/trace"

const traceId = makeTraceId("my_operation")

// Typed helpers
traceApiRequest("entries", traceId, { endpoint: "/api/...", method: "POST" })
traceReconciliation("entries", traceId, "my_decision", { reason: "..." })

// Raw trace
trace({
  category: "entries",
  layer: "reconciliation",
  event: "MY_EVENT",
  phase: "my_phase",
  traceId,
  data: { key: "value" },
  level: "normal",
})
```

---

## Logging Levels

| Level | What you see |
|-------|-------------|
| `verbose` | Every architectural step (cache reads, store patches, optimistic writes) |
| `normal` | Major transitions: initiated, API request/response, queue add, final state |
| `errors` | Failures only: API failures, rollbacks, replay failures |
| `off` | Nothing (even when `enabled: true`) |

---

## Performance Contract

When `DiagnosticsConfig.enabled === false`:
- `trace()` returns on the first line — no string formatting, no console calls
- The only cost is the boolean check itself (~1ns)
- Safe to ship in production builds with `enabled: false`
