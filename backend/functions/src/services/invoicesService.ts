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
  type InvoicePaidMethod,
  type InvoiceSettings,
  type InvoiceType,
} from "@shared/schemas/invoice"
import type { PlaidInvoiceMatch } from "@shared/schemas/plaidPendingTransaction"
import {
  pickPaidInvoices,
  selectManuallyPaidInvoiceCandidates,
  selectOpenInvoiceCandidates,
  MANUAL_PAID_LOOKBACK_DAYS,
  invoiceCentsByCategory,
  invoiceIncomeBreakdown,
  type InvoiceMatchDeposit,
} from "@shared/invoiceMatching"
import { publicInvoiceUrl } from "@shared/invoiceDisplay"
import * as entriesSvc from "./entriesService"

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
  const openSnap = await invoicesCol(workspaceId).where("status", "==", "sent").get()
  const openMatch = pickPaidInvoices(deposit, selectOpenInvoiceCandidates(parseInvoices(openSnap), deposit.date))
  if (openMatch) return openMatch

  const recentlyPaidSnap = await invoicesCol(workspaceId)
    .where("paidAt", ">=", isoDaysBefore(deposit.date, MANUAL_PAID_LOOKBACK_DAYS + 1))
    .get()
  const paidMatch = pickPaidInvoices(
    deposit,
    selectManuallyPaidInvoiceCandidates(parseInvoices(recentlyPaidSnap), deposit.date)
  )
  return paidMatch ? { ...paidMatch, alreadyPaid: true } : null
}

// ---------------------------------------------------------------------------
// CRUD and status changes
//
// Lifecycle: draft → sent → paid, with void for a draft or sent invoice that
// won't be paid. A paid invoice can't be voided or edited — its income is
// already booked. Deleting that Entry reopens it instead (see
// reopenInvoicesForDeletedEntry).
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
  const note = input.note ?? (await readInvoiceSettings(workspaceId)).defaultNote

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
      lines: input.lines,
      total: invoiceTotalFromLines(input.lines),
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      note,
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
    if (current.status === "void") throw new ConflictError("A void invoice can't be edited.")
    if (current.pendingPaymentAt) {
      throw new ConflictError("A bank payment for this invoice is still clearing — it can be edited if that payment fails.")
    }
    const lines = patch.lines ?? current.lines
    const next = {
      ...current,
      ...patch,
      clientEmail: patch.clientEmail === undefined ? current.clientEmail : patch.clientEmail || null,
      clientPhone: patch.clientPhone === undefined ? current.clientPhone : patch.clientPhone || null,
      lines,
      total: invoiceTotalFromLines(lines),
      updatedAt: new Date().toISOString(),
    }
    if (next.dueDate < next.issueDate) throw new BadRequestError("Due date can't be before the issue date.")
    // A client's open Checkout would charge the old total.
    const totalChanged = Math.round(next.total * 100) !== Math.round(current.total * 100)
    staleSessionId = totalChanged ? current.checkoutSessionId : null
    const invoice = InvoiceSchema.parse(totalChanged ? { ...next, checkoutSessionId: null } : next)
    txn.set(ref, invoice)
    return invoice
  })
  if (staleSessionId) await expireCheckoutSession(workspaceId, staleSessionId)
  return updated
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

  if (action.action === "mark_paid") {
    return markInvoicePaidManually(workspaceId, uid, ref, action.paidDate, action.paymentMethod)
  }
  if (action.action === "share") {
    return shareInvoice(workspaceId, ref)
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
    voidedSessionId = current.checkoutSessionId
    // Repeating the same action (a client retry) is a no-op, not an error.
    if (current.status === target) return current
    if (action.action === "send" && current.status !== "draft") {
      throw new ConflictError(`A ${current.status} invoice can't be sent.`)
    }
    if (action.action === "void" && current.pendingPaymentAt) {
      throw new ConflictError("A bank payment for this invoice is still clearing — void it if that payment fails.")
    }
    if (action.action === "void" && current.status === "paid") {
      throw new ConflictError("A paid invoice can't be voided — delete its income entry first, which reopens it.")
    }
    const next = InvoiceSchema.parse({
      ...current,
      status: target,
      checkoutSessionId: target === "void" ? null : current.checkoutSessionId,
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

// Paid outside the bank feed. Same claim-then-book shape as
// confirmInvoicePayment in plaidService: the invoice flips to paid first so
// a matching deposit can't pay it too, then the Entry is booked, and the
// invoice is reopened if that fails. paidAt is the payment date, which is
// what the "already recorded?" check on later deposits keys off.
async function markInvoicePaidManually(
  workspaceId: string,
  uid: string,
  ref: FirebaseFirestore.DocumentReference,
  paidDate: string,
  paidMethod: InvoicePaidMethod
): Promise<{ invoice: InvoiceType; entryId: string }> {
  await assertIndependentWorkspace(workspaceId)
  const claim = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) throw new NotFoundError("Invoice not found")
    const current = InvoiceSchema.parse(snap.data())
    if (current.status === "paid") return { alreadyPaid: true as const, invoice: current, previousStatus: current.status }
    if (current.status === "void") throw new ConflictError("A void invoice can't be marked paid.")
    if (current.pendingPaymentAt) {
      throw new ConflictError("A bank payment for this invoice is still clearing — it's marked paid when it lands.")
    }
    if (paidDate < current.issueDate) throw new BadRequestError("The payment date can't be before the issue date.")
    const next = InvoiceSchema.parse({
      ...current,
      status: "paid",
      paidAt: `${paidDate}T12:00:00.000Z`,
      paidVia: "manual",
      paidMethod,
      paidPlaidTransactionId: null,
      paidFeeAmount: 0,
      updatedAt: new Date().toISOString(),
    })
    txn.set(ref, next)
    return { alreadyPaid: false as const, invoice: next, previousStatus: current.status }
  })
  if (claim.alreadyPaid) {
    if (claim.invoice.paidVia === "manual" && claim.invoice.paidEntryId) {
      return { invoice: claim.invoice, entryId: claim.invoice.paidEntryId }
    }
    throw new ConflictError(`Invoice #${claim.invoice.number} is already paid.`)
  }

  const invoice = claim.invoice
  // See InvoicePaidMethodSchema: a check is booked as named Other income.
  const paymentMethod = paidMethod === "check" ? "other" : paidMethod
  try {
    const customIncome =
      paymentMethod === "other"
        ? [...invoiceCentsByCategory(invoice.lines)].map(([category, cents]) => ({
            label: invoice.clientName,
            amount: cents / 100,
            category,
          }))
        : []
    const created = await entriesSvc.createEntry(workspaceId, uid, {
      workspace: "independent",
      date: paidDate,
      notes: [`Invoice #${invoice.number}`, invoice.clientName, paidMethod === "check" ? "Paid by check" : null]
        .filter(Boolean)
        .join(" | "),
      clientMutationId: `invoice_${invoice.id}_paid`,
      independent: {
        hours: 0,
        incomeBreakdowns: [invoiceIncomeBreakdown(invoice.lines, paymentMethod)],
        unreportedCash: 0,
        unreportedCashTips: 0,
        customIncome,
      },
    })
    const paid = InvoiceSchema.parse({ ...invoice, paidEntryId: created.id, updatedAt: new Date().toISOString() })
    await ref.set(paid)
    return { invoice: paid, entryId: created.id }
  } catch (error) {
    await ref
      .set(
        {
          status: claim.previousStatus,
          paidAt: null,
          paidVia: null,
          paidMethod: null,
          paidEntryId: null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
      .catch((revertError) => console.error("invoicesService.markInvoicePaidManually: failed to reopen invoice", revertError))
    throw error
  }
}

// Called after an Entry is deleted: an invoice whose payment that Entry
// booked goes back to "sent", since its income no longer counts anywhere.
// Best-effort — the Entry is already gone either way.
export async function reopenInvoicesForDeletedEntry(workspaceId: string, entryId: string): Promise<void> {
  const snap = await invoicesCol(workspaceId).where("paidEntryId", "==", entryId).get()
  if (snap.empty) return
  const batch = db.batch()
  const nowIso = new Date().toISOString()
  for (const doc of snap.docs) {
    batch.set(
      doc.ref,
      {
        status: "sent",
        paidAt: null,
        paidVia: null,
        paidMethod: null,
        paidEntryId: null,
        paidPlaidTransactionId: null,
        paidFeeAmount: 0,
        updatedAt: nowIso,
      },
      { merge: true }
    )
  }
  await batch.commit()
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
// total changed or that was voided.
async function expireCheckoutSession(workspaceId: string, sessionId: string): Promise<void> {
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
