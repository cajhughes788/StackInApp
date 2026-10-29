# Tax oracle: checking our tax math against PolicyEngine

Part 2 of the tax audit. [PolicyEngine-US](https://github.com/PolicyEngine/policyengine-us) is an independent, open-source US tax calculator. We run the same households through it and through our estimate (`shared/estimatedTax`), then compare each line to within $1.

## Every run (no Python needed)

`scripts/test-tax-oracle.cjs` checks our code against about 500 PolicyEngine answers saved in `policyengine-2026-snapshot.json`. It runs with the other tests (`node scripts/run-tests.cjs`). It fails on any difference that isn't a known, cautious choice (listed in `compare.cjs`), or if one of those ever makes our estimate lower than PolicyEngine's.

## Full run (each November with the new year's numbers, or after any tax-math change)

One-time setup, from the repo root (the environment takes about 735 MB and is gitignored):

```bash
python3 -m venv scripts/oracle/.venv
scripts/oracle/.venv/bin/pip install "policyengine-us==2.74.2"
```

Then:

```bash
node scripts/oracle/households.cjs            # ~5,200 households → inputs.json
scripts/oracle/.venv/bin/python scripts/oracle/run_policyengine.py   # ~25 s → policyengine-results.json
node scripts/oracle/compare.cjs               # report, grouped by cause → mismatches.json
node scripts/oracle/snapshot.cjs              # refresh the saved answers the regular test uses
```

`compare.cjs` should report `0 bugs, 0 unexplained`. By default the newest year that's turned on is used. For a new tax year, upgrade PolicyEngine to a version that has that year's figures, run the same commands with `TAX_YEAR=2027` in front of each `node` command, and pin the new version above (docs/tax-yearly-update.md, step 5).

## What's compared

Self-employment tax and its deduction, Additional Medicare tax, AGI, standard deduction, tips deduction, QBI deduction, taxable income, income tax from the brackets, child tax credit (the part that lowers income tax), and state tax before credits for the states the estimate includes.

These are not compared: quarterly due dates, the penalty-free amount and the annualized installments, because PolicyEngine doesn't model them. Those are hand-worked from Form 1040-ES and Form 2210 Schedule AI in `scripts/test-estimated-tax.cjs`.

## Known, deliberate differences (ours is equal or higher)

- **$400 minimum QBI deduction:** held to 20% of taxable income.
- **Self-employed tips:** held to business net income.
- **Georgia and Michigan state tip breaks:** not included.
- **North Carolina child deduction:** not modeled.
- **Above the QBI threshold:** we assume no employees and no business property, and the Taxes card shows a warning.
- **Itemizing:** PolicyEngine sometimes itemizes, deducting state income tax as SALT. We always use the standard deduction, because itemizers are sent to a tax pro.
- **Alaska's Permanent Fund Dividend:** set to $0 on the PolicyEngine side, since the app has no such income.
