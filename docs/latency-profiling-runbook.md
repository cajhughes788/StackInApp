# StackIn Latency Profiling Runbook

## What this measures

This instrumentation captures structured timing events for:

- `startup`
- `settings_save`
- `entry_create`

The goal is to measure both:

- perceived latency: when the UI reacts
- system latency: cache, token, network, backend, and store timings

## How to enable tracing

Tracing is enabled automatically in development builds.

For production builds, enable it in one of these ways:

1. Open the app with `?profile=1` in the URL on web.
2. In the browser console or native WebView console, run:

```js
localStorage.setItem("stackin-profile-enabled", "true")
```

To clear collected events:

```js
window.__STACKIN_PROFILE_EVENTS__ = []
```

## Where events appear

Frontend events are logged as:

```text
[profile-trace] {"traceId":"...","flow":"startup",...}
```

Backend events are logged with the same prefix and the same `traceId`.

This lets you match one frontend interaction with its corresponding backend work.

## Recommended test matrix

Run each flow 5 times for each scenario and record:

- median
- p90
- worst

### Web

1. Development build on desktop browser
2. Production build on desktop browser
3. Production build with throttled network

### Native

1. Debug build on simulator/device
2. Release build on device if available
3. Weak network test if available

### Test scenarios

For each platform/build combination:

1. Cold start after force close
2. Warm start from background
3. Save settings with a small patch
4. Create entry in a realistic workspace

## Startup flow events

Key events:

- `startup.app_open`
- `startup.auth_resolved`
- `startup.workspace_hydrate`
- `startup.workspace_memberships_fetch`
- `startup.workspace_docs_fetch`
- `startup.first_shell_render`
- `startup.bootstrap_request.token_fetch`
- `startup.bootstrap_request`
- `startup.first_useful_render`
- `startup.ready`

Primary comparisons:

- app open -> first shell render
- app open -> first useful render
- app open -> ready
- workspace hydrate duration
- bootstrap request duration
- token fetch duration

## Settings save flow events

Key events:

- `settings_save.tap`
- `settings_save.patch_compute`
- `settings_save.local_ui_pending`
- `settings_save.network_request.token_fetch`
- `settings_save.network_request`
- `settings_save.patch_settings`
- `settings_save.membership_check`
- `settings_save.firestore_write`
- `settings_save.firestore_readback`
- `settings_save.store_update`
- `settings_save.ui_success`
- `settings_save.complete`

Primary comparisons:

- tap -> local UI pending
- tap -> ui success
- request duration
- backend write + readback duration
- tap -> complete

## Entry create flow events

Key events:

- `entry_create.tap`
- `entry_create.validation`
- `entry_create.settings_load`
- `entry_create.optimistic_compute`
- `entry_create.local_cache_read`
- `entry_create.optimistic_cache_write`
- `entry_create.ui_row_visible`
- `entry_create.network_request.token_fetch`
- `entry_create.network_request`
- `entry_create.service_create`
- `entry_create.membership_check`
- `entry_create.settings_fetch`
- `entry_create.firestore_write`
- `entry_create.canonical_cache_write`
- `entry_create.canonical_store_update`
- `entry_create.ui_success`
- `entry_create.form_reset`
- `entry_create.complete`

Primary comparisons:

- tap -> ui row visible
- tap -> ui success
- token fetch duration
- request duration
- backend service duration
- tap -> complete

## Suggested target bands

### Startup

- cold start to useful UI: under `1500ms`
- warm start to useful UI: under `700ms`
- cached shell visible: under `200ms`

### Settings save

- tap to first feedback: under `50ms`
- tap to success UI: under `150-300ms`
- server-confirmed save: under `500-800ms`

### Entry create

- tap to row visible: under `100ms`
- tap to success/reset: under `150ms`
- server canonical response: under `500-800ms`

## How to export results

On web, copy the in-memory events:

```js
JSON.stringify(window.__STACKIN_PROFILE_EVENTS__ ?? [], null, 2)
```

For backend, copy the matching `[profile-trace]` log lines from your function logs.

Group records by `traceId`.

## Automatic report generation

Use the parser script to combine frontend exports and backend logs into a median/p90 report:

```bash
npm --workspaces=false run profile:report -- --frontend traces/frontend.json --backend traces/backend.log
```

Filter to a single flow:

```bash
npm --workspaces=false run profile:report -- --frontend traces/frontend.json --backend traces/backend.log --flow entry_create
```

Output JSON for spreadsheets or further analysis:

```bash
npm --workspaces=false run profile:report -- --frontend traces/frontend.json --backend traces/backend.log --format json
```

The script understands:

- frontend JSON arrays exported from `window.__STACKIN_PROFILE_EVENTS__`
- frontend log files that contain `[profile-trace] ...`
- backend function logs that contain `[profile-trace] ...`

## Result table template

Use one row per run with these fields:

- flow
- platform
- build_type
- scenario
- trace_id
- app_open_to_first_shell_ms
- app_open_to_first_useful_ms
- app_open_to_ready_ms
- tap_to_local_ui_ms
- tap_to_ui_success_ms
- token_fetch_ms
- request_ms
- backend_ms
- firestore_write_ms
- firestore_readback_ms
- total_ms
- notes

## How to interpret the results

If `token_fetch` is large:

- auth refresh is on the hot path

If `request_ms` is small but `tap_to_ui_success_ms` is large:

- the UI is waiting unnecessarily before acknowledging the action

If `backend_ms` is large and `firestore_write` dominates:

- server write path is the bottleneck

If `local_cache_read` or `optimistic_cache_write` is large:

- local-first storage is heavier than expected

If startup is dominated by workspace and bootstrap steps:

- startup is too serialized

## Recommended execution order

1. Run 5 startup traces on web production.
2. Run 5 settings save traces on web production.
3. Run 5 entry create traces on web production.
4. Repeat on native debug.
5. Repeat on native release if available.
6. Build a median and p90 summary.
7. Rank top bottlenecks by total time contribution and by user impact.
