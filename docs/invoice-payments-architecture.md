# Invoice Payments — Deposits, Partial Payments and Tips

Plan for moving invoices from "paid once, in full" to a **payment ledger**: one invoice per job, any number of payments against it, an optional deposit with its own due date, and tips that are known, not guessed. Five phases, built in order. Each phase ships on its own and leaves the app working.

## Product Context

A tattoo artist books an $800 piece and asks for a $100 deposit within 7 days. Today 521 can't express that: an invoice has one set of `paid*` fields, bank matching only looks for the full total, and Stripe Checkout always charges the whole amount.

After this work:

| Event | Invoice shows | Books |
|---|---|---|
| Invoice sent | "Deposit $100 due Oct 25 · $800 total" | nothing |
| Deposit paid (any method) | "Deposit paid · $700 due Nov 8" | $100 income entry, dated that day |
| Tattoo day: $700 + $140 tip | "Paid" | $700 service + $140 tip income entry, dated that day; Stripe's fee as an expense |
| Deposit never paid, artist cancels | "Cancelled · nothing paid" | nothing |
| Client no-shows after the deposit | "Closed · deposit kept" | the $100 stays income |

### Accounting rules this follows

- **Cash basis.** Each payment is income on the day the money arrived, as its own entry. A December deposit and a January balance land in the right tax years. The invoice itself is never income (unchanged from today).
- **Gross, not net.** Income is booked at the full amount the client paid, tip included. Processor fees are one Payment Processing Fees expense per payment. This matches the processor's 1099-K, which reports gross.
- **Tips are their own category.** `tips` already exists on entry income breakdowns (`shared/schemas/entry.ts`). A tip is never inferred from an overpayment without the user confirming it: Stripe carries it in metadata, a manual payment has a tip field, and a bank deposit asks.
- **Refunds stay separate entries** (`kind: "refund"`, negative, dated when the money went back), now tied to the specific payment they return.

### Behavior rules (decided)

- **A deposit unlocks the balance; a date doesn't.** Until the deposit is paid, the client can pay the deposit or the full amount, never "the balance". Once the deposit is paid, the balance is payable right away, even before its due date.
- **Paying more than what's due now is always allowed, up to the remaining total.** A client can skip the deposit and pay in full.
- **An unpaid deposit past its due date is the artist's call**, shown in Needs you as "Deposit overdue" with two actions: *Cancel booking* (void) or *Waive deposit* (full amount due by the final due date). Nothing unlocks automatically.
- **Tips only on the payment that finishes the invoice** (the balance or a full payment), never on a deposit.
- **Online payments come in three amounts only:** deposit, balance, or full. Arbitrary partial amounts are for manual and bank payments.

## Data Model

### `InvoicePayment` (new, in `shared/schemas/invoice.ts`)

```ts
InvoicePaymentSchema = z.object({
  // Stable key, also the Entry's clientMutationId suffix:
  //   online  → "stripe_<paymentIntentId>"
  //   bank    → "plaid_<plaidTransactionId>"
  //   manual  → "manual_<clientMutationId>"
  //   legacy  → "legacy" (converted from the old paid* fields)
  id: z.string(),
  // What the client was paying. "partial" is any other amount (manual/bank).
  purpose: z.enum(["deposit", "balance", "full", "partial"]),
  amount: z.number().positive(),          // applied to the invoice; excludes tip
  tipAmount: z.number().nonnegative().default(0),
  receivedOn: DateSchema,                  // YYYY-MM-DD the money arrived; the Entry's date
  via: z.enum(["bank_match", "manual", "online"]),
  method: InvoicePaidMethodSchema,         // card/zelle/check/... as today
  entryId: z.string().nullable(),          // null only between claim and booking
  plaidTransactionId: z.string().nullable().default(null),
  stripePaymentIntentId: z.string().nullable().default(null),
  checkoutSessionId: z.string().nullable().default(null),
  feeAmount: z.number().nonnegative().default(0),
  createdAt: z.string(),
})
```

`InvoiceRefundSchema` gains `paymentId: string` (which payment it returns). The refund cap becomes per payment: `amount + tipAmount − refunds on that payment − dispute hold`.

### Invoice fields

**Added:**
- `payments: InvoicePayment[]`, oldest first.
- `deposit: { amount, dueDate, waivedAt: string | null } | null`. The amount must be below `total`, and `dueDate` must be on or before `dueDate`.
- `pendingPayment: { checkoutSessionId, purpose, amount, tipAmount, startedAt } | null`, replacing `pendingPaymentAt`. This is a bank transfer started through Stripe and still clearing.
- `openCheckout: { sessionId, purpose, amountCents, tipCents } | null`, replacing `checkoutSessionId`. This is the one Checkout session the client may have open.
- `closedAt: string | null`.
- **Derived, but stored so Firestore can query on them** (rewritten on every payment change, checked against `payments` by `superRefine`):
  - `amountPaid`: the sum of `payments[].amount`, tips excluded.
  - `paymentEntryIds: string[]`, for `array-contains` lookups when an entry is deleted.
  - `paymentPlaidTransactionIds: string[]`, for undoing a deposit match.
  - `paymentIntentIds: string[]`, for Stripe refunds and disputes.
  - `lastManualPaymentOn: string | null`, for the "already recorded?" deposit check.

**Status:** `draft | sent | paid | void | closed`.
- `sent` covers every open invoice, including a partly paid one, so existing `status == "sent"` queries keep working.
- `paid` means `amountPaid == total`.
- `closed` is new: ended early with money kept (a forfeited deposit). `void` stays "ended, nothing kept". A void invoice can't have payments.

**Removed after Phase 5 cleanup:** `paidAt`, `paidVia`, `paidMethod`, `paidEntryId`, `paidPlaidTransactionId`, `paidStripePaymentIntentId`, `paidFeeAmount`, `pendingPaymentAt`, `checkoutSessionId`.

### Shared helpers (new, in `shared/invoicePayments.ts`)

All pure functions, used by the backend, the app, the PDF, the email and the public page. Nothing else computes these numbers.

- `invoiceAmountPaid(invoice)` and `invoiceBalanceDue(invoice)`: `total − amountPaid`.
- `invoiceDueNow(invoice, today)`: `{ purpose: "deposit" | "balance", amount, dueDate }`, or null.
- `invoicePaymentOptions(invoice)`: what the client page offers, e.g. `[{ purpose: "deposit", amount: 100 }, { purpose: "full", amount: 800 }]`.
- `invoicePaymentBreakdown(invoice, amount, tipAmount, method)`: one Entry income breakdown. `amount` is spread across the invoice's line categories in proportion, with the remainder on the last category so it adds up to the cent. The tip goes on `tips`.
- `invoicePaymentRefundable(invoice, paymentId)`.
- `invoiceDisplayStatus`, extended with "Deposit due", "Deposit overdue", "Deposit paid · $X due", "Partly paid · $X due", "Closed · deposit kept".

### The payment engine (new, in `backend/functions/src/services/invoicePaymentEngine.ts`)

One function every path goes through, generalizing today's three near-identical "claim, then book, then revert on failure" blocks:

```
applyInvoicePayment(workspaceId, uid, invoiceId, {
  key, purpose, amount, tipAmount, receivedOn, via, method,
  plaidTransactionId?, stripePaymentIntentId?, checkoutSessionId?, feeAmount, feeVendor?
}) → { invoice, payment, entryId, feeExpenseId? }
```

1. **Claim** (one transaction):
   - Reject if the invoice is void, closed or paid, if `amount > balanceDue`, or if the `key` already exists (that means a retry: return the existing payment instead).
   - Append the payment with `entryId: null`, then recompute `amountPaid`, the index arrays and `status`.
2. **Book the Entry**, with `clientMutationId = invoice_<id>_<key>`, so a retry finds the same entry. Then the fee Expense, if `feeAmount > 0`.
3. **Attach** `entryId` to the payment.
4. **On failure:** remove the payment, but only while it's still unbooked, then rethrow.

Removing a payment (`removeInvoicePayment`) is the inverse, used when an entry is deleted.

## Phases

### Phase 1 — Ledger foundation (no visible change)

Goal: the new data shape exists and everything reads through it, while every write path still behaves exactly as today.

1. **Schema.** Add `InvoicePaymentSchema`, the new invoice fields and `closed` status to `shared/schemas/invoice.ts`. `InvoiceSchema` becomes `z.preprocess(deriveLedgerFromLegacy, …)`.
   - A paid invoice becomes one payment: `id: "legacy"`, `purpose: "full"`, built from the `paid*` fields.
   - `pendingPaymentAt` and `checkoutSessionId` map to `pendingPayment` and `openCheckout`.
   - Refunds get `paymentId` pointing at that payment.
2. **The old fields stay the source of truth; the ledger is recomputed from them on every parse.**
   - Every write path in this phase is unchanged and still sets the `paid*` fields.
   - Writes that save the whole invoice also store the recomputed ledger.
   - Writes that patch only a few old fields leave the stored ledger stale. That's harmless: every read recomputes it, nothing queries it in this phase, and the backfill refreshes it.
   - The one stored value kept on recompute is a legacy payment's `receivedOn` when its entry is unchanged, so the backfill's correction sticks.
   - Phase 2 flips this in one place: `payments` becomes the source, written by the payment engine.
3. **Shared helpers.** `shared/invoicePayments.ts`, tested in `scripts/test-invoice-payments.cjs` (`npm run test:invoice-payments`).
4. **Readers switched to the helpers:**
   - `shared/invoiceDisplay.ts`, `invoiceEmail.ts`, `invoicePublicPage.ts` and `invoiceMatching.ts`'s candidate selection
   - `frontend/lib/invoicePdf.ts`
   - `components/invoices/invoice-money.tsx`, `invoice-ui.tsx`, `invoice-match-card.tsx`, `refund-sheet.tsx`, `send-invoice-sheet.tsx`
   - the invoices list and view pages, `needs-you-panel.tsx`, and the optimistic updates in `lib/domain/invoiceService.ts`
   - The list's "paid this month" now sums payments received that month (cash basis), not invoices whose paid date falls in it.
   - The backend services still read the old fields until Phase 2 moves them onto the engine.
5. **Backfill script** (`scripts/backfill-invoice-payments.cjs`).
   - Dry run by default; `--write` to apply; `--workspace <id>` to limit it.
   - Writes only the ledger fields, never the `paid*` fields or `updatedAt`, and is safe to run more than once.
   - Corrects each payment's `receivedOn` from its entry's own date. An online payment's `paidAt` is a UTC instant, while the entry is dated in the workspace's time zone.
   - **Run it again right before Phase 2's flip**, so payments written during Phase 1 are stored too.
6. **Firestore indexes:** none needed. The backfill's collection-group read has no filter, and later lookups are single-field `array-contains`.

**Done when:** all invoices are backfilled, every reader uses the helpers, the app looks identical, and the tests cover the legacy → ledger conversion for draft, sent, paid (each `paidVia`), refunded, disputed, ACH-pending and void invoices.

**Prerequisite:** land the in-progress optimistic-update work (`frontend/lib/domain/invoiceService.ts` and the edited invoice sheets and pages) first, so Phase 1 builds on it instead of conflicting with it.

### Phase 2 — Recording payments: partial payments, tips, per-payment undo

Goal: the payment engine is the only way money gets attached to an invoice, and manual payments support any amount plus a tip.

**Built, with the Phase 5 cleanup folded in.** No real invoices existed yet (only test ones), so instead of carrying two data shapes until Phase 5:
- The `paid*`, `pendingPaymentAt` and `checkoutSessionId` fields and `deriveLedgerFromLegacy` are gone, and `payments` is the source of truth.
- The schema enforces the ledger rules:
  - the ledger fields must match `payments`;
  - `paid` means the payments cover the total, while `sent`/`draft` means they don't;
  - draft and void invoices have no payments;
  - payment ids are unique.
- There's no compatibility shape for `mark_paid`.
- The few test invoices saved in the old shape were deleted, not converted.
- All three payment paths (manual, bank match and Stripe) moved onto the engine in this phase, because the fields they wrote no longer exist. Phases 4 and 5 add deposit/tip targets and the payment choice on top of it.

1. **Engine.** `backend/functions/src/services/invoicePaymentEngine.ts`, with four parts:
   - `claimInvoicePayments`: all-or-nothing across invoices; it rejects with `PaymentRejectedError` (missing, not open, clearing, over balance).
   - `bookPaymentEntry`, then `attachPaymentEntry`.
   - `releasePaymentClaims`.
   - `applyInvoicePayment`, which does the claim, book and attach in one call.

   The pure ledger operations it uses (`invoiceWithPayments`, `invoiceLedgerFields`, `invoicePaymentPurposeFor`) live in `shared/invoicePayments.ts`, so the app's instant updates apply payments the same way.
2. **Mark paid becomes "Record payment".** The `InvoiceStatusActionSchema` `mark_paid` action becomes `record_payment { amount, tipAmount, paidDate, paymentMethod, clientMutationId }`.
   - `amount` is at most the balance due. It defaults to the amount due now, or the balance.
   - `purpose` is worked out on the server: it's `deposit` when it equals an unpaid deposit and the deposit hasn't been waived, `full`/`balance` when it clears the invoice, and `partial` otherwise.
3. **Per-payment undo.** `entriesService.deleteEntry`:
   - Finds the payment by `paymentEntryIds array-contains` and removes just that payment.
   - The invoice goes back to `sent` when a balance remains.
   - Blocked when that payment has refunds or a dispute, or came through Stripe (same rules as today, now per payment).
   - Bank-matched payments still undo their whole deposit match: `undoInvoiceDepositMatch` removes `plaid_<txn>` payments found by `paymentPlaidTransactionIds`.
   - A removed manual payment returns any "already recorded" deposit to review.
4. **Refunds per payment.** The refund action takes `paymentId`. The cap is `invoicePaymentRefundable`. `bookRefundEntry` spreads a refund across that payment's own categories, tip included, in proportion. `forgetRefundForDeletedEntry` and the refund-payment Plaid linking from commit e67dc1f carry over unchanged.
5. **Edit rules** (`updateInvoice`):
   - The total can't drop below `amountPaid`.
   - Lines can still be edited while partly paid, since future payments use the new categories and booked entries never change.
   - Void is blocked once anything is paid; use *Close* instead.
6. **Close action.** A new `close` action is allowed when payments exist and a balance remains. It sets `status: "closed"` and `closedAt`, keeps every entry, and expires any open checkout.
7. **App.**
   - The mark-paid sheet becomes a *Record payment* sheet: amount (pre-filled), optional tip, date, method.
   - The invoice view gains a **Payments** list (date, method, amount, tip, fee, refunds), with refund launched from a specific payment.
   - The list and client pages show "Partly paid · $X due".
   - Route the new action through `frontend/lib/domain/invoiceService.ts`, server-confirmed like refunds today.

**Done when:** an invoice can take several manual payments with tips. Each payment is its own entry with the right categories, deleting one payment's entry reopens just that amount, and refunds can't exceed what a payment brought in.

### Phase 3 — Deposits

Goal: an artist can require a deposit, and every surface understands it.

**Built and tested end to end.** The test ran in the local app against real data, with this branch's functions running in the Firebase functions emulator. It covered:
- the settings default pre-filling a 25% deposit;
- the client page and PDF asking for the deposit first;
- recording the deposit, which gives "Deposit paid · $600 due" and locks the deposit;
- an overdue deposit appearing in Needs you, then waived on one invoice and cancelled (voided) on another;
- the server refusing to change or waive a paid deposit, to void a paid invoice, or to take an overpayment.

One change from the plan: the client page's Pay button pays the deposit while one is owed, rather than the full balance. Checkout already charges the first payment option, which is the deposit. `invoiceDueNow` counts drafts too, so a draft's preview and PDF show the deposit; callers that mean "owed now" check that the status is `sent`.

1. **API.** `InvoiceCreateInputSchema` and `InvoicePatchSchema` accept `deposit: { amount, dueDate } | null`.
   - Validation: `0 < amount < total`, and the deposit's due date is between the issue date and the invoice due date.
   - The deposit is locked once it's paid.
   - The total can't drop to the deposit amount or below while the deposit is unpaid.
2. **Settings.** `InvoiceSettingsSchema` gains `defaultDeposit: { type: "none" | "fixed" | "percent", value, dueInDays }`, which pre-fills new invoices (like `defaultTerms`).
3. **Waive action.** Sets `deposit.waivedAt`. The full amount is then due by the invoice due date. Allowed only while the deposit is unpaid.
4. **Status and display.** `invoiceDueNow` and `invoiceDisplayStatus` handle deposit due, deposit overdue, waived and paid. The overdue filter on the list counts an overdue deposit too.
5. **Client-facing surfaces** (no online payment change yet):
   - The public page, PDF and email show "Deposit due $100 by Oct 25" above "Total $800", and after payment, "Paid so far $100 · Balance due $700".
   - The Pay button keeps paying the full balance until Phase 5.
   - Manual and bank payments of the deposit amount are already recognized as deposits through the engine.
6. **Needs you.** A "Deposit overdue" row per invoice, with the client, amount and days late. It links to the invoice, where **Waive deposit** and **Cancel booking** (void, allowed because nothing is paid) sit at the top. The overdue-invoices row skips invoices whose problem is the deposit.
7. **App form.** A deposit toggle with amount (or %) and due date on the invoice form, pre-filled from settings, and a section for it in Invoice Settings.

**Done when:** an invoice with a deposit moves through deposit due → deposit paid → paid, or deposit overdue → waived or cancelled, with correct wording on every screen, the PDF, the email and the public page.

### Phase 4 — Bank matching for deposits, balances and tips

Goal: a Plaid deposit can be recognized as a deposit payment, a balance payment, a full payment, or a balance plus tip.

**Built and tested.**
- Targets come from `invoicePaymentOptions` (`openInvoiceTargets`). A target is an `InvoiceMatchCandidate` whose `total` is the amount it would pay, plus a `purpose`. Groups never use two targets of one invoice.
- The tip tier (`with_tip`) is opt-in (`pickPaidInvoices(…, { tips: true })`), and only the open-invoice lookup turns it on.
- "Already recorded" matches each recent hand-recorded payment, tip included (`manualPaymentTargets`), found through `lastManualPaymentOn`.
- **End-to-end test:** the backend matcher ran against real invoices on simulated deposits.
  - $690 became a $600 balance + $90 tip, booked as $600 services + $90 tips.
  - $500 paid an invoice in full; deleting its entry reopened the invoice and returned the deposit to review.
  - $200 was recognized as a deposit already recorded by hand.
- Not run end to end: a deposit arriving net of processor fees, since it needs a processor-named deposit. It's covered by the unit tests.

1. **Match targets.** In `shared/invoiceMatching.ts`, each open invoice offers targets instead of one `total`:
   - **Deposit unpaid:** the deposit amount and the full balance.
   - **Otherwise:** the balance.
   - **Combined tier (2–3 invoices):** uses each invoice's amount due now.
   - **Net-of-fees tier:** unchanged rules, per target.
2. **Tip tier.** This is new and runs last.
   - **What it matches:** one invoice, balance or full target, a deposit above the target by no more than 50% of it, and not a processor deposit. A processor shortfall is a fee, and a processor overage is ambiguous.
   - **What it offers:** "Balance $700 + $140 tip?" The user confirms, and can edit the tip down to zero, which turns the extra into a partial overpayment the card refuses.
3. **Refs carry the split.** `PlaidInvoiceRefSchema` gains `purpose`, `amount` (applied) and `tipAmount`, so the card says exactly what it will book. `resolveChosenInvoiceGroup` and `invoiceGroupFee` work on applied amounts.
4. **Confirm through the engine.** `confirmInvoicePayment` calls `applyInvoicePayment` per invoice, with `key: plaid_<txn>`, the fee split by `allocateInvoiceFee`, and `receivedOn: pending.date`.
5. **Undo adapted.** `undoInvoiceDepositMatch` finds payments by `paymentPlaidTransactionIds array-contains`, removes just those payments, deletes their entries and the fee, and returns the deposit to review.
6. **"Already recorded" adapted.** Manual payments are matched on `lastManualPaymentOn`, against each manual payment's own amount, not the invoice total.
7. **Review card.** `invoice-match-card.tsx` shows the purpose ("Deposit for Invoice #0012"), tip lines, and the remaining balance after confirming.
8. **Tests.** Deposit-only, full-instead-of-deposit, balance after deposit, balance + tip, tip cap, processor overage rejected, combined deposits across clients, already-recorded partials, and undo.

**Done when:** each payment of the tattoo example (deposit and balance + tip), arriving as separate bank deposits, gets suggested, confirmed and undone correctly.

### Phase 5 — Online payments: deposit / balance / full, tip picker, cleanup

Goal: the client pays the right amount online, picks a tip on 521's page, and 521 books it from Stripe's own data.

**Built.** Several pieces landed in Phase 2: the webhook booking through the engine, metadata on sessions, per-payment refunds and disputes, and clearing bank transfers per payment. This phase added:
- **The client page:**
  - A choice between the deposit and everything (or the balance alone).
  - A tip picker (no tip / 15 / 20 / 25% / custom), only on a payment that finishes the invoice.
  - A small script that keeps the Pay button's amount current.
- **`invoiceCheckoutAmounts`**, shared and tested, which works out the session's amounts from the invoice and the client's choice:
  - The amount never comes from the request.
  - Tips are at most 100% of the payment and never go on a deposit.
  - Anything malformed counts as no tip.
- **A separate "Tip" line item** in Checkout. A different choice expires the client's earlier open session.
- **Settings:** `offerTips` ("Ask for a tip when clients pay online"), **off by default**, so businesses where a tip prompt doesn't fit never see one.
- **The email's "Pay now"** opens the invoice page. A GET of `/i/{token}/pay` redirects there.
- **The failed bank-transfer notification** says whether it was the deposit, and how much.

**Not tested end to end with real Stripe:** the project's Stripe key is live, so real Checkout would make real charges. The amounts, page and form are covered by unit tests and a browser check of the real page. A Stripe end-to-end test needs:
- a test-mode secret key, given only to the local emulator (e.g. `backend/functions/.secret.local`);
- a test-mode connected account on a workspace;
- the Stripe CLI forwarding webhooks to the emulator.

1. **Public page** (`shared/invoicePublicPage.ts`, still server-rendered, no new script):
   - **Payment choice:** radio buttons for the options in `invoicePaymentOptions` (deposit or full; or balance).
   - **Tip picker, when the choice finishes the invoice:** 15% / 20% / 25% / custom / no tip. The percentages are of the amount being paid.
   - The form posts `purpose` and `tip` (a preset or custom cents) to `/i/{token}/pay`. The CSP's `form-action` is unchanged.
2. **Email "Pay now"** links to the page, not straight to Stripe, since the client has to choose. Mail scanners opening the link then can't start a checkout.
3. **Starting Checkout** (`startInvoiceCheckout`):
   - **The server recomputes everything.** The amount comes from `invoicePaymentOptions` for the posted `purpose`, never from the request. The tip is validated: whole cents, at most 100% of the amount, only on a finishing payment.
   - **Session contents:** line items for the amount (one line per invoice line for a full payment; a single "Deposit — Invoice #0012" or "Balance — Invoice #0012" line otherwise) plus a separate **"Tip"** line.
   - **Metadata** on the session and the payment intent: `workspaceId`, `invoiceId`, `purpose`, `amountCents`, `tipCents`.
   - **One open session per invoice** (`openCheckout`). It's reused when the purpose and amounts match, and the old one is expired when the client picks differently. The idempotency key includes purpose and tip.
4. **Webhook booking** (`bookPaidSession`):
   - Reads `purpose`, `amountCents` and `tipCents` from metadata and checks they add up to `amount_received`. A mismatch is logged and booked as all service income.
   - Calls `applyInvoicePayment` with `key: stripe_<paymentIntentId>` and Stripe's actual fee from the balance transaction.
   - If the invoice can't take the payment (already paid by another method, closed, void, or the amount is now above the balance due), the payment is refunded automatically, as duplicates are today.
5. **ACH per payment.** `pendingPayment` holds the purpose, amount and tip while it clears. Success books through the engine. Failure clears it, reopens that option and notifies the user (wording now says which payment failed).
6. **Refunds and disputes by payment intent.** `invoiceForPayment` looks up `paymentIntentIds array-contains`. Refunds and disputes attach to that payment. Stripe-dashboard refunds still arrive through `charge.refunded`. Payouts and `stripePayouts` are unchanged: a payout is a lump of many payments either way.
7. **Cleanup.** Done in Phase 2. The old test invoices were deleted rather than converted, and the converter script was removed.
8. **Tests.** Session amounts for each purpose, tip validation and caps, metadata round trip, the mismatch fallback, duplicate auto-refund, ACH clear and fail per payment, and refund or dispute on the second of two online payments.

**Done when:** in Stripe test mode, the tattoo example paid as a deposit online, then balance + 20% tip online, books $100 service, then $700 service + $140 tip, with two fee expenses. The payouts are hidden from bank review, and refunding the tip alone works.

## Cross-Cutting

- **Idempotency.** Every booking keys off the payment `key`: entry `invoice_<id>_<key>`, fee `<key>_fee`, refund `refund_<refundKey>`. Webhook retries, double taps and Plaid re-syncs book once, as today.
- **Transactions.** The claim step holds the invoice in one Firestore transaction, so a manual payment, a bank confirm and a Stripe webhook racing on the same invoice can't overpay it. The loser gets a conflict (manual or bank) or an automatic refund (Stripe).
- **iOS and Android.** The app is a Capacitor wrapper (`frontend/`), so the UI ships with the web build. Invoicing hadn't shipped to any build when the ledger replaced the single-payment fields, so no compatibility layer was kept.
- **Reports.** Tips land in the existing `tips` category, so the income streams and P&L show them without changes. Verify in Phase 2.
- **Out of scope:** automatic payment reminders to clients (an outward-facing email; could come later as a user-triggered "Send reminder"), installment schedules beyond deposit + balance, and accrual-basis "unearned revenue" accounting.
