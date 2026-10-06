/**
 * Repairs pay stub YTD chains that drifted before entry writes re-chained
 * later stubs automatically (see cascadeYtdAfter in payStubsService).
 *
 * A stub's ytdTotals must equal its predecessor's ytdTotals plus its own
 * period (resetting at the start of the year). For each workspace this
 * finds the first stub that breaks that rule and re-chains YTD from there
 * using the same code path entry writes use. Only ytdTotals (and
 * updatedAt) change — period gross, net and tax estimates are untouched.
 *
 * Usage (from backend/functions/, with Application Default Credentials):
 *   GCLOUD_PROJECT=trackd-optimized npx tsx src/scripts/rechainPayStubYtd.ts                 # dry run
 *   GCLOUD_PROJECT=trackd-optimized npx tsx src/scripts/rechainPayStubYtd.ts --workspace ID  # one workspace
 *   GCLOUD_PROJECT=trackd-optimized npx tsx src/scripts/rechainPayStubYtd.ts --execute [--workspace ID]
 */
import { db } from "../admin";
import * as payStubsSvc from "../services/payStubsService";

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseArgs() {
    const args = process.argv.slice(2);
    const i = args.indexOf("--workspace");
    return { execute: args.includes("--execute"), workspaceId: i >= 0 ? args[i + 1] : undefined };
}

/** First stub whose YTD gross ≠ predecessor YTD + own gross; returns the
 * predecessor's periodEnd (the re-chain starts after it). */
async function findFirstBreak(workspaceId: string): Promise<{ afterPeriodEnd: string; periodStart: string; stored: number; expected: number } | null> {
    const stubs = await db.collection(`workspaces/${workspaceId}/payStubs`).orderBy("periodStart", "asc").get();
    let prev: FirebaseFirestore.DocumentData | null = null;
    for (const doc of stubs.docs) {
        const st = doc.data();
        const startOfYear = `${String(st.periodStart).slice(0, 4)}-01-01`;
        const base = prev && String(prev.periodEnd) >= startOfYear ? Number(prev.ytdTotals?.grossIncome ?? 0) : 0;
        const expected = round2(base + Number(st.grossIncome ?? 0));
        const stored = Number(st.ytdTotals?.grossIncome ?? NaN);
        if (prev && !(Math.abs(stored - expected) < 0.011))
            return { afterPeriodEnd: String(prev.periodEnd), periodStart: String(st.periodStart), stored, expected };
        prev = st;
    }
    return null;
}

async function main() {
    const { execute, workspaceId } = parseArgs();
    console.log(execute ? "EXECUTING — writes will be made." : "DRY RUN — no writes. Pass --execute to apply.");
    const ids = workspaceId ? [workspaceId] : (await db.collection("workspaces").listDocuments()).map((d) => d.id);
    let repaired = 0;
    for (const id of ids) {
        const settings = await payStubsSvc.getWorkspaceSettings(id).catch(() => null);
        if (!settings) continue;
        // Re-scan after each repair: a chain can have more than one break.
        for (let pass = 0; pass < 10; pass++) {
            const brk = await findFirstBreak(id);
            if (!brk) break;
            const changed = await payStubsSvc.rechainYtdAfter(id, settings, brk.afterPeriodEnd, { write: execute });
            console.log(`[${id}] break at ${brk.periodStart}: YTD gross ${brk.stored} should be ${brk.expected} · ${changed.length} stub(s) ${execute ? "re-chained" : "would be re-chained"}`);
            for (const s of changed.slice(0, 5)) console.log(`    ${s.periodStart}: ytd gross → ${s.ytdTotals?.grossIncome}`);
            repaired += changed.length;
            if (!execute) break; // nothing was written; a re-scan would find the same break
        }
    }
    console.log(`\nSummary: ${repaired} stub(s) ${execute ? "re-chained" : "would be re-chained"}`);
}

main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
});
