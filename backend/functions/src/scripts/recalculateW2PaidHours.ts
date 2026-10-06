/**
 * One-time backfill for the paid-hours pay model (computeEntry W2_CALC_VERSION 2).
 *
 * v1 W-2 entries stored dayTotal = clocked hours × rate + tips + reported
 * cash, with an unpaid break subtracted later as a deduction. v2 stores
 * totals.hourlyPay = paid hours × rate and a dayTotal that already excludes
 * the break. This script:
 *   1. Upgrades every v1 W-2 entry's stored totals to v2 by transforming
 *      its own stored figures — never re-deriving hours or rates from
 *      today's settings, and never re-rounding:
 *        dayTotal  = old dayTotal − old breakDeductionAmount
 *        hourlyPay = dayTotal − tips − reported cash
 *      so only the break treatment changes. Entries without a break keep
 *      byte-identical dollar amounts (no penny drift from re-rounding).
 *   2. Force-rebuilds only the pay stubs whose periods contain an entry
 *      whose gross changed, then re-chains ytdTotals on later stubs (YTD
 *      carries from one stub to the next). Later stubs are NOT fully
 *      rebuilt, so their tax estimates are left exactly as they were.
 *
 * Safety: each upgrade is checked against the v1 numbers it replaces
 * (new dayTotal must equal old dayTotal − break; the home "Day Total"
 * (taxableTotal) must not change). Any entry failing a check is reported
 * and left untouched.
 *
 * Deploy the backend (new computeEntry + pay stub logic) BEFORE executing.
 *
 * Usage (from backend/functions/, with Application Default Credentials for
 * the Firebase project and GCLOUD_PROJECT set):
 *   npx tsx src/scripts/recalculateW2PaidHours.ts                 # dry run, all workspaces
 *   npx tsx src/scripts/recalculateW2PaidHours.ts --workspace ID  # dry run, one workspace
 *   npx tsx src/scripts/recalculateW2PaidHours.ts --execute [--workspace ID]
 */
import { db } from "../admin";
import { W2_CALC_VERSION } from "@shared/computeEntry";
import * as payStubsSvc from "../services/payStubsService";

const TOLERANCE = 0.02;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function parseArgs() {
    const args = process.argv.slice(2);
    const i = args.indexOf("--workspace");
    return {
        execute: args.includes("--execute"),
        workspaceId: i >= 0 ? args[i + 1] : undefined,
    };
}

type Upgrade = {
    ref: FirebaseFirestore.DocumentReference;
    date: string;
    grossChange: number;
    totals: { hourlyPay: number; dayTotal: number; taxableTotal: number };
};

function planEntryUpgrade(doc: FirebaseFirestore.QueryDocumentSnapshot): Upgrade | { skip: string } | null {
    const e = doc.data() as any;
    const t = e.totals ?? {};
    if (num(t.calcVersion) >= W2_CALC_VERSION)
        return null; // already v2
    const rate = num(e.w2?.rate);
    const paidHours = num(t.paidHours);
    const tips = num(e.w2?.tips);
    const reportedCash = num(e.w2?.reportedCash);
    const custom = num(t.customDeductionsAmount);
    const breakAmount = num(t.breakDeductionAmount);
    const oldDayTotal = num(t.dayTotal);

    const dayTotal = breakAmount > 0 ? round2(oldDayTotal - breakAmount) : oldDayTotal;
    const hourlyPay = round2(dayTotal - tips - reportedCash);
    // v1 taxableTotal was rounded from the unrounded clocked gross, so on a
    // break shift it can sit a cent off the re-derived gross (half-cent
    // pay). Re-derive it from the new gross so it always equals
    // dayTotal − custom deductions, exactly as computeEntry v2 does.
    const taxableTotal = breakAmount > 0
        ? round2(Math.max(dayTotal - custom, 0))
        : num(t.taxableTotal);

    // Sanity checks against an independent derivation (paid hours × rate).
    if (hourlyPay < -TOLERANCE)
        return { skip: `negative hourly pay ${hourlyPay}` };
    if (Math.abs(hourlyPay - paidHours * rate) > TOLERANCE)
        return { skip: `hourly pay ${hourlyPay} ≠ paid hours ${paidHours} × rate ${rate} (${round2(paidHours * rate)})` };
    if (Math.abs(taxableTotal - num(t.taxableTotal)) > TOLERANCE)
        return { skip: `Day Total (taxableTotal) would change: ${num(t.taxableTotal)} → ${taxableTotal}` };
    if (Math.abs(round2(Math.max(dayTotal - custom, 0)) - taxableTotal) > TOLERANCE)
        return { skip: `Day Total (taxableTotal) inconsistent: stored ${taxableTotal}, new gross ${dayTotal} − deductions ${custom}` };

    return {
        ref: doc.ref,
        date: String(e.date ?? ""),
        grossChange: round2(dayTotal - num(t.dayTotal)),
        totals: { hourlyPay, dayTotal, taxableTotal },
    };
}

async function processWorkspace(workspaceId: string, execute: boolean) {
    const entriesSnap = await db.collection(`workspaces/${workspaceId}/entries`).where("workspace", "==", "w2").get();
    if (entriesSnap.empty)
        return null;

    const upgrades: Upgrade[] = [];
    const skipped: string[] = [];
    for (const doc of entriesSnap.docs) {
        const plan = planEntryUpgrade(doc);
        if (!plan) continue;
        if ("skip" in plan) skipped.push(`${doc.id} (${doc.get("date")}): ${plan.skip}`);
        else upgrades.push(plan);
    }
    const changed = upgrades.filter((u) => Math.abs(u.grossChange) > 0.001);
    const changedDates = [...new Set(changed.map((u) => u.date))].sort();

    // Stubs to fully rebuild: only periods containing a changed entry.
    const stubsSnap = changedDates.length > 0
        ? await db.collection(`workspaces/${workspaceId}/payStubs`).get()
        : null;
    const stubsToRebuild = (stubsSnap?.docs ?? []).filter((s) => changedDates.some((d) => d >= String(s.get("periodStart")) && d <= String(s.get("periodEnd"))));
    const stubUid = String(stubsSnap?.docs[0]?.get("uid") ?? "");

    console.log(`\n[${workspaceId}] W-2 entries: ${entriesSnap.size} · to upgrade: ${upgrades.length} · gross changes (break shifts only): ${changed.length} · total gross change: ${round2(changed.reduce((s, u) => s + u.grossChange, 0))} · skipped: ${skipped.length} · stubs to fully rebuild: ${stubsToRebuild.length} (+ YTD re-chain on later stubs)`);
    for (const line of skipped) console.log(`  SKIPPED ${line}`);
    for (const u of changed.slice(0, 20)) console.log(`  ${u.date} gross ${u.grossChange} → dayTotal ${u.totals.dayTotal}, hourlyPay ${u.totals.hourlyPay}`);
    if (changed.length > 20) console.log(`  … and ${changed.length - 20} more`);

    if (!execute)
        return { upgrades: upgrades.length, changed: changed.length, skipped: skipped.length, stubs: stubsToRebuild.length };

    for (let i = 0; i < upgrades.length; i += 400) {
        const batch = db.batch();
        for (const u of upgrades.slice(i, i + 400)) {
            batch.update(u.ref, {
                "totals.hourlyPay": u.totals.hourlyPay,
                "totals.dayTotal": u.totals.dayTotal,
                "totals.taxableTotal": u.totals.taxableTotal,
                "totals.calcVersion": W2_CALC_VERSION,
            });
        }
        await batch.commit();
    }
    let touchedStubs = 0;
    if (changedDates.length > 0) {
        if (!stubUid) {
            console.log("  no pay stubs with a uid found; stubs not rebuilt");
        }
        else {
            // Rebuilds the changed periods (force: entry timestamps are
            // untouched by this backfill) and re-chains YTD after them.
            const synced = await payStubsSvc.syncPayStubForDates(workspaceId, stubUid, changedDates, { force: true });
            touchedStubs = synced.length;
        }
    }
    console.log(`  ✓ upgraded ${upgrades.length} entries; rebuilt ${stubsToRebuild.length} stub(s), ${touchedStubs} stub(s) updated incl. YTD re-chain`);
    return { upgrades: upgrades.length, changed: changed.length, skipped: skipped.length, stubs: stubsToRebuild.length };
}

async function main() {
    const { execute, workspaceId } = parseArgs();
    console.log(execute ? "EXECUTING — writes will be made." : "DRY RUN — no writes. Pass --execute to apply.");
    const workspaceIds = workspaceId
        ? [workspaceId]
        : (await db.collection("workspaces").listDocuments()).map((d) => d.id);
    const totals = { workspaces: 0, upgrades: 0, changed: 0, skipped: 0, stubs: 0 };
    for (const id of workspaceIds) {
        const r = await processWorkspace(id, execute);
        if (!r) continue;
        totals.workspaces++;
        totals.upgrades += r.upgrades;
        totals.changed += r.changed;
        totals.skipped += r.skipped;
        totals.stubs += r.stubs;
    }
    console.log(`\nSummary: ${totals.workspaces} W-2 workspaces · ${totals.upgrades} entries ${execute ? "upgraded" : "to upgrade"} (${totals.changed} with gross changes) · ${totals.skipped} skipped · ${totals.stubs} stubs ${execute ? "rebuilt" : "to rebuild"}`);
}

main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
});
