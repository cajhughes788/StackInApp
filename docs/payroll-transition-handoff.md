# Payroll Transition Handoff

This document is a clean handoff for continuing the W-2 paycheck-calculator transition in a new chat.

It explains:

- what the app originally did
- what we changed already
- what architectural direction we chose
- which states are now on dedicated payroll withholding logic
- what still remains to make this a true paycheck calculator

## Product Context

This W-2 workspace generates a paycheck preview for service workers and hourly employees.

The original implementation behaved more like a general annual tax estimator than a payroll withholding engine:

- it annualized wages
- applied generic deductions and rates
- divided the result back down to a pay period

That approach was not reliable enough for a paycheck preview because employer payroll withholding usually depends on:

- state-specific payroll worksheets or withholding tables
- residence state vs work state
- reciprocity rules
- county, city, or district taxes
- employee withholding forms such as MW507, IL-W-4, MI-W4, NC-4, G-4, DR 0004, etc.

The transition goal became:

`move from generic annual tax parameters to true payroll withholding logic, state by state`

## UI / Pay Stub Work Already Completed

We fixed the pay stub page so it no longer misrepresents stored entry data.

### 1. Pay stub row table bug fixed

The pay stub table was showing zeros because the page was reading flat fields like:

- `row.tips`
- `row.hours`
- `row.dayTotal`

But the real entry shape stores values under nested objects:

- `row.w2.tips`
- `row.w2.reportedCash`
- `row.w2.unreportedCash`
- `row.totals.paidHours`
- `row.totals.dayTotal`

That mismatch caused the row table to show zeros even when summary totals were nonzero.

This was patched in:

- [frontend/app/app/paystubs/page.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/app/app/paystubs/page.tsx)

### 2. FICA / Medicare double-counting bug fixed

The page was displaying:

- `Medicare`
- `FICA (Social Security)`

but the shared engine’s `fica` value already included:

- Social Security
- Medicare

So Medicare was being shown twice in the deduction total.

This was fixed by:

- separating `Social Security` from `Medicare`
- correcting deduction totals
- aligning UI and export/share summary output

Primary file:

- [frontend/app/app/paystubs/page.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/app/app/paystubs/page.tsx)

### 3. Pay stub wording direction

We discussed that this page should eventually present itself more as a `Paycheck Estimate` or `Pay Period Preview` rather than an employer-issued pay stub.

Reason:

- the app can estimate, but it cannot promise payroll-system exactness for every employer

Recommended wording direction:

- actual entered earnings shown clearly
- modeled taxes labeled as `estimated`
- stronger status / confidence messaging by state

## Core Architecture Direction

We decided not to buy or integrate a full external payroll engine right now and to continue with the custom engine.

We also decided the state layer should stop relying on generic return-style annual tax logic.

Instead, the engine should evolve into:

1. dedicated payroll withholding logic for states that can be modeled cleanly
2. location-aware local tax handling for states that require county/city/district inputs
3. explicit metadata about whether a state result is:
   - `exact`
   - `approximate`
   - `incomplete`

Core files involved:

- [shared/tax/engine.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/engine.ts)
- [shared/tax/state.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/state.ts)
- [shared/tax/types.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/types.ts)
- [shared/schemas/taxProfile.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/schemas/taxProfile.ts)
- [backend/functions/src/services/payStubsService.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/backend/functions/src/services/payStubsService.ts)
- [frontend/components/tax/TaxForm.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/components/tax/TaxForm.tsx)

## Shared Schema Expansion Already Completed

The tax profile was expanded so the engine can support true payroll withholding inputs instead of only generic annual tax inputs.

### Added location and local-tax fields

These were added so the engine can support county, city, district, and resident/work-state payroll logic:

- `residenceState`
- `workState`
- `residenceCounty`
- `workCounty`
- `residenceCity`
- `workCity`
- `postalCode`
- `schoolDistrictId`
- `localTaxJurisdictionIds`
- `reciprocityElection`
- `multiStateWorker`

### Added state-specific payroll fields

These were added as dedicated payroll methods were implemented:

- `stateWithholdingExemptions` for Maryland MW507
- `illinoisAllowanceLine1`
- `illinoisAllowanceLine2`
- `michiganExemptions`
- `northCarolinaAllowances`
- `coloradoDeductionAmount`
- `georgiaAllowanceCount`
- `georgiaMarriedBothWorking`

Files:

- [shared/schemas/taxProfile.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/schemas/taxProfile.ts)
- [shared/tax/types.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/types.ts)

## Maryland Work Already Completed

Maryland was the first major local-tax state we upgraded.

### Maryland county withholding implemented

We added county/local handling and the special nonresident local rate.

Files:

- [shared/tax/local.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/local.ts)
- [shared/tax/tables/marylandLocalRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/marylandLocalRates.ts)

### Maryland moved to a payroll-style withholding method

We added a dedicated Maryland helper and routed the engine through it instead of the generic state path.

Implemented behavior:

- MW507-style standard deduction handling
- MW507 exemption handling
- Maryland state withholding
- Maryland county local withholding
- Maryland nonresident local rate

Main file:

- [shared/tax/maryland.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/maryland.ts)

### Delaware / nonreciprocal Maryland handling added

We also implemented the Maryland resident employee path for Delaware / nonreciprocal-state withholding.

### County-required UX added

Maryland resident withholding now requires residence county in the tax form, and older incomplete profiles are no longer treated as fully complete.

Files:

- [frontend/components/tax/TaxForm.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/components/tax/TaxForm.tsx)
- [frontend/components/income-gauge.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/components/income-gauge.tsx)
- [frontend/app/app/paystubs/page.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/app/app/paystubs/page.tsx)

## Phase 3A: Non-Local Payroll Logic Conversion

After Maryland, we shifted into Phase 3A:

`convert states without major local-tax dependencies from generic annual tax math to true payroll withholding logic`

This does not mean every state is perfect yet. It means they now follow a payroll-oriented state path instead of the generic fallback.

## States Already Moved to Dedicated Payroll Logic

### Illinois

Dedicated file:

- [shared/tax/illinois.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/illinois.ts)

Implemented:

- IL-W-4 allowance formula
- Line 1 and Line 2 allowances
- reciprocity handling for Iowa, Kentucky, Michigan, Wisconsin residents working in Illinois

UI support:

- Illinois-specific allowance inputs in [frontend/components/tax/TaxForm.tsx](/Users/cajetanhughes/Desktop/App/TrackdOptimized/frontend/components/tax/TaxForm.tsx)

### Kentucky

Dedicated file:

- [shared/tax/kentucky.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/kentucky.ts)

Implemented:

- Kentucky payroll withholding using annual standard deduction and flat rate
- reciprocal-state exemption support when reciprocity is selected

### Michigan

Dedicated file:

- [shared/tax/michigan.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/michigan.ts)

Implemented:

- MI-W4 exemption-based withholding
- reciprocity support

### North Carolina

Dedicated file:

- [shared/tax/northCarolina.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/northCarolina.ts)

Implemented:

- NC-30-style withholding logic
- filing status support
- standard deduction support
- NC-4 allowance support

### Colorado

Dedicated file:

- [shared/tax/colorado.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/colorado.ts)

Implemented:

- DR 1098 worksheet-style calculation
- optional DR 0004 annual deduction amount
- resident vs work-state behavior instead of generic annual state tax logic

### Georgia

Dedicated file:

- [shared/tax/georgia.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/georgia.ts)

Implemented:

- G-4 percentage-method withholding
- allowance count support
- married-joint `both spouses work` handling

### Utah

Dedicated file:

- [shared/tax/utah.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/utah.ts)

Implemented:

- Utah Publication 14 pay-period schedule logic
- moved away from the old deduction-equivalent approximation

## Engine Integration Already Completed

All of the above states were wired into the shared engine so they run before the generic state fallback.

Main file:

- [shared/tax/engine.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/engine.ts)

The backend pay stub generator also passes the new state-specific fields through:

- [backend/functions/src/services/payStubsService.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/backend/functions/src/services/payStubsService.ts)

The state metadata layer was also updated so the UI can eventually distinguish payroll-method states from approximate or incomplete states:

- [shared/tax/state.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/state.ts)

## Current State of the Transition

At this point, the project is in a mixed-but-improving state:

- some states still use the generic annualized fallback
- some states now use dedicated payroll withholding modules
- Maryland now has county/local support
- the shared schema is much better prepared for local-tax states

This is a meaningful transition, but it is not the finish line yet.

## What We Were Moving Toward

The target system is:

### 1. Payroll-first state logic

Each state should ideally be classified as one of:

- no wage income tax
- dedicated payroll formula state
- dedicated payroll worksheet/table state
- location-based local-tax state

### 2. Honest confidence/status messaging

The UI should stop implying every estimate is equally exact.

We want the app to show whether the state estimate is:

- `exact`
- `approximate`
- `missing location details`
- `incomplete`

### 3. Better paycheck-preview wording

The W-2 view should eventually read like an estimate, not an employer-issued pay stub.

Suggested framing:

- `Paycheck Estimate`
- `Estimated withholding`
- `Estimated take-home`

### 4. Local-tax expansion for the next queue of states

The next major states likely need:

- Ohio school district tax
- Indiana county tax
- Pennsylvania local earned income tax
- New York local payroll taxes

## Recommended Next Steps

If a new chat is continuing from here, this is the recommended order:

### Immediate next step

Add UI confidence messaging so the pay stub / paycheck page can actually surface the metadata already being tracked in the engine.

Why:

- the engine is now more nuanced than the UI
- users should know when a state is payroll-based vs approximate vs incomplete

### After that

Continue the non-local conversion queue for states still using the generic fallback, focusing on states that are common and structurally clean for hourly workers.

### Then

Resume the local-tax queue:

- Ohio school district withholding
- Indiana county withholding
- Pennsylvania local earned income tax

## Important Constraints / Assumptions

These points matter for any future implementation:

- This app is for service workers and hourly employees, so paycheck withholding realism matters more than tax-return completeness.
- We are not trying to perfectly replicate every employer payroll system.
- We are trying to produce a credible paycheck calculator using official payroll withholding logic wherever possible.
- When a state requires payroll-form inputs, the UI should collect them instead of guessing.
- When local tax inputs are missing, the UI should not present the estimate as fully complete.

## Useful Existing Reference Document

There is also a broader audit here:

- [docs/payroll-tax-audit.md](/Users/cajetanhughes/Desktop/App/TrackdOptimized/docs/payroll-tax-audit.md)

That file is the deeper audit. This handoff doc is the concise transition summary for a new chat.
