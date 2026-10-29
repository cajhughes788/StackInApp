"""Tax audit, part 2: run the households in inputs.json through PolicyEngine
(an independent, open-source US tax calculator) and save its answer for
each line we compare.

Usage (from the repo root; see scripts/oracle/README.md for setup):
  node scripts/oracle/households.cjs
  scripts/oracle/.venv/bin/python scripts/oracle/run_policyengine.py
  node scripts/oracle/compare.cjs
"""
import importlib.metadata
import json
import sys
from pathlib import Path

from policyengine_us import Simulation
import policyengine_us

HERE = Path(__file__).parent
BATCH = 500

FILING_STATUS = {
    "single": "SINGLE",
    "marriedJoint": "JOINT",
    "marriedSeparate": "SEPARATE",
    "headOfHousehold": "HEAD_OF_HOUSEHOLD",
}

FEDERAL_VARIABLES = [
    "self_employment_tax",
    "self_employment_tax_ald",
    "additional_medicare_tax",
    "adjusted_gross_income",
    "standard_deduction",
    "tip_income_deduction",
    "qualified_business_income_deduction",
    "taxable_income",
    "income_tax_main_rates",
    "ctc",
    # Whether PolicyEngine chose to itemize (we always assume the standard
    # deduction; itemizers are sent to a tax pro).
    "tax_unit_itemizes",
]

# State tax before credits: ours leaves state credits out (states.ts).
STATE_VARIABLE = {
    "GA": "ga_income_tax_before_non_refundable_credits",
    "IL": "il_income_tax_before_non_refundable_credits",
    "KY": "ky_income_tax_before_non_refundable_credits_unit",
    "MI": "mi_income_tax_before_non_refundable_credits",
    "NC": "nc_income_tax_before_credits",
    "PA": "pa_income_tax_before_forgiveness",
}
NO_TAX_VARIABLE = "state_income_tax_before_refundable_credits"


def situation_for(households, year):
    y = str(year)
    people, tax_units, households_out, families, spm_units, marital_units = {}, {}, {}, {}, {}, {}
    for h in households:
        hid = h["id"]
        head = f"{hid}-head"
        members = [head]
        people[head] = {
            "age": {y: 40},
            "self_employment_income": {y: h["profit"]},
            "employment_income": {y: h["w2Wages"]},
        }
        # PolicyEngine adds Alaska's Permanent Fund Dividend to Alaskans'
        # income by default; the app has no such income.
        if h["stateCode"] == "AK":
            people[head]["ak_permanent_fund_dividend"] = {y: 0}
        all_tips = h["tips"] + h.get("w2Tips", 0)
        if all_tips > 0:
            # Tips are already inside the business profit and the W-2 pay;
            # tip_income only feeds the deduction (it isn't added to gross
            # income). PolicyEngine takes one occupation code per person.
            people[head]["tip_income"] = {y: all_tips}
            people[head]["treasury_tipped_occupation_code"] = {y: int(h["occupationCode"])}
        adults = [head]
        if h["filingStatus"] == "marriedJoint":
            spouse = f"{hid}-spouse"
            people[spouse] = {"age": {y: 40}}
            members.append(spouse)
            adults.append(spouse)
        for c in range(h["children"]):
            child = f"{hid}-child{c}"
            people[child] = {"age": {y: 3 + 3 * c}, "is_tax_unit_dependent": {y: True}}
            members.append(child)
        tax_units[hid] = {"members": members, "filing_status": {y: FILING_STATUS[h["filingStatus"]]}}
        households_out[hid] = {"members": members, "state_code": {y: h["stateCode"] or "TX"}}
        families[hid] = {"members": members}
        spm_units[hid] = {"members": members}
        marital_units[hid] = {"members": adults}
        for c in range(h["children"]):
            marital_units[f"{hid}-child{c}"] = {"members": [f"{hid}-child{c}"]}
    return {
        "people": people,
        "tax_units": tax_units,
        "households": households_out,
        "families": families,
        "spm_units": spm_units,
        "marital_units": marital_units,
    }


def run_batch(households, year):
    sim = Simulation(situation=situation_for(households, year))
    values = {
        name: sim.calculate(name, year, map_to="household").tolist()
        for name in FEDERAL_VARIABLES + list(STATE_VARIABLE.values()) + [NO_TAX_VARIABLE]
    }
    results = []
    for i, h in enumerate(households):
        row = {name: round(values[name][i], 2) for name in FEDERAL_VARIABLES}
        state_var = STATE_VARIABLE.get(h["stateCode"], NO_TAX_VARIABLE)
        row["state_tax_before_credits"] = round(values[state_var][i], 2)
        results.append({"id": h["id"], **row})
    return results


def main():
    inputs = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "inputs.json"
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "policyengine-results.json"
    data = json.loads(inputs.read_text())
    households, year = data["households"], data["year"]
    results = []
    for start in range(0, len(households), BATCH):
        results += run_batch(households[start : start + BATCH], year)
        print(f"  {min(start + BATCH, len(households))}/{len(households)}", file=sys.stderr)
    out = {
        "year": year,
        "policyengineUsVersion": importlib.metadata.version("policyengine-us"),
        "results": results,
    }
    output.write_text(json.dumps(out))
    print(f"wrote {len(results)} results to {output}")


if __name__ == "__main__":
    main()
