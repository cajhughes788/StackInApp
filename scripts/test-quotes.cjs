require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  QuoteActionSchema,
  QuoteCreateInputSchema,
  QuotePatchSchema,
  QuoteResponseSchema,
  QuoteSchema,
} = require("../shared/schemas/quote.ts");
const { InvoiceCreateInputSchema, InvoiceSchema, InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");
const {
  addQuoteDays,
  publicQuoteUrl,
  quoteAnswerBlocker,
  quoteAnswerNotificationText,
  quoteDisplayStatus,
  quoteInvoicePrefill,
  quoteInvoiced,
  quoteIsExpired,
  quoteNumberLabel,
  quoteReleased,
  quotesToInvoice,
} = require("../shared/quotes.ts");
const { renderPublicQuotePage, renderPublicQuoteNotFound } = require("../shared/quotePublicPage.ts");
const { buildQuoteEmail } = require("../shared/quoteEmail.ts");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(error);
  }
}

const NOW = "2026-11-05T15:00:00.000Z";
const TODAY = "2026-11-05";
const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh <Cuts>", businessEmail: "hi@fresh.example" });

function quote(extra = {}) {
  const lines = extra.lines ?? [
    { description: "Kitchen repaint", quantity: 2, rate: 450, amount: 900, category: "services" },
    { description: "Paint", quantity: 1, rate: 120.5, amount: 120.5, category: "products" },
  ];
  return QuoteSchema.parse({
    id: "q1",
    workspaceId: "ws",
    number: "0003",
    clientName: "Jo Rivera",
    clientId: "c1",
    clientEmail: "jo@example.com",
    clientPhone: "555-0100",
    clientAddress: "1 Main St",
    lines,
    total: lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100,
    issueDate: TODAY,
    validUntil: "2026-12-05",
    note: "Two coats, done in a week.",
    policies: "50% deposit is non-refundable.",
    deposit: { amount: 300 },
    shareToken: "TOKEN1234567890abcdef",
    sharedAt: NOW,
    status: "sent",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });
}

console.log("quote rules");

test("a quote's total must equal its lines, and its deposit stay under the total", () => {
  assert.equal(quote().total, 1020.5);
  assert.throws(() => quote({ total: 1000 }));
  assert.throws(() => quote({ deposit: { amount: 1020.5 } }));
});

test("numbers read Q-0003 and links live under /q/", () => {
  assert.equal(quoteNumberLabel("0003"), "Q-0003");
  assert.equal(publicQuoteUrl("abc"), "https://app.the521app.com/q/abc");
  assert.equal(addQuoteDays("2026-11-05", 30), "2026-12-05");
});

test("a sent quote past its valid-until date is expired; the last day still counts", () => {
  assert.equal(quoteIsExpired(quote({ validUntil: TODAY }), TODAY), false);
  assert.equal(quoteIsExpired(quote({ validUntil: "2026-11-04" }), TODAY), true);
  // Only a sent quote expires; an accepted one stays accepted.
  assert.equal(quoteIsExpired(quote({ validUntil: "2026-11-04", status: "accepted" }), TODAY), false);
});

test("only a sent, unexpired quote can be answered", () => {
  assert.equal(quoteAnswerBlocker(quote(), TODAY), null);
  assert.match(quoteAnswerBlocker(quote({ validUntil: "2026-11-04" }), TODAY), /expired/);
  assert.match(quoteAnswerBlocker(quote({ status: "declined" }), TODAY), /declined/);
  assert.match(quoteAnswerBlocker(quote({ status: "withdrawn" }), TODAY), /withdrawn/);
  assert.match(quoteAnswerBlocker(quote({ status: "accepted" }), TODAY), /already accepted/);
  assert.match(quoteAnswerBlocker(quote({ status: "invoiced" }), TODAY), /already accepted/);
  assert.match(quoteAnswerBlocker(quote({ status: "draft" }), TODAY), /isn't available/);
});

test("statuses read the way the owner and client see them", () => {
  const label = (extra) => quoteDisplayStatus(quote(extra), TODAY).label;
  assert.equal(label({}), "Valid until Dec 5, 2026");
  assert.equal(quoteDisplayStatus(quote(), TODAY, { short: true }).label, "Valid to Dec 5");
  assert.equal(label({ validUntil: "2026-11-01" }), "Expired");
  assert.equal(label({ status: "accepted" }), "Accepted");
  assert.equal(label({ status: "invoiced" }), "Invoiced");
  assert.equal(label({ status: "declined" }), "Declined");
  assert.equal(label({ status: "withdrawn" }), "Withdrawn");
  assert.equal(label({ status: "draft" }), "Draft");
});

test("accepting needs a typed name; declining takes an optional note", () => {
  assert.equal(QuoteResponseSchema.safeParse({ answer: "accept", name: "  " }).success, false);
  assert.equal(QuoteResponseSchema.parse({ answer: "accept", name: " Jo Rivera " }).name, "Jo Rivera");
  assert.equal(QuoteResponseSchema.parse({ answer: "decline" }).note, "");
  assert.equal(QuoteResponseSchema.safeParse({ answer: "maybe" }).success, false);
});

test("create and edit inputs check the dates and the deposit", () => {
  const base = {
    clientName: "Jo",
    lines: [{ description: "Work", quantity: 1, rate: 100, category: "services" }],
    issueDate: TODAY,
    validUntil: "2026-12-05",
  };
  assert.equal(QuoteCreateInputSchema.safeParse(base).success, true);
  assert.equal(QuoteCreateInputSchema.safeParse({ ...base, validUntil: "2026-11-01" }).success, false);
  assert.equal(QuoteCreateInputSchema.safeParse({ ...base, deposit: { amount: 100 } }).success, false);
  assert.equal(QuoteCreateInputSchema.safeParse({ ...base, deposit: { amount: 40 } }).success, true);
  assert.equal(QuotePatchSchema.safeParse({ validUntil: "2026-12-31" }).success, true);
  assert.equal(QuoteActionSchema.safeParse({ action: "withdraw" }).success, true);
  assert.equal(QuoteActionSchema.safeParse({ action: "accept" }).success, false);
});

console.log("turning a quote into an invoice");

test("the invoice starts with the quote's client, lines, note, terms and deposit — exactly", () => {
  const from = quoteInvoicePrefill(quote());
  assert.deepEqual(
    { name: from.clientName, id: from.clientId, email: from.clientEmail, phone: from.clientPhone, address: from.clientAddress },
    { name: "Jo Rivera", id: "c1", email: "jo@example.com", phone: "555-0100", address: "1 Main St" }
  );
  assert.deepEqual(from.lines, [
    { description: "Kitchen repaint", quantity: 2, rate: 450, category: "services" },
    { description: "Paint", quantity: 1, rate: 120.5, category: "products" },
  ]);
  assert.equal(from.note, "Two coats, done in a week.");
  assert.equal(from.policies, "50% deposit is non-refundable.");
  assert.equal(from.depositAmount, 300);
  assert.equal(quoteInvoicePrefill(quote({ deposit: null })).depositAmount, null);
});

test("the invoice made from those lines totals the same as the quote", () => {
  const from = quoteInvoicePrefill(quote());
  const input = InvoiceCreateInputSchema.parse({
    clientName: from.clientName,
    lines: from.lines,
    issueDate: TODAY,
    dueDate: "2026-12-05",
    deposit: { amount: from.depositAmount, dueDate: "2026-11-12" },
    quoteId: "q1",
  });
  assert.equal(input.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100, quote().total);
  assert.equal(input.quoteId, "q1");
});

test("making the invoice marks the quote invoiced; deleting that draft invoice hands it back", () => {
  const accepted = quote({ status: "accepted", acceptedAt: NOW, acceptedName: "Jo Rivera" });
  const invoiced = quoteInvoiced(accepted, "inv9", NOW);
  assert.equal(invoiced.status, "invoiced");
  assert.equal(invoiced.invoiceId, "inv9");
  assert.equal(quoteReleased(invoiced, NOW).status, "accepted");
  assert.equal(quoteReleased(invoiced, NOW).invoiceId, null);
  // Turned into an invoice without an answer: back to sent (or draft, never shared).
  assert.equal(quoteReleased(quoteInvoiced(quote(), "inv9", NOW), NOW).status, "sent");
  assert.equal(quoteReleased(quoteInvoiced(quote({ status: "draft", shareToken: null }), "inv9", NOW), NOW).status, "draft");
});

test("Needs you lists accepted quotes until their invoice is made", () => {
  const accepted = quote({ id: "a", status: "accepted", acceptedAt: NOW });
  const list = [accepted, quote({ id: "b" }), quoteInvoiced(quote({ id: "c", status: "accepted", acceptedAt: NOW }), "inv", NOW)];
  assert.deepEqual(quotesToInvoice(list).map((q) => q.id), ["a"]);
});

test("a quote is never money owed: it can't be read as an invoice, and invoices default to no quote", () => {
  assert.equal(InvoiceSchema.safeParse(quote()).success, false);
  const invoice = InvoiceSchema.parse({
    id: "i1",
    workspaceId: "ws",
    number: "0001",
    clientName: "Jo",
    lines: [{ description: "Work", quantity: 1, rate: 100, amount: 100, category: "services" }],
    total: 100,
    issueDate: TODAY,
    dueDate: TODAY,
    status: "sent",
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(invoice.quoteId, null);
});

test("the owner's push says who answered and what", () => {
  assert.deepEqual(quoteAnswerNotificationText(quote(), "accept"), {
    title: "Jo Rivera accepted your quote",
    body: "Q-0003 · $1,020.50 — turn it into an invoice",
  });
  const declined = quoteAnswerNotificationText(quote({ status: "declined", declineNote: "Too pricey" }), "decline");
  assert.equal(declined.title, "Jo Rivera declined your quote");
  assert.match(declined.body, /Too pricey/);
});

console.log("client's page and email");

const PATH = "/q/TOKEN1234567890abcdef/answer";

test("an open quote shows Accept (with a name) and Decline, posting to its answer path", () => {
  const html = renderPublicQuotePage(quote(), settings, TODAY, { answerPath: PATH });
  assert.match(html, /Quote Q-0003/);
  assert.match(html, /name="answer" value="accept"/);
  assert.match(html, /name="name" required/);
  assert.match(html, /name="answer" value="decline"/);
  assert.match(html, new RegExp(`action="${PATH}"`));
  assert.match(html, /Accept quote · \$1,020\.50/);
  assert.match(html, /\$300\.00 deposit/);
});

test("expired, declined, withdrawn and accepted quotes show why — and no buttons", () => {
  const cases = [
    [{ validUntil: "2026-11-01" }, /expired on Nov 1, 2026/],
    [{ status: "declined", declinedAt: NOW }, /was declined/],
    [{ status: "withdrawn" }, /was withdrawn/],
    [{ status: "accepted", acceptedAt: NOW, acceptedName: "Jo R" }, /Accepted by Jo R on Nov 5, 2026/],
    [{ status: "invoiced", acceptedAt: NOW, acceptedName: "Jo R", invoiceId: "i" }, /Accepted by Jo R/],
  ];
  for (const [extra, banner] of cases) {
    const html = renderPublicQuotePage(quote(extra), settings, TODAY, { answerPath: PATH });
    assert.match(html, banner);
    assert.doesNotMatch(html, /name="answer"/);
  }
});

test("a just-accepted quote thanks the client", () => {
  const html = renderPublicQuotePage(quote({ status: "accepted", acceptedAt: NOW, acceptedName: "Jo" }), settings, TODAY, {
    answerPath: PATH,
    justAnswered: true,
  });
  assert.match(html, /Thank you — you accepted this quote/);
});

test("everything typed is escaped on the page and in the email", () => {
  const nasty = quote({
    clientName: '"><script>alert(1)</script>',
    note: "<img src=x onerror=alert(1)>",
    lines: [{ description: "<b>Work</b>", quantity: 1, rate: 100, amount: 100, category: "services" }],
    deposit: null,
  });
  const html = renderPublicQuotePage(nasty, settings, TODAY, { answerPath: PATH, error: "<i>oops</i>" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>Work<\/b>/);
  assert.doesNotMatch(html, /<i>oops<\/i>/);
  assert.match(html, /Fresh &lt;Cuts&gt;/);
  const email = buildQuoteEmail({ quote: nasty, settings, link: "https://app.the521app.com/q/x", message: "<script>x</script>" });
  assert.doesNotMatch(email.html, /<script>x/);
  assert.match(email.subject, /^Quote Q-0003 from Fresh <Cuts> — \$100\.00$/);
});

test("the email gives the total, the date it's good until, and the link", () => {
  const email = buildQuoteEmail({ quote: quote(), settings, link: "https://app.the521app.com/q/x" });
  assert.match(email.text, /Total: \$1,020\.50/);
  assert.match(email.text, /Valid until: Dec 5, 2026/);
  assert.match(email.text, /View and accept the quote: https:\/\/app\.the521app\.com\/q\/x/);
  assert.match(email.html, /View &amp; accept quote/);
});

test("a bad link gets a plain not-found page", () => {
  assert.match(renderPublicQuoteNotFound(), /This quote link isn't valid/);
});

if (failures > 0) {
  console.error(`\n${failures} quote test(s) failed`);
  process.exit(1);
}
