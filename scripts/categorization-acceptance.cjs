// How often users keep the pre-filled expense category on confirmed bank
// transactions, broken down by the signal that made the guess
// (suggestionSource on plaidPendingTransactions). Only covers transactions
// ingested since suggestionSource was recorded.
//
// Usage: node scripts/categorization-acceptance.cjs [--since YYYY-MM-DD]
// Requires a built backend (npm run build in backend/functions).
const { db } = require("../backend/functions/lib/backend/functions/src/admin.js");

async function main() {
  const sinceIndex = process.argv.indexOf("--since");
  const since = sinceIndex !== -1 ? process.argv[sinceIndex + 1] : null;

  // Unfiltered collection-group read: a where() here would need a
  // collection-group index that doesn't exist.
  const snap = await db
    .collectionGroup("plaidPendingTransactions")
    .select("status", "suggestionSource", "suggestionAccepted", "suggestedExpenseAccount", "confirmedExpenseAccount", "date")
    .get();

  const bySource = new Map();
  const overrides = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status !== "confirmed" || data.confirmedExpenseAccount === undefined) continue;
    if (since && data.date < since) continue;
    const source = data.suggestionSource || "no_suggestion";
    const row = bySource.get(source) || { confirmed: 0, accepted: 0 };
    row.confirmed += 1;
    if (data.suggestionAccepted === true) row.accepted += 1;
    bySource.set(source, row);
    if (data.suggestionAccepted === false) {
      const key = `${source}: ${data.suggestedExpenseAccount} → ${data.confirmedExpenseAccount}`;
      overrides.set(key, (overrides.get(key) || 0) + 1);
    }
  }

  const table = [...bySource.entries()]
    .sort((a, b) => b[1].confirmed - a[1].confirmed)
    .map(([source, row]) => ({
      source,
      confirmed: row.confirmed,
      kept: row.accepted,
      keptRate: source === "no_suggestion" ? "—" : `${Math.round((row.accepted / row.confirmed) * 100)}%`,
    }));
  console.table(table);

  const topOverrides = [...overrides.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (topOverrides.length > 0) {
    console.log("\nMost common corrections:");
    for (const [key, count] of topOverrides) console.log(`  ${count}× ${key}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
