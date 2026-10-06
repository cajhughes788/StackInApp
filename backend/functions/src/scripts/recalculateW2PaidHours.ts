/**
 * One-time backfill for the paid-hours pay model (computeEntry W2_CALC_VERSION 2).
 *
 * v1 W-2 entries stored dayTotal = clocked hours × rate + tips + reported
 * cash, with an unpaid break subtracted later as a deduction. v2 stores
 * totals.hourlyPay = paid hours × rate and a dayTotal that already excludes
 * the break. This script:
 *   1. Upgrades every v1 W-2 entry's stored totals to v2. Hours are taken
 *      from the entry's own stored totals.paidHours — never re-derived from
 *      today's settings — so nothing but the break treatment changes.
 *      Entries without a break keep identical dollar amounts.
 *   2. Force-rebuilds the pay stubs of every workspace whose gross changed,
 *      from the earliest affected period onward in date order (YTD totals
 *      carry from one stub to the next).
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

    const hourlyPay = round2(paidHours * rate);
    const dayTotal = round2(hourlyPay + tips + reportedCash);
    const taxableTotal = round2(Math.max(dayTotal - custom, 0));

    const expectedDayTotal = num(t.dayTotal) - breakAmount;
    if (Math.abs(dayTotal - expectedDayTotal) > TOLERANCE)
        return { skip: `dayTotal check: new ${dayTotal} vs old ${num(t.dayTotal)} − break ${breakAmount}` };
    if (Math.abs(taxableTotal - num(t.taxableTotal)) > TOLERANCE)
        return { skip: `Day Total (taxableTotal) would change: ${num(t.taxableTotal)} → ${taxableTotal}` };

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
    const earliestChangedDate = changed.map((u) => u.date).sort()[0] ?? null;

    // Stubs to rebuild: every stub whose period ends on/after the earliest
    // changed entry, oldest first, so each picks up the corrected YTD chain.
    const stubsSnap = earliestChangedDate
        ? await db.collection(`workspaces/${workspaceId}/payStubs`).orderBy("periodStart", "asc").get()
        : null;
    const stubsToRebuild = (stubsSnap?.docs ?? []).filter((s) => String(s.get("periodEnd") ?? "") >= earliestChangedDate!);

    console.log(`\n[${workspaceId}] W-2 entries: ${entriesSnap.size} · to upgrade: ${upgrades.length} · gross changes (break shifts): ${changed.length} · total gross change: ${round2(changed.reduce((s, u) => s + u.grossChange, 0))} · skipped: ${skipped.length} · stubs to rebuild: ${stubsToRebuild.length}`);
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
    for (const stub of stubsToRebuild) {
        const uid = String(stub.get("uid") ?? "");
        if (!uid) {
            console.log(`  stub ${stub.id}: no uid, not rebuilt`);
            continue;
        }
        await payStubsSvc.generatePayStub(workspaceId, uid, {
            start: String(stub.get("periodStart")),
            end: String(stub.get("periodEnd")),
            periodId: stub.id,
            force: true,
        });
    }
    console.log(`  ✓ upgraded ${upgrades.length} entries, rebuilt ${stubsToRebuild.length} stubs`);
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
