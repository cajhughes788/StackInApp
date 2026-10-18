// Phase 1 backfill for the invoice payment ledger
// (docs/invoice-payments-architecture.md).
//
// Rewrites every invoice's stored ledger fields (payments, amountPaid,
// pendingPayment, openCheckout, the payment index arrays, refunds' paymentId)
// from its single-payment fields, through the same deriveLedgerFromLegacy
// every parse uses. A payment's receivedOn is taken from its income Entry's
// own date when the two differ (an online payment's paidAt is a UTC instant,
// the Entry is dated in the workspace's time zone).
//
// Only the ledger fields are written — the paid* fields, updatedAt and
// everything else are left alone. Safe to run more than once.
//
// Usage (needs the compiled backend: `npm --prefix backend/functions run build`,
// and Application Default Credentials for the target project):
//   node scripts/backfill-invoice-payments.cjs            # dry run: report only
//   node scripts/backfill-invoice-payments.cjs --write    # apply
//   node scripts/backfill-invoice-payments.cjs --workspace <id> [--write]

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const { db } = require("../backend/functions/lib/backend/functions/src/admin.js");
const { InvoiceSchema } = require("../shared/schemas/invoice.ts");

const LEDGER_FIELDS = [
  "payments",
  "refunds",
  "amountPaid",
  "pendingPayment",
  "openCheckout",
  "deposit",
  "closedAt",
  "paymentEntryIds",
  "paymentPlaidTransactionIds",
  "paymentIntentIds",
  "lastManualPaymentOn",
];

function parseArgs(argv) {
  const args = { write: false, workspaceId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write") args.write = true;
    else if (argv[i] === "--workspace") args.workspaceId = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// Firestore doesn't keep a map's key order, so compare with keys sorted.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value ?? null;
}

function same(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

async function entryDate(workspaceId, entryId) {
  if (!entryId) return null;
  const snap = await db.doc(`workspaces/${workspaceId}/entries/${entryId}`).get();
  const date = snap.exists ? snap.get("date") : null;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const query = args.workspaceId
    ? db.collection(`workspaces/${args.workspaceId}/invoices`)
    : db.collectionGroup("invoices");
  const snap = await query.get();

  const counts = { scanned: 0, unchanged: 0, updated: 0, datesCorrected: 0, unparseable: 0, skipped: 0 };
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    // Only workspaces/{id}/invoices/{id}.
    const workspaceRef = doc.ref.parent.parent;
    if (!workspaceRef || workspaceRef.parent.id !== "workspaces") {
      counts.skipped++;
      continue;
    }
    counts.scanned++;
    const stored = doc.data();
    const parsed = InvoiceSchema.safeParse(stored);
    if (!parsed.success) {
      counts.unparseable++;
      console.error(`unparseable ${doc.ref.path}:`, JSON.stringify(parsed.error.issues));
      continue;
    }
    let invoice = parsed.data;

    // Correct each payment's date from its Entry, then re-derive so the
    // corrected date sticks (a stored legacy payment for the same Entry
    // keeps its receivedOn).
    let corrected = false;
    const payments = [];
    for (const payment of invoice.payments) {
      const date = await entryDate(workspaceRef.id, payment.entryId);
      if (date && date !== payment.receivedOn) {
        corrected = true;
        payments.push({ ...payment, receivedOn: date });
      } else {
        payments.push(payment);
      }
    }
    if (corrected) {
      counts.datesCorrected++;
      invoice = InvoiceSchema.parse({ ...stored, payments });
    }

    const patch = {};
    for (const field of LEDGER_FIELDS) {
      if (!same(stored[field], invoice[field])) patch[field] = invoice[field];
    }
    if (Object.keys(patch).length === 0) {
      counts.unchanged++;
      continue;
    }
    counts.updated++;
    console.log(`${args.write ? "update" : "would update"} ${doc.ref.path}: ${Object.keys(patch).join(", ")}`);
    if (args.write) {
      batch.set(doc.ref, patch, { merge: true });
      if (++pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  if (args.write && pending > 0) await batch.commit();

  console.log(JSON.stringify({ mode: args.write ? "write" : "dry-run", ...counts }, null, 2));
  if (counts.unparseable > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
