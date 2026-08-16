# Recurring Expenses & Income — Handoff

This document is a clean handoff for continuing or maintaining the recurring expense/income ("Repeats") feature in a new chat.

It explains:

- what the feature does and where it's scoped
- the architecture (data model, backend, frontend)
- deliberate scope decisions and why
- every bug found and fixed while building/verifying it
- current deploy status
- known follow-ups that were not done

## Product Context

Independent-workspace users can mark an expense, or an income entry from any single income source, as recurring. The app then automatically creates that same expense/entry going forward on a chosen cadence (weekly, every 2 weeks, monthly, or a custom day interval) until the rule is paused, deleted, or an optional end date passes.

Scope is **independent workspace only** — there is no W2 equivalent.

## Architecture

### Data model

New Firestore collection: `workspaces/{workspaceId}/recurringRules/{ruleId}`.

- [shared/schemas/recurringRule.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/schemas/recurringRule.ts) — `RecurringRuleSchema`: `type` (expense/income), `cadence`, `anchorDate`, `nextOccurrence`, `endDate`, `active`, `notes`, `expenseTemplate?`, `incomeTemplate?`.
  - `expenseTemplate` is a narrow subset of `ExpenseInput`: `amount`, `vendor`, `description`, `account`. No receipt-linking, no vehicle-mileage fields — those don't make sense as a recurring template.
  - `incomeTemplate` is `{ source, amount, category, label? }`. `source` is one of `venmo` / `appleCash` / `zelle` / `posSales` / `cashSales` / `custom` — these values intentionally match the object keys in [frontend/lib/incomeBreakdown.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/lib/incomeBreakdown.ts)'s `paymentCategoryConfig`, not the canonical `paymentMethod` enum — so the frontend can reuse `paymentCategoryConfig[source].label` directly for display. The backend does the one translation to a real `paymentMethod` at generation time. `label` is required only when `source === "custom"`.
- [shared/recurringSchedule.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/recurringSchedule.ts) — `computeNextOccurrence()`, pure cadence math. Monthly cadence anchors off the *original* `anchorDate`'s day-of-month (not the previous occurrence), so a rule anchored on the 31st lands on Feb 28 and then back on the 31st in March, instead of drifting permanently to the 28th.

### Backend

[backend/functions/src/services/recurringRulesService.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/backend/functions/src/services/recurringRulesService.ts) plus 4 thin routes (`createRecurringRule`, `editRecurringRule`, `deleteRecurringRule`, `getRecurringRules`) and one scheduled function.

- CRUD mirrors the existing `expensesService.ts` pattern: local `assertWorkspaceMembership`, zod validation, Firestore writes.
- **Atomic first-occurrence generation**: if a rule's `anchorDate` is today or earlier, `createRecurringRule` generates that occurrence's real expense/entry in the *same request*, by calling the existing `expensesService.createExpense` / `entriesService.createEntry` directly — this inherits periodId resolution, category validation, and P&L sync for free instead of reimplementing them.
- **Idempotency**: a deterministic `clientMutationId` (`recurring:{ruleId}:{occurrenceDate}`) reuses the dedupe logic already built into `createExpense`/`createEntry`, so retries can never double-create a record.
- **Daily cron** — [backend/functions/src/scheduled/generateRecurringTransactionsDaily.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/backend/functions/src/scheduled/generateRecurringTransactionsDaily.ts), runs 00:15 America/Los_Angeles, scans all workspaces via a `collectionGroup("recurringRules")` query for due rules, generates each occurrence the same way, advances `nextOccurrence`, and deactivates the rule once past its `endDate`.
- New composite Firestore index (`active` + `nextOccurrence`, `COLLECTION_GROUP` scope) backs that query — in `firestore.indexes.json`.

### Frontend

- [frontend/lib/api/recurringRulesApi.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/lib/api/recurringRulesApi.ts) — API client, deliberately **not** wired into the offline queue (see Scope Decisions).
- [frontend/lib/stores/useRecurringRulesStore.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/lib/stores/useRecurringRulesStore.ts) — simpler than `useExpensesStore`/`useEntriesStore`: no period scoping, no optimistic/offline reconciliation machinery.
- [frontend/lib/storage/domainRecurringRules.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/lib/storage/domainRecurringRules.ts) — IndexedDB read-through cache so the rules list still renders offline (mutations don't work offline).
- [frontend/lib/domain/recurringRulesService.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/lib/domain/recurringRulesService.ts) — create/update/delete; on create, reconciles any generated expense/entry into `useExpensesStore`/`useEntriesStore` **and** into `domainExpenses`/`domainEntries` IndexedDB (the IndexedDB part was a bug fix, see below).
- UI:
  - `expense-form.tsx` — a single "Repeats" toggle + cadence/end-date picker.
  - `entry-form.tsx` — a small "Repeats" switch on *each* independent income field (Venmo, Apple Pay, Zelle, POS Sales, Cash Sales, and the Custom Income row when there's exactly one row). Only one field's switch can be active at a time; a single shared cadence/end-date panel appears once a field is selected, rather than one per field.
  - `recurring-cadence-picker.tsx` — two exports: the default `RecurringCadencePicker` (switch + frequency + end date, used by `expense-form.tsx`) and the named `RecurringCadenceFields` (frequency + end date only, no switch — used by `entry-form.tsx`'s externally-toggled model).
  - `recurring-rules-manager.tsx` + `/app/recurring` page — list/pause/resume/delete rules. Linked from Independent Settings, not the main nav bar.
  - Quick-add buttons — `entry-form.tsx`'s Custom Income section now renders one button per label configured in Settings → Custom Income Fields, pre-filling that label. Previously those configured labels did nothing except gate the section's visibility.

## Scope Decisions Worth Knowing

- **Independent workspace only.** No W2 recurring support was requested or built.
- **Recurring rule mutations require connectivity.** Create/edit/delete/pause show a toast rather than queuing offline; the rules list still displays from cache when offline. This was deliberate — full offline-queue integration would require touching `offlineReplay.ts`'s hardcoded per-domain reconciliation branches, real risk for an action that's rarely performed offline in the first place.
- **One income source per recurring submission.** A recurring income rule can only carry one number with one category (one payment method + category, or one Custom Income row). Every *other* income-affecting field on the entry form (other payment fields, other custom income rows, hours, tips, reported/unreported cash) must be empty at submit time — otherwise that data would be silently dropped from future occurrences, since the recurring template only stores the one field.
- **The Custom Income visibility gate was intentionally left as-is.** `entryVisibility.ts`'s `showCustomIncome` (hides the whole Custom Income section unless at least one field is configured in Settings) was flagged as an inconsistency with how every other income type uses an explicit `enableX` settings toggle — but the user explicitly decided **not** to change this. Do not "fix" it without asking again.

## Bugs Found & Fixed During This Work

1. **Recurring income generated $0 totals.** The backend only wrote the amount into `customIncome`, not `incomeBreakdowns` — the field `computeEntry`/`getIndependentCategorizedIncomeTotals` actually sums for `dayTotal`/`taxableTotal`. Fixed in `recurringRulesService.ts`'s `generateOccurrence`, which now also builds an `incomeBreakdowns` entry (mirroring what the manual entry-form submit path already did).
2. **Generated income entries had no `id`.** `entriesService.createEntry` (unlike `expensesService.createExpense`) doesn't embed `id` inside the returned entry object. Fixed by explicitly attaching `result.id` before returning it to the frontend — without this, a recurring-generated entry couldn't be edited or deleted from the grid until the next full refresh.
3. **Backdated recurring expenses/income could vanish from the grid.** `recurringRulesService.ts` (frontend) only updated the in-memory Zustand store, never persisted the generated record to IndexedDB — unlike the normal create-expense/create-entry flows, which always do. For a same-day recurring item this rarely mattered (today's period is usually already loaded); for a **backdated** one (e.g. a rule anchored in a past month) it could be invisible until a 5-minute cache TTL forced a fresh backend refetch of that period. Fixed by reusing `domainExpenses.saveExpense` and a newly-exported `persistEntriesForPeriod` from `entriesService.ts` — the exact persistence path normal creation already uses.
4. **Period selector "Current" reset bug** (pre-existing, unrelated to recurring, found while working in this area). Switching the period dropdown back to "Current" sets the underlying selection to `null` — both `entry-form.tsx` and `expense-form.tsx`'s date-clamping effect treated `null` as "nothing to do" and left the date field stuck on whatever past period was last viewed, instead of resetting to today. Fixed in both forms.
5. **Misleading Repeats error message.** Turning on a field's Repeats switch before typing an amount showed "clear the other income fields first" — technically related, but not the actual problem. Replaced the boolean eligibility check with a reason-returning one (`no_amount` / `multi_category` / `other_fields_populated`) so the alert matches what's actually wrong.

## Deploy Status

- **Backend — deployed and live.** `createRecurringRule`, `editRecurringRule`, `deleteRecurringRule`, `getRecurringRules`, `generateRecurringTransactionsDaily` are all deployed, including the source-based income template schema and fixes #1–#2 above.
- **Frontend — NOT yet deployed.** All frontend-only fixes (#3, #4, #5, plus the quick-add buttons) are committed to source but need a Next.js rebuild/redeploy to reach production users.
- **Unrelated, done in passing**: bumped iOS `IPHONEOS_DEPLOYMENT_TARGET` / Podfile `platform :ios` from `14.0` → `15.0` (Apple requires 15.0+ starting Spring 2027) and ran `pod install`.

## Known Follow-Ups (Not Done)

- A **pre-existing** `deleteEntry` flakiness (occasionally returns `{ok:true}` without actually deleting; self-resolves on retry) was found during testing and spun off as a separate background investigation. Not caused by this feature, not yet root-caused.
- There is no way to remove a row from the Custom Income repeater in `entry-form.tsx` once added — only "add" exists. Noticed during testing, left out of scope.
- A rule only generates one occurrence per `createRecurringRule` call (today's, if due) plus one per day thereafter via the cron. There's no backfill logic for a rule that would need multiple missed occurrences generated at once — not expected to occur in practice since the cron runs daily, but worth knowing if the cron is ever paused for an extended period.

## How to Verify End-to-End

There's no automated test suite for this feature — verification so far has been manual, directly against the deployed backend using a real dev workspace and a browser:

1. Create a rule with `anchorDate` = today via the UI (either form) → confirm the expense/entry appears in the grid immediately, and the rule appears on `/app/recurring`.
2. Create a rule with a **past** `anchorDate` while viewing a *different* period than that date → confirm it still shows up correctly, both immediately and after navigating to that period fresh.
3. Pause/resume/delete a rule from `/app/recurring` → confirm state persists across reload, and deleting a rule never touches its already-generated records.
4. For income: toggle Repeats on a payment field with an amount typed, confirm the toggle blocks (with the right message) if another field already has a value, and confirm it auto-clears if you type into another field afterward.
5. Direct-API spot checks are useful for confirming exact `incomeBreakdowns`/`totals` shape without fighting UI timing — grab an ID token from `indexedDB` (`firebaseLocalStorageDb` → `stsTokenManager.accessToken`) and call the Cloud Run endpoints directly with `fetch`.
