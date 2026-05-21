# Payroll Tax Audit

This document audits the current custom paycheck calculator and maps the work required to turn it from a general annual tax estimator into a real payroll withholding engine.

## Current Scope

The current engine is centered on these files:

- [shared/tax/engine.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/engine.ts)
- [shared/tax/state.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/state.ts)
- [shared/tax/federal.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/federal.ts)
- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts)
- [shared/schemas/taxProfile.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/schemas/taxProfile.ts)
- [shared/tax/types.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/types.ts)

## Executive Summary

The current federal layer is closer to a real paycheck calculation than the current state layer.

The current state layer is not a true payroll withholding engine yet. It mixes:

- annual return-style deductions and credits
- simplified annualized bracket math
- a single `state` input with no county, city, district, or work-location context

That means several states can never be accurate, even if the listed rates are numerically correct.

## Primary Gaps

### 1. Missing input dimensions

The current tax profile only stores:

- filing status
- dependents
- state
- a few generic deduction/withholding fields

It does not store:

- home address
- work address
- county
- city
- school district
- nonresident work state / resident state pairing
- local withholding elections
- state allowance/exemption fields where payroll still depends on them

Without these inputs, the engine cannot correctly calculate:

- Maryland county tax
- Ohio school district tax
- Pennsylvania local earned income tax
- Indiana county income tax
- New York City / Yonkers local tax
- other address-sensitive local payroll taxes

### 2. State table model is too generic

`StateTaxInfo` in [shared/tax/types.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/types.ts) only supports:

- `flatRate`
- `brackets`
- `deduction`
- `dependentDeduction`
- `dependentCredit`

That model is too small for real payroll withholding.

It cannot represent:

- local taxes layered on top of state tax
- separate resident and nonresident withholding rules
- state withholding allowances / worksheets
- surtax thresholds that follow payroll-specific rules
- location-based taxes
- special employee-paid payroll programs
- state-specific standard deduction credit formulas
- wage-base style state payroll rules

### 3. State math assumes annual-return logic

`calculateStateTax()` in [shared/tax/state.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/state.ts) does this:

1. annualize current-period taxable wages
2. subtract a deduction
3. apply state tax rate or brackets
4. subtract a credit
5. divide back down to one pay period

That pattern is usable for some states, but it is not a universal payroll withholding method.

## State Classification

These categories reflect current engine fitness, not whether the state has an income tax in general.

### Category A: Reasonably safe as wage-income state tax only

These states are relatively close to the current model because they either have no wage income tax or have simple flat tax structures with fewer local complications.

- Alaska
- Florida
- Nevada
- South Dakota
- Tennessee
- Texas
- Washington
- Wyoming
- Pennsylvania
- Utah
- North Carolina
- Colorado
- Illinois
- Indiana
- Kentucky
- Idaho
- Iowa
- Georgia
- Massachusetts
- Michigan

Notes:

- `Reasonably safe` does not mean payroll-accurate enough for production without validation.
- Some of these states still need significant fixes because the current deductions or payroll-specific logic are wrong or incomplete.

### Category B: State-only logic possible, but current values are approximate or suspect

These states can be modeled without local address resolution in many cases, but the current table appears to use simplifications that should be reviewed before calling the output payroll-grade.

- Alabama
- Arizona
- Arkansas
- California
- Connecticut
- Delaware
- Hawaii
- Kansas
- Louisiana
- Maine
- Minnesota
- Mississippi
- Missouri
- Montana
- Nebraska
- New Mexico
- North Dakota
- Oklahoma
- Rhode Island
- South Carolina
- Vermont
- Virginia
- West Virginia
- Wisconsin
- District of Columbia

### Category C: Incomplete because real payroll withholding depends on local or address-based inputs

These states need more than a single `state` field.

- Maryland
- Ohio
- Pennsylvania
- Indiana
- New York
- Oregon

Notes:

- Pennsylvania state withholding is simple, but true paycheck calculation is incomplete without local wage taxes.
- Indiana has state tax plus county tax.
- New York can require NYC or Yonkers local tax.
- Oregon has state tax plus location-sensitive payroll taxes in some cases.

## Phase 3A: Withholding-Mode Matrix

This phase answers a narrower question than the original audit:

- which states can remain on a simple payroll withholding model
- which states need their own payroll worksheet or withholding-table logic even without county or city taxes
- which states should stay in the local-tax queue

For this phase, `true payroll withholding logic` means:

- the state is calculated from an employer withholding method, worksheet, or payroll formula
- not from annual return-style tax brackets and deductions divided back down to one pay period

### Bucket 1: Safe to keep as zero or no-wage-tax states

These states do not need a dedicated wage withholding calculator for ordinary W-2 wages.

- Alaska
- Florida
- Nevada
- New Hampshire
- South Dakota
- Tennessee
- Texas
- Washington
- Wyoming

Implementation note:

- These can stay on the current `0` withholding path, but their metadata should eventually distinguish `no wage income tax` from `fully modeled payroll withholding`.

### Bucket 2: Good candidates for an early simple payroll patch set

These states are good targets for the first non-local payroll conversion pass because their withholding is relatively flat or formula-driven for hourly workers.

- Illinois
- Kentucky
- Michigan
- North Carolina
- Pennsylvania state withholding only
- Utah

Why these come first:

- they affect a broad number of service and hourly workers
- they do not require county or city lookups for their base state withholding
- they are materially closer to a payroll formula implementation than many progressive states

Important note:

- `simple` does not mean the current implementation is payroll-correct.
- Illinois and Colorado official guidance explicitly point employers to dedicated withholding worksheets or tables rather than annual return math.

### Bucket 3: Dedicated payroll worksheet or table required even without local taxes

These states do not necessarily need county or city inputs first, but they should not stay on the current generic annualized state engine if the goal is payroll-grade withholding.

- Alabama
- Arizona
- Arkansas
- California
- Colorado
- Connecticut
- Delaware
- District of Columbia
- Georgia
- Hawaii
- Idaho
- Iowa
- Kansas
- Louisiana
- Maine
- Massachusetts
- Minnesota
- Mississippi
- Missouri
- Montana
- Nebraska
- New Jersey
- New Mexico
- North Dakota
- Oklahoma
- Rhode Island
- South Carolina
- Vermont
- Virginia
- West Virginia
- Wisconsin

Why these need their own payroll treatment:

- they use state-specific withholding certificates, allowances, worksheets, or employer tables
- their payroll withholding rules are not equivalent to annual return tax computation
- some have already-corrected rate values, but still not a payroll-grade method

### Bucket 4: Local or location-based queue

These states still require local or location-sensitive payroll work beyond the state-only withholding layer.

- Maryland
- Ohio
- Indiana
- New York
- Oregon
- Pennsylvania

Notes:

- Pennsylvania belongs in both Bucket 2 and Bucket 4 conceptually: the base state withholding is simple, but a true paycheck calculator is incomplete without local earned income tax logic.
- Indiana base withholding may be simple, but the paycheck result is still incomplete without county tax.

## Phase 3A Deliverables

This phase should end with three concrete outputs.

### 1. State metadata reclassification

Add richer state statuses so the app can distinguish:

- `no_wage_tax`
- `simple_payroll_formula`
- `dedicated_payroll_formula_needed`
- `local_inputs_required`

The current `exact / approximate / incomplete` status is too coarse for rollout planning.

### 2. First non-local payroll patch sequence

Recommended order:

1. Illinois
2. Kentucky
3. Michigan
4. North Carolina
5. Pennsylvania state-only layer
6. Utah

These states give the highest confidence-to-effort ratio for improving paycheck realism before returning to more complex states.

### 3. Follow-on non-local payroll queue

After the first simple patch set, the next cluster should be:

1. Colorado
2. Georgia
3. Idaho
4. Iowa
5. Missouri
6. Montana
7. District of Columbia

Why this cluster:

- some have already been partially corrected for rate-table errors
- they still need withholding-method upgrades
- they are high-value states for replacing return-style logic with payroll logic

## Phase 3A Source Notes

Representative official sources confirming that payroll withholding often uses separate employer methods rather than annual return-style tax rates:

- Illinois withholding income tax overview and IL-700-T withholding tables booklet
- Colorado Withholding Tax Guide and DR 1098 withholding worksheet
- North Carolina NC-30 withholding tables and NC-4 certificate
- Kentucky employer payroll withholding guidance and withholding calculator

These sources support the implementation direction for Phase 3A:

- do not assume a state is payroll-correct merely because its annual tax rate is correct
- treat employer withholding guidance as the source of truth for paycheck calculation

## High-Priority Incorrect or High-Risk States

These states should be corrected before calling the calculator payroll-grade.

### Idaho

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:311)

Issue:

- The table currently uses `5.3%` plus a large deduction proxy.
- Idaho official guidance for tax year 2025 shows a `0%` bracket up to a threshold and `5.3%` above that threshold.
- This matters because the current engine can under-withhold at lower pay levels.

Result:

- Mark as `incorrect`.

### Missouri

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:545)

Issue:

- Current deduction values mirror federal-style amounts and do not match Missouri's current standard deduction amounts.
- Missouri also has its own indexed brackets and filing-year-specific changes.

Result:

- Mark as `incorrect`.

### Montana

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:564)

Issue:

- Current table still uses a deduction model.
- Montana repealed its standard deduction beginning in 2024 and changed its tax structure.

Result:

- Mark as `incorrect`.

### District of Columbia

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:210)

Issue:

- The current deduction values look like federal proxies and do not match D.C.'s own standard deduction values.

Result:

- Mark as `incorrect`.

### Maryland

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:422)

Issue:

- State brackets alone are not enough.
- Maryland payroll withholding depends on county local tax and resident/nonresident treatment.

Result:

- Mark as `structurally incomplete`.

### Ohio

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:815)

Issue:

- School district tax is completely missing.

Result:

- Mark as `structurally incomplete`.

### New York

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:718)

Issue:

- State tax is only part of payroll withholding.
- NYC and Yonkers local taxes are not represented.

Result:

- Mark as `structurally incomplete`.

### Indiana

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:326)

Issue:

- Indiana county tax is not represented.

Result:

- Mark as `structurally incomplete`.

### Pennsylvania

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:895)

Issue:

- State tax is simple and near-correct at the state level.
- Local earned income tax and local wage taxes are missing.

Result:

- Mark as `state-only correct, full paycheck incomplete`.

### Oregon

Current implementation:

- [shared/tax/tables/stateRates.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/tables/stateRates.ts:859)

Issue:

- State tax exists, but local transit/payroll taxes can apply depending on location.

Result:

- Mark as `state-only incomplete`.

## Missing Engine Capabilities

To become a true paycheck calculator, the engine should be able to return more than one generic `state` value.

Recommended shape:

- federal withholding
- Social Security
- Medicare
- state withholding
- local withholding lines
- employee-paid state payroll program lines
- employer-paid tax lines for future payroll views

Recommended breakdown expansion:

- `state`
- `localTaxes`
- `employeePrograms`
- `employerTaxes`
- `metadata`

Example metadata fields:

- jurisdiction resolution source
- home state
- work state
- local jurisdictions applied
- tax year used
- rule version used
- whether the result is exact, approximate, or fallback

## Schema Changes Needed

The current [shared/schemas/taxProfile.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/schemas/taxProfile.ts) is too small for payroll withholding.

Add these fields:

- `residenceState`
- `workState`
- `residenceCounty`
- `workCounty`
- `residenceCity`
- `workCity`
- `postalCode`
- `schoolDistrictId`
- `localTaxJurisdictionIds`
- `stateWithholdingAllowances`
- `stateAdditionalWithholding`
- `stateExempt`
- `reciprocityElection`
- `multiStateWorker`

Optional later fields:

- `residenceAddress`
- `workAddress`
- `countyFips`
- `geocode`
- `nonresidentAllocation`

## Engine Refactor Recommendation

Move from one generic state engine to a jurisdiction pipeline.

### Phase 1: State-only correctness

Goal:

- fix clearly wrong tables
- stop using federal deduction proxies where they do not belong
- add explicit status flags for exact vs approximate calculations

Work:

- correct Idaho
- correct Missouri
- correct Montana
- correct D.C.
- review Colorado and Iowa against actual taxable-income rules

### Phase 2: Local tax support

Goal:

- support states where location is required

Work:

- add county / district inputs to schema
- create a local tax resolution layer
- add Maryland county tax
- add Ohio school district tax
- add Indiana county tax
- add Pennsylvania local wage tax support
- add New York City / Yonkers support

### Phase 3: State-specific withholding logic

Goal:

- replace generic deduction/credit approximations with payroll-aware formulas

Work:

- introduce state-specific calculators where needed
- support states that use special withholding worksheets or credits
- support employee-paid state payroll programs

### Phase 4: Confidence labeling

Goal:

- surface whether a number is payroll-grade or estimated

Work:

- add per-line confidence flags
- show `exact`, `state-only`, or `approximate`
- avoid presenting approximation results as official paystub figures

## Proposed File Architecture

Recommended structure:

- `shared/tax/jurisdictions/index.ts`
- `shared/tax/jurisdictions/state/<state>.ts`
- `shared/tax/jurisdictions/local/<state>.ts`
- `shared/tax/jurisdictions/types.ts`
- `shared/tax/jurisdictions/resolveJurisdictions.ts`
- `shared/tax/jurisdictions/calculateStateWithholding.ts`
- `shared/tax/jurisdictions/calculateLocalWithholding.ts`

Keep [shared/tax/engine.ts](/Users/cajetanhughes/Desktop/App/TrackdOptimized/shared/tax/engine.ts) as the orchestrator rather than the place where every state rule lives.

## Immediate Implementation Checklist

### Patch set 1

- Correct Idaho state logic
- Correct Missouri deduction/rate logic
- Correct Montana post-2023 structure
- Correct D.C. deduction values
- Add engine metadata to mark state results as exact or approximate

### Patch set 2

- Expand `TaxProfile` schema for local/location inputs
- Update tax settings UI to collect county and district data when needed
- Add breakdown support for local taxes

### Patch set 3

- Implement Maryland county tax
- Implement Ohio school district tax
- Implement Indiana county tax
- Implement New York City / Yonkers logic
- Implement Pennsylvania local tax framework

## Audit Conclusion

The engine should no longer be thought of as `one state table plus generic math`.

To become a real paycheck calculator, it needs:

- corrected state data
- additional payroll-specific user inputs
- local jurisdiction support
- state-specific withholding logic where generic annualized math is insufficient

The best next coding step is Patch Set 1: fix the clearly incorrect state tables and introduce a more expressive state/local breakdown model.
