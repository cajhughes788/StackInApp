# Yearly tax update

Every number the self-employed tax estimate uses, where it is published, and the steps to add a new year. Part 5 of the tax audit.

**Deadline: January 16.** That is when the app switches to the new tax year (until January 15 it still shows last year's fourth payment). With no table for the new year, the Taxes page shows "Tax estimates for {year} aren't available yet" and no reminders go out. It never reuses last year's numbers.

**Warnings:**
- **From November 1:** `node scripts/run-tests.cjs` prints a warning when next year's table is missing.
- **From January 1:** the tests fail outright.

## Timeline

| When | What usually comes out |
|---|---|
| October | SSA Social Security wage base for next year |
| Late October / November | IRS inflation adjustments (Revenue Procedure): brackets, standard deduction, QBI threshold, indexed amounts |
| November / December | Form 1040-ES for next year (due dates); IRS Publication 15-T (W-2 withholding) |
| December / January | Most states' rates, deductions and exemptions |
| Any time | Law changes (for example the One Big Beautiful Bill Act, July 2025). Check the IRS newsroom each spring and summer too. |

## Steps

1. **Start the year** (in November):
   ```bash
   node scripts/new-tax-year.cjs 2027
   ```
   This copies last year's files to `shared/estimatedTax/years/2027.ts` and `shared/tax/tables/federal2027.ts`, with every number marked `/* UNVERIFIED */`. The year is **not** turned on yet, and `node scripts/run-tests.cjs` fails while any mark remains.
2. **Check every number** in the table below against its source. Fix it if it changed, remove its `/* UNVERIFIED */` mark, and update the source comment above it. Record each one in the sign-off table at the bottom.
3. **Add the "figures match their sources" test** for the year in `scripts/test-estimated-tax.cjs` (copy the 2026 one), plus one worked household checked by hand.
4. **Turn the year on:** add it to `YEARS` in `shared/estimatedTax/years/index.ts`.
5. **Rerun the outside check (part 2)** with a PolicyEngine version that has the new year:
   ```bash
   scripts/oracle/.venv/bin/pip install --upgrade policyengine-us
   TAX_YEAR=2027 node scripts/oracle/households.cjs
   scripts/oracle/.venv/bin/python scripts/oracle/run_policyengine.py
   TAX_YEAR=2027 node scripts/oracle/compare.cjs
   TAX_YEAR=2027 node scripts/oracle/snapshot.cjs
   ```
   `compare.cjs` must say `0 bugs, 0 unexplained`. Pin the new PolicyEngine version in `scripts/oracle/README.md`.
6. **Save the year's golden file (part 4)** once the numbers are checked:
   ```bash
   node scripts/test-tax-golden.cjs --update 2027
   ```
   Read through the 2027 headlines for anything odd before saving. Leap years get February 29 situations automatically.

   Turning a year on also changes last year's two "on January 16" situations, which go from "not available yet" to a real estimate. Check that those two are the only changes, then save last year's file too: `node scripts/test-tax-golden.cjs --update 2026`.
7. **Run everything:** `node scripts/run-tests.cjs` passes. Then deploy both the app and Firebase Functions (the reminder push reads the table).
8. **W-2 paycheck tables** (a separate feature, same timing): add `shared/tax/tables/payroll2027.ts` from Publication 15-T and register it in `shared/tax/payrollYears.ts`. Until then, paychecks use last year's tables and say so.

## Every number, by source

"Law" means a number fixed in the tax code. It only changes if the law does, so it still needs a yearly glance at any new legislation.

### Federal (IRS)

| Number | File / field | Source | Changes |
|---|---|---|---|
| Tax brackets, 4 filing statuses | `tax/tables/federal{year}.ts` brackets | IRS Rev. Proc. (inflation adjustments) | Yearly |
| Standard deduction | `federal{year}.ts` standardDeduction | IRS Rev. Proc. | Yearly |
| Social Security wage base | `years/{year}.ts` selfEmployment.socialSecurityWageBase | SSA "Contribution and benefit base" | Yearly; must equal the payroll table's |
| SE rates 12.4% / 2.9%, the 92.35% factor, the $400 minimum | selfEmployment.* | Law (§1401, §1402) | Law |
| Additional Medicare 0.9% and its thresholds | additionalMedicare | Law (§3101(b)(2)); not indexed | Law |
| QBI threshold | qbi.threshold | IRS Rev. Proc. | Yearly |
| QBI phase-in range ($75k / $150k) | qbi.phaseInRange | Law (§199A(b)(3)(B)) | Law |
| QBI $400 minimum and $1,000 floor | qbi.minimumDeduction, minimumDeductionQbiFloor | §199A(i). Check the Rev. Proc. for inflation indexing | Check yearly |
| Child tax credit per child | childTaxCredit.perChild | IRS Rev. Proc. / Form 1040 instructions. Check for indexing | Check yearly |
| Child credit phase-out ($200k / $400k, $50 per $1,000) | childTaxCredit.phaseOut* | Law; not indexed | Law |
| Tips deduction ($25,000; phase-out $150k / $300k; $100 per $1,000) | tipsDeduction | Law (§224). **Ends after 2028: set `tipsDeduction: null` from 2029** | Law; ends 2028 |
| Tipped occupation list | `estimatedTax/tippedOccupations.ts` | Treasury / IRS list (irs.gov/tippedoccupations) | Check yearly |
| Safe harbor (100% / 110%, $150k / $75k AGI, 90%, $1,000) | safeHarbor | Law (§6654) | Law |
| Form 1099-K threshold ($20,000 and 200 payments) | `taxPackage.ts` FORM_1099K_THRESHOLD | Law (§6050W(e)) | Law |
| Due dates | quarters[].dueDate | Form 1040-ES for the year. A weekend or holiday moves the date to the next business day; the tests flag weekends, but check holidays by hand. Example: the fourth 2027 payment falls on Saturday, January 15, 2028; Monday, January 17 is Martin Luther King Jr. Day, so it's due January 18 | Yearly |
| Annualization periods and factors (4, 2.4, 1.5, 1) | quarters[].periodEnd, annualizationFactor | Form 2210 Schedule AI | Law |

### States (each state's revenue department)

| State | Fields | Watch for |
|---|---|---|
| AK, FL, NV, NH, SD, TN, TX, WA, WY | `kind: "none"` | A new wage or business income tax (NH ended its interest and dividends tax after 2024) |
| GA | rate, standard deduction, dependent exemption | Rate cuts scheduled by law (HB 463); a new state tip exclusion |
| IL | rate, exemption, exemption AGI limit | Exemption amount indexed yearly |
| KY | rate, standard deduction | Rate cuts triggered by state revenue; deduction indexed yearly |
| MI | rate, exemption, **SE tax add-back (Schedule 1 line 2)** | Rate can drop to 4.05% in some years; exemption indexed; state tip and overtime deductions |
| NC | rate, standard deduction | Scheduled rate cuts; child deduction (not modeled) |
| PA | rate, classes rule | Rate 3.07% (stable); local earned income tax not included |

Leaving a state out of the year's table is always allowed: the app then says "{state} tax isn't included yet" and never guesses.

### Not in the estimate, same timing

- **W-2 paycheck withholding:** `shared/tax/tables/payroll{year}.ts`, from IRS Publication 15-T and SSA.
- **W-2 paycheck state tables:** `shared/tax/states/*` and `shared/tax/tables/stateRates.ts`, Indiana county rates, Maryland local rates.

## Sign-off

| Year | Item | Checked by | Date | Source link |
|---|---|---|---|---|
| 2026 | All estimate numbers (sources cited in `years/2026.ts` and `states.ts`) | — | 2026 | See comments in code |
| 2026 | Outside check (PolicyEngine-US 2.74.2): 0 bugs, 0 unexplained | Tax audit part 2 | 2026-10-27 | `scripts/oracle/README.md` |
| 2026 | Golden file, 181 situations | Tax audit part 4 | 2026-10-27 | `scripts/golden/tax-2026.golden.json` |
