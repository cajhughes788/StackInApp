// One-off: converts invoices saved before the payment ledger
// (docs/invoice-payments-architecture.md) — the single-payment fields
// paidAt, paidVia, paidEntryId, … — into invoice.payments, then deletes
// those fields. Only test invoices exist in that shape; delete this script
// once it has run against every environment.
//
// A paid invoice becomes one payment for its total ("legacy"), dated by its
// income Entry; an open Checkout or a clearing bank transfer moves to
// openCheckout / pendingPayment; refunds point at the payment. Every result
// is checked against InvoiceSchema before anything is written.
//
// Usage (needs the compiled backend: `npm --prefix backend/functions run build`,
// and Application Default Credentials):
//   GOOGLE_CLOUD_PROJECT=<project> node scripts/convert-legacy-invoices.cjs           # dry run
//   GOOGLE_CLOUD_PROJECT=<project> node scripts/convert-legacy-invoices.cjs --write   # apply

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../backend/functions/lib/backend/functions/src/admin.js");
const { InvoiceSchema } = require("../shared/schemas/invoice.ts");
const { invoiceLedgerFields } = require("../shared/invoicePayments.ts");

const LEGACY_FIELDS = [
  "paidAt",
  "paidVia",
  "paidMethod",
  "paidEntryId",
  "paidPlaidTransactionId",
  "paidStripePaymentIntentId",
  "paidFeeAmount",
  "pendingPaymentAt",
  "checkoutSessionId",
];

function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function entryDate(workspaceId, entryId) {
  if (!entryId) return null;
  const snap = await db.doc(`workspaces/${workspaceId}/entries/${entryId}`).get();
  const date = snap.exists ? snap.get("date") : null;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function convert(workspaceId, doc) {
  const total = typeof doc.total === "number" ? doc.total : 0;
  const via = ["bank_match", "manual", "online"].includes(doc.paidVia) ? doc.paidVia : "manual";
  const paidAt = str(doc.paidAt) ?? str(doc.updatedAt) ?? new Date().toISOString();
  const entryId = str(doc.paidEntryId);
  const sessionId = str(doc.checkoutSessionId);
  const payments = [];
  if (doc.status === "paid") {
    payments.push({
      id: "legacy",
      purpose: "full",
      amount: total,
      tipAmount: 0,
      receivedOn: (await entryDate(workspaceId, entryId)) ?? paidAt.slice(0, 10),
      via,
      method: str(doc.paidMethod) ?? (via === "online" ? "pos" : "other"),
      entryId,
      plaidTransactionId: str(doc.paidPlaidTransactionId),
      stripePaymentIntentId: str(doc.paidStripePaymentIntentId),
      checkoutSessionId: via === "online" ? sessionId : null,
      feeAmount: Math.max(0, Number(doc.paidFeeAmount) || 0),
      createdAt: paidAt,
    });
  }
  const pendingAt = str(doc.pendingPaymentAt);
  const converted = { ...doc };
  for (const field of LEGACY_FIELDS) delete converted[field];
  Object.assign(converted, invoiceLedgerFields(payments), {
    payments,
    refunds: (Array.isArray(doc.refunds) ? doc.refunds : []).map((refund) => ({
      ...refund,
      paymentId: str(refund.paymentId) ?? payments[0]?.id ?? "legacy",
    })),
    pendingPayment:
      doc.status === "sent" && pendingAt
        ? { checkoutSessionId: sessionId, purpose: "full", amount: total, tipAmount: 0, startedAt: pendingAt }
        : null,
    openCheckout:
      doc.status === "sent" && !pendingAt && sessionId
        ? { sessionId, purpose: "full", amountCents: Math.round(total * 100), tipCents: 0 }
        : null,
  });
  if (converted.dispute) converted.dispute = { ...converted.dispute, paymentId: converted.dispute.paymentId ?? payments[0]?.id ?? null };
  return converted;
}

async function main() {
  const write = process.argv.includes("--write");
  const snap = await db.collectionGroup("invoices").get();
  const counts = { scanned: 0, converted: 0, alreadyCurrent: 0, invalid: 0 };
  for (const docSnap of snap.docs) {
    const workspaceRef = docSnap.ref.parent.parent;
    if (!workspaceRef || workspaceRef.parent.id !== "workspaces") continue;
    counts.scanned++;
    const stored = docSnap.data();
    const isLegacy = LEGACY_FIELDS.some((field) => field in stored) || !Array.isArray(stored.payments);
    if (!isLegacy) {
      counts.alreadyCurrent++;
      continue;
    }
    const converted = await convert(workspaceRef.id, stored);
    const parsed = InvoiceSchema.safeParse(converted);
    if (!parsed.success) {
      counts.invalid++;
      console.error(`can't convert ${docSnap.ref.path}:`, JSON.stringify(parsed.error.issues));
      continue;
    }
    counts.converted++;
    const summary = parsed.data.payments.length
      ? `1 payment of ${parsed.data.payments[0].amount} on ${parsed.data.payments[0].receivedOn} (${parsed.data.payments[0].via})`
      : `no payments, ${parsed.data.status}`;
    console.log(`${write ? "convert" : "would convert"} ${docSnap.ref.path}: ${summary}`);
    if (write) {
      const deletes = Object.fromEntries(LEGACY_FIELDS.filter((field) => field in stored).map((field) => [field, FieldValue.delete()]));
      await docSnap.ref.set({ ...parsed.data, ...deletes }, { merge: true });
    }
  }
  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...counts }, null, 2));
  if (counts.invalid > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
