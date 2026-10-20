import { randomBytes } from "node:crypto"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import {
  InvoiceCreateInputSchema,
  InvoicePatchSchema,
  InvoiceSchema,
  InvoiceSettingsPatchSchema,
  InvoiceSettingsSchema,
  InvoiceStatusActionSchema,
  invoiceTotalFromLines,
  type InvoicePatch,
  type InvoiceSettings,
  type InvoiceStatusAction,
  type InvoiceType,
} from "@shared/schemas/invoice"
import type { PlaidInvoiceMatch } from "@shared/schemas/plaidPendingTransaction"
import {
  manualPaymentTargets,
  openInvoiceTargets,
  pickPaidInvoices,
  MANUAL_PAID_LOOKBACK_DAYS,
  REFUND_PAYMENT_LOOKAHEAD_DAYS,
  matchInvoiceRefundPayment,
  selectUnmatchedManualRefunds,
  type InvoiceMatchDeposit,
  type RefundMatchPayment,
  type RefundPaymentCandidate,
} from "@shared/invoiceMatching"
import { publicInvoiceUrl } from "@shared/invoiceDisplay"
import { invoiceDepositOutstanding, invoicePaymentPurposeFor } from "@shared/invoicePayments"

export function invoicesCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("invoices")
}

function parseInvoices(snap: FirebaseFirestore.QuerySnapshot): InvoiceType[] {
  const invoices: InvoiceType[] = []
  for (const doc of snap.docs) {
    const parsed = InvoiceSchema.safeParse(doc.data())
    if (parsed.success) invoices.push(parsed.data)
    else console.error("invoicesService: skipping unparseable invoice", doc.id, parsed.error.issues)
  }
  return invoices
}

function isoDaysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString()
}

// The invoice(s) an incoming deposit most likely pays — open invoices
// first; failing that, invoices marked paid by hand recently, whose money
// this deposit may be (flagged alreadyPaid). Single-field queries only, so
// no composite index is needed.
export async function findInvoiceMatchForDeposit(
  workspaceId: string,
  deposit: InvoiceMatchDeposit
): Promise<PlaidInvoiceMatch | null> {
  // Open invoices, each matched on what it can be paid now: its deposit or
  // everything, or what's left — with a tip allowed on a final payment.
  const openSnap = await invoicesCol(workspaceId).where("status", "==", "sent").get()
  const openMatch = pickPaidInvoices(deposit, openInvoiceTargets(parseInvoices(openSnap), deposit.date), { tips: true })
  if (openMatch) return openMatch

  // Payments recorded by hand lately, each on what it brought in.
  const recentlyPaidSnap = await invoicesCol(workspaceId)
    .where("lastManualPaymentOn", ">=", isoDaysBefore(deposit.date, MANUAL_PAID_LOOKBACK_DAYS + 1).slice(0, 10))
    .get()
  const paidMatch = pickPaidInvoices(deposit, manualPaymentTargets(parseInvoices(recentlyPaidSnap), deposit.date))
  return paidMatch ? { ...paidMatch, alreadyPaid: true } : null
}

// The refund the user sent a client by hand that an outgoing bank payment
// is, if any (shared/invoiceMatching.ts). A refund is recorded on the day
// it's entered, which bumps the invoice's updatedAt, so recently updated
// invoices are the only ones that can hold it.
export async function findInvoiceRefundForPayment(
  workspaceId: string,
  payment: RefundMatchPayment & { plaidTransactionId: string }
): Promise<RefundPaymentCandidate | null> {
  const snap = await invoicesCol(workspaceId)
    .where("updatedAt", ">=", isoDaysBefore(payment.date, REFUND_PAYMENT_LOOKAHEAD_DAYS + 1))
    .get()
  return matchInvoiceRefundPayment(payment, selectUnmatchedManualRefunds(parseInvoices(snap), payment.plaidTransactionId))
}

// Ties a refund to the payment that sent it. False when the refund is gone
// or another payment already holds it. Inside a caller's transaction when
// one is given (its reads must come first, so this only reads).
export async function readRefundClaim(
  txn: FirebaseFirestore.Transaction,
  workspaceId: string,
  match: { invoiceId: string; refundId: string },
  plaidTransactionId: string
): Promise<{ ref: FirebaseFirestore.DocumentReference; refunds: InvoiceType["refunds"] } | null> {
  const ref = invoicesCol(workspaceId).doc(match.invoiceId)
  const snap = await txn.get(ref)
  const parsed = InvoiceSchema.safeParse(snap.data())
  if (!parsed.success) return null
  const refund = parsed.data.refunds.find((r) => r.id === match.refundId)
  if (!refund || (refund.plaidTransactionId && refund.plaidTransactionId !== plaidTransactionId)) return null
  return {
    ref,
    refunds: parsed.data.refunds.map((r) => (r.id === match.refundId ? { ...r, plaidTransactionId } : r)),
  }
}

export async function claimRefundForPayment(
  workspaceId: string,
  match: { invoiceId: string; refundId: string },
  plaidTransactionId: string
): Promise<boolean> {
  return db.runTransaction(async (txn) => {
    const claim = await readRefundClaim(txn, workspaceId, match, plaidTransactionId)
    if (!claim) return false
    txn.set(claim.ref, { refunds: claim.refunds }, { merge: true })
    return true
  })
}

// ---------------------------------------------------------------------------
// CRUD and status changes
//
// Lifecycle: draft → sent → paid, following the payments (a partly paid
// invoice stays sent). Void ends one with nothing paid; close ends one early
// and keeps what was paid. A paid invoice can't be voided or edited — its
// income is booked; deleting a payment's Entry takes that payment off
// (entriesService.deleteEntry).
// ---------------------------------------------------------------------------

function counterDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("counters").doc("invoices")
}

function formatInvoiceNumber(n: number): string {
  return String(n).padStart(4, "0")
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

async function assertIndependentWorkspace(workspaceId: string): Promise<void> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  if (snap.data()?.type !== "independent") {
    throw new BadRequestError("Invoices are only available in an independent workspace.")
  }
}

export async function listInvoices(workspaceId: string, uid: string): Promise<InvoiceType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await invoicesCol(workspaceId).get()
  return parseInvoices(snap).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
}

export async function createInvoice(workspaceId: string, uid: string, raw: unknown): Promise<InvoiceType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoiceCreateInputSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid invoice", formatIssues(parsed.error))
  const input = parsed.data
  await assertIndependentWorkspace(workspaceId)
  const settings = await readInvoiceSettings(workspaceId)
  const note = input.note ?? settings.defaultNote
  // The policies the client gets with this invoice, kept with it.
  const policies = input.policies ?? settings.defaultPolicies

  const ref = input.clientMutationId
    ? invoicesCol(workspaceId).doc(`cmid_${input.clientMutationId}`)
    : invoicesCol(workspaceId).doc()

  // The number is taken in the same transaction as the write, so two
  // invoices created at once can't share one, and a retry of the same
  // clientMutationId returns the invoice it already made.
  return db.runTransaction(async (txn) => {
    const [existingSnap, counterSnap] = await txn.getAll(ref, counterDoc(workspaceId))
    if (existingSnap.exists) return InvoiceSchema.parse(existingSnap.data())
    const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0)
    const nowIso = new Date().toISOString()
    const invoice = InvoiceSchema.parse({
      id: ref.id,
      workspaceId,
      number: formatInvoiceNumber(lastNumber + 1),
      clientName: input.clientName,
      clientEmail: input.clientEmail || null,
      clientPhone: input.clientPhone || null,
      clientAddress: input.clientAddress || null,
      lines: input.lines,
      total: invoiceTotalFromLines(input.lines),
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      note,
      policies,
      deposit: input.deposit ? { ...input.deposit, waivedAt: null } : null,
      status: input.send ? "sent" : "draft",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.create(ref, invoice)
    txn.set(counterDoc(workspaceId), { lastNumber: lastNumber + 1, updatedAt: nowIso }, { merge: true })
    return invoice
  })
}

export async function updateInvoice(workspaceId: string, uid: string, invoiceId: string, raw: unknown): Promise<InvoiceType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoicePatchSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid invoice changes", formatIssues(parsed.error))
  const patch = parsed.data
  const ref = invoicesCol(workspaceId).doc(invoiceId)

  let staleSessionId: string | null = null
  const updated = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (current.status === "paid") throw new ConflictError("A paid invoice can't be edited.")
    if (current.status === "void" || current.status === "closed") throw new ConflictError(`A ${current.status} invoice can't be edited.`)
    if (current.pendingPayment) {
      throw new ConflictError("A bank payment for this invoice is still clearing — it can be edited if that payment fails.")
    }
    const lines = patch.lines ?? current.lines
    const deposit = nextDeposit(current, patch.deposit)
    const next = {
      ...current,
      ...patch,
      deposit,
      clientEmail: patch.clientEmail === undefined ? current.clientEmail : patch.clientEmail || null,
      clientPhone: patch.clientPhone === undefined ? current.clientPhone : patch.clientPhone || null,
      clientAddress: patch.clientAddress === undefined ? current.clientAddress : patch.clientAddress || null,
      lines,
      total: invoiceTotalFromLines(lines),
      updatedAt: new Date().toISOString(),
    }
    if (next.dueDate < next.issueDate) throw new BadRequestError("Due date can't be before the issue date.")
    if (deposit && Math.round(deposit.amount * 100) >= Math.round(next.total * 100)) {
      throw new BadRequestError("The deposit has to be less than the total.")
    }
    if (deposit && (deposit.dueDate < next.issueDate || deposit.dueDate > next.dueDate)) {
      throw new BadRequestError("The deposit has to be due between the invoice date and its due date.")
    }
    // Booked payments never change; the total just has to stay above them.
    if (current.amountPaid > 0 && Math.round(next.total * 100) <= Math.round(current.amountPaid * 100)) {
      throw new ConflictError(
        `${current.amountPaid.toFixed(2)} is already paid — the total has to stay above that. Record the rest as a payment instead.`
      )
    }
    // A client's open Checkout would charge the old total.
    const totalChanged = Math.round(next.total * 100) !== Math.round(current.total * 100)
    staleSessionId = totalChanged ? current.openCheckout?.sessionId ?? null : null
    const invoice = InvoiceSchema.parse(totalChanged ? { ...next, openCheckout: null } : next)
    txn.set(ref, invoice)
    return invoice
  })
  if (staleSessionId) await expireCheckoutSession(workspaceId, staleSessionId)
  return updated
}

// A patch's deposit, against what's already happened to it: once it's been
// paid or waived it's settled and can't change.
function nextDeposit(current: InvoiceType, requested: InvoicePatch["deposit"]): InvoiceType["deposit"] {
  if (requested === undefined) return current.deposit
  const settled =
    !!current.deposit && (current.deposit.waivedAt !== null || invoiceDepositOutstanding(current) === 0)
  if (settled) {
    const same =
      requested !== null &&
      Math.round(requested.amount * 100) === Math.round(current.deposit!.amount * 100) &&
      requested.dueDate === current.deposit!.dueDate
    if (same) return current.deposit
    throw new ConflictError(
      current.deposit!.waivedAt ? "The deposit was waived, so it can't be changed." : "The deposit is already paid, so it can't be changed."
    )
  }
  return requested ? { amount: requested.amount, dueDate: requested.dueDate, waivedAt: null } : null
}

// Drafts only — anything that was sent is kept and voided instead, so the
// numbering a client has seen never has holes.
export async function deleteInvoice(workspaceId: string, uid: string, invoiceId: string): Promise<{ deleted: boolean }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = invoicesCol(workspaceId).doc(invoiceId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return { deleted: false }
    const current = InvoiceSchema.parse(snap.data())
    if (current.status !== "draft") throw new ConflictError("Only a draft can be deleted — void a sent invoice instead.")
    txn.delete(ref)
    return { deleted: true }
  })
}

export async function updateInvoiceStatus(
  workspaceId: string,
  uid: string,
  invoiceId: string,
  raw: unknown
): Promise<{ invoice: InvoiceType; entryId?: string; shareUrl?: string }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoiceStatusActionSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid invoice action", formatIssues(parsed.error))
  const action = parsed.data
  const ref = invoicesCol(workspaceId).doc(invoiceId)

  if (action.action === "record_payment") {
    return recordManualPayment(workspaceId, uid, invoiceId, action)
  }
  if (action.action === "close") {
    return closeInvoice(workspaceId, ref)
  }
  if (action.action === "waive_deposit") {
    return waiveDeposit(workspaceId, ref)
  }
  if (action.action === "share") {
    return shareInvoice(workspaceId, ref)
  }
  if (action.action === "set_reminders") {
    return setRemindersPaused(ref, action.paused)
  }
  if (action.action === "email") {
    const { emailInvoice } = await import("./invoiceEmailService.js")
    return emailInvoice(workspaceId, ref, { to: action.to, message: action.message })
  }
  if (action.action === "refund") {
    const { refundInvoice } = await import("./refundsService.js")
    return { invoice: await refundInvoice(workspaceId, uid, invoiceId, action) }
  }

  let voidedSessionId: string | null = null
  const invoice = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    const target = action.action === "send" ? "sent" : "void"
    voidedSessionId = current.openCheckout?.sessionId ?? null
    // Repeating the same action (a client retry) is a no-op, not an error.
    if (current.status === target) return current
    if (action.action === "send" && current.status !== "draft") {
      throw new ConflictError(`A ${current.status} invoice can't be sent.`)
    }
    if (action.action === "void" && current.pendingPayment) {
      throw new ConflictError("A bank payment for this invoice is still clearing — void it if that payment fails.")
    }
    if (action.action === "void" && current.status === "paid") {
      throw new ConflictError("A paid invoice can't be voided — delete its income entry first, which reopens it.")
    }
    if (action.action === "void" && current.payments.length > 0) {
      throw new ConflictError("Part of this invoice is paid — close it instead, which keeps what was paid.")
    }
    if (action.action === "void" && current.status === "closed") {
      throw new ConflictError("A closed invoice can't be voided.")
    }
    const next = InvoiceSchema.parse({
      ...current,
      status: target,
      openCheckout: target === "void" ? null : current.openCheckout,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return next
  })
  // A voided invoice must not stay payable through an open Checkout.
  // (A payment that still slips through is refunded by the webhook.)
  if (action.action === "void" && voidedSessionId) await expireCheckoutSession(workspaceId, voidedSessionId)
  return { invoice }
}

// Paid outside the bank feed (cash, check, Venmo): any amount up to the
// balance, plus a tip, booked through the payment engine. The payment date
// is what the "already recorded?" check on later deposits keys off.
async function recordManualPayment(
  workspaceId: string,
  uid: string,
  invoiceId: string,
  action: Extract<InvoiceStatusAction, { action: "record_payment" }>
): Promise<{ invoice: InvoiceType; entryId: string }> {
  await assertIndependentWorkspace(workspaceId)
  const snap = await invoicesCol(workspaceId).doc(invoiceId).get()
  if (!snap.exists) throw new NotFoundError("Invoice not found")
  const current = InvoiceSchema.parse(snap.data())
  if (action.paidDate < current.issueDate) throw new BadRequestError("The payment date can't be before the issue date.")
  const { applyInvoicePayment } = await import("./invoicePaymentEngine.js")
  const { invoice, entryId } = await applyInvoicePayment(
    workspaceId,
    uid,
    {
      invoiceId,
      payment: {
        id: `manual_${action.clientMutationId}`,
        purpose: invoicePaymentPurposeFor(current, action.amount),
        amount: action.amount,
        tipAmount: action.tipAmount,
        receivedOn: action.paidDate,
        via: "manual",
        method: action.paymentMethod,
        plaidTransactionId: null,
        stripePaymentIntentId: null,
        checkoutSessionId: null,
        feeAmount: 0,
      },
    },
    { notes: [action.paymentMethod === "check" ? "Paid by check" : null] }
  )
  return { invoice, entryId }
}

// The deposit isn't needed after all: the whole amount is due by the
// invoice's due date. A client's open Checkout for the deposit is closed.
async function waiveDeposit(workspaceId: string, ref: FirebaseFirestore.DocumentReference): Promise<{ invoice: InvoiceType }> {
  let staleSessionId: string | null = null
  const invoice = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (!current.deposit) throw new ConflictError("This invoice has no deposit.")
    if (current.deposit.waivedAt) return current
    if (current.status !== "sent" && current.status !== "draft") {
      throw new ConflictError(`A ${current.status} invoice's deposit can't be waived.`)
    }
    if (invoiceDepositOutstanding(current) === 0) throw new ConflictError("The deposit is already paid.")
    if (current.pendingPayment) {
      throw new ConflictError("A bank payment for this invoice is still clearing — wait for it to settle.")
    }
    staleSessionId = current.openCheckout?.sessionId ?? null
    const nowIso = new Date().toISOString()
    const next = InvoiceSchema.parse({
      ...current,
      deposit: { ...current.deposit, waivedAt: nowIso },
      openCheckout: null,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return next
  })
  if (staleSessionId) await expireCheckoutSession(workspaceId, staleSessionId)
  return { invoice }
}

// Stops or resumes automatic reminders for one invoice. Any status: it only
// matters while the invoice is open.
async function setRemindersPaused(ref: FirebaseFirestore.DocumentReference, paused: boolean): Promise<{ invoice: InvoiceType }> {
  const invoice = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (current.remindersPaused === paused) return current
    const next = InvoiceSchema.parse({ ...current, remindersPaused: paused, updatedAt: new Date().toISOString() })
    txn.set(ref, next)
    return next
  })
  return { invoice }
}

// Ends a partly paid invoice early. What was paid stays income; nothing
// more is owed, so it's no longer payable or matched.
async function closeInvoice(workspaceId: string, ref: FirebaseFirestore.DocumentReference): Promise<{ invoice: InvoiceType }> {
  let staleSessionId: string | null = null
  const invoice = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (current.status === "closed") return current
    if (current.status !== "sent" || current.payments.length === 0) {
      throw new ConflictError("Only a partly paid invoice can be closed — void one with nothing paid.")
    }
    if (current.pendingPayment) {
      throw new ConflictError("A bank payment for this invoice is still clearing — close it once that settles.")
    }
    staleSessionId = current.openCheckout?.sessionId ?? null
    const nowIso = new Date().toISOString()
    const next = InvoiceSchema.parse({ ...current, status: "closed", closedAt: nowIso, openCheckout: null, updatedAt: nowIso })
    txn.set(ref, next)
    return next
  })
  if (staleSessionId) await expireCheckoutSession(workspaceId, staleSessionId)
  return { invoice }
}

// ---------------------------------------------------------------------------
// Invoice settings — workspaces/{workspaceId}/settings/invoicing
// ---------------------------------------------------------------------------

function invoiceSettingsDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("settings").doc("invoicing")
}

// Never fails a read over a bad saved value: falls back to defaults.
export async function readInvoiceSettings(workspaceId: string): Promise<InvoiceSettings> {
  const snap = await invoiceSettingsDoc(workspaceId).get()
  const parsed = InvoiceSettingsSchema.safeParse(snap.data() ?? {})
  if (parsed.success) return parsed.data
  console.error("invoicesService.readInvoiceSettings: invalid settings, using defaults", workspaceId, parsed.error.issues)
  return InvoiceSettingsSchema.parse({})
}

export async function getInvoiceSettings(workspaceId: string, uid: string): Promise<InvoiceSettings> {
  await assertWorkspaceMembership(workspaceId, uid)
  return readInvoiceSettings(workspaceId)
}

export async function saveInvoiceSettings(workspaceId: string, uid: string, raw: unknown): Promise<InvoiceSettings> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = InvoiceSettingsPatchSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid invoice settings", formatIssues(parsed.error))
  const ref = invoiceSettingsDoc(workspaceId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const current = InvoiceSettingsSchema.safeParse(snap.data() ?? {})
    const next = InvoiceSettingsSchema.parse({
      ...(current.success ? current.data : {}),
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return next
  })
}

// ---------------------------------------------------------------------------
// Share links
//
// invoiceShares/{token} → { workspaceId, invoiceId }: a top-level index so
// the public page can find an invoice from its link alone, without a
// collection-group query. The token is 128 random bits — the link is the
// only key. Clients can't read this collection (no Firestore rule allows
// it); only the publicInvoice function does.
// ---------------------------------------------------------------------------

function invoiceSharesCol() {
  return db.collection("invoiceShares")
}

export async function shareInvoice(
  workspaceId: string,
  ref: FirebaseFirestore.DocumentReference
): Promise<{ invoice: InvoiceType; shareUrl: string }> {
  const invoice = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (current.status === "void") throw new ConflictError("A void invoice can't be shared.")
    if (current.shareToken && current.status !== "draft") return current
    const nowIso = new Date().toISOString()
    const shareToken = current.shareToken ?? randomBytes(16).toString("base64url")
    if (!current.shareToken) {
      txn.create(invoiceSharesCol().doc(shareToken), { workspaceId, invoiceId: current.id, createdAt: nowIso })
    }
    const next = InvoiceSchema.parse({
      ...current,
      shareToken,
      sharedAt: current.sharedAt ?? nowIso,
      status: current.status === "draft" ? "sent" : current.status,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return next
  })
  return { invoice, shareUrl: publicInvoiceUrl(invoice.shareToken!) }
}

// The public page's lookup. Drafts never show (a link can't exist for one,
// but a shared invoice's own data is the check, not the index).
export async function findSharedInvoice(
  shareToken: string
): Promise<{ workspaceId: string; invoice: InvoiceType; settings: InvoiceSettings } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(shareToken)) return null
  const shareSnap = await invoiceSharesCol().doc(shareToken).get()
  const share = shareSnap.data() as { workspaceId?: string; invoiceId?: string } | undefined
  if (!share?.workspaceId || !share.invoiceId) return null
  const [invoiceSnap, settings] = await Promise.all([
    invoicesCol(share.workspaceId).doc(share.invoiceId).get(),
    readInvoiceSettings(share.workspaceId),
  ])
  const parsed = InvoiceSchema.safeParse(invoiceSnap.data())
  if (!parsed.success || parsed.data.shareToken !== shareToken || parsed.data.status === "draft") return null
  return { workspaceId: share.workspaceId, invoice: parsed.data, settings }
}

// Called from account/workspace deletion before the workspace tree is
// wiped — recursiveDelete doesn't reach this top-level index.
export async function deleteInvoiceSharesForWorkspace(workspaceId: string): Promise<void> {
  const snap = await invoiceSharesCol().where("workspaceId", "==", workspaceId).get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch()
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref)
    await batch.commit()
  }
}

// Best-effort: closes a client's open Stripe Checkout for an invoice whose
// total or balance changed, or that was voided or closed.
export async function expireCheckoutSession(workspaceId: string, sessionId: string): Promise<void> {
  try {
    const { getStripe, readPaymentAccount } = await import("./paymentAccountsService.js")
    const account = await readPaymentAccount(workspaceId)
    if (!account) return
    await getStripe().checkout.sessions.expire(sessionId, {}, { stripeAccount: account.stripeAccountId })
  } catch (error) {
    // Already completed or expired — nothing to close.
    console.warn("invoicesService.expireCheckoutSession: couldn't expire", sessionId, error instanceof Error ? error.message : error)
  }
}
