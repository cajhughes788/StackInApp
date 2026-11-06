import { randomBytes } from "node:crypto"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from "../lib/httpErrors"
import { resolveInvoiceClient } from "./clientsService"
import { readInvoiceSettings } from "./invoicesService"
import { invoiceTotalFromLines, type InvoiceSettings } from "@shared/schemas/invoice"
import {
  QuoteActionSchema,
  QuoteCreateInputSchema,
  QuotePatchSchema,
  QuoteResponseSchema,
  QuoteSchema,
  type QuoteType,
} from "@shared/schemas/quote"
import { publicQuoteUrl, quoteAnswerBlocker, quoteAnswerNotificationText } from "@shared/quotes"
import { buildQuoteEmail } from "@shared/quoteEmail"

// ---------------------------------------------------------------------------
// Quotes (shared/schemas/quote.ts): a price sent before the job, which the
// client accepts or declines from its link, and which "Turn into invoice"
// makes an invoice from (createInvoice with quoteId).
//
// Lifecycle: draft → sent → accepted / declined (the client) or withdrawn
// (the owner); any of them → invoiced. Kept out of the invoices collection,
// so nothing that reads invoices (matching, reminders, totals) sees a quote.
// ---------------------------------------------------------------------------

export function quotesCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("quotes")
}

function quoteCounterDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("counters").doc("quotes")
}

function quoteSharesCol() {
  return db.collection("quoteShares")
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
}

async function assertIndependentWorkspace(workspaceId: string): Promise<void> {
  const snap = await db.doc(`workspaces/${workspaceId}`).get()
  if (snap.data()?.type !== "independent") {
    throw new BadRequestError("Quotes are only available in an independent workspace.")
  }
}

function readQuote(data: unknown): QuoteType {
  const parsed = QuoteSchema.safeParse(data)
  if (!parsed.success) throw new NotFoundError("Quote not found")
  return parsed.data
}

export async function listQuotes(workspaceId: string, uid: string): Promise<QuoteType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await quotesCol(workspaceId).get()
  const quotes: QuoteType[] = []
  for (const doc of snap.docs) {
    const parsed = QuoteSchema.safeParse(doc.data())
    if (parsed.success) quotes.push(parsed.data)
    else console.error("quotesService: skipping unparseable quote", doc.id, parsed.error.issues)
  }
  return quotes.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
}

export async function createQuote(workspaceId: string, uid: string, raw: unknown): Promise<QuoteType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = QuoteCreateInputSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid quote", formatIssues(parsed.error))
  const input = parsed.data
  await assertIndependentWorkspace(workspaceId)
  const settings = await readInvoiceSettings(workspaceId)
  const ref = input.clientMutationId ? quotesCol(workspaceId).doc(`cmid_${input.clientMutationId}`) : quotesCol(workspaceId).doc()
  // Every quote belongs to a saved client, like an invoice.
  const client = await resolveInvoiceClient(workspaceId, input)

  // Numbered in the same transaction as the write (as createInvoice), with
  // its own counter so invoice numbers never skip.
  return db.runTransaction(async (txn) => {
    const [existingSnap, counterSnap] = await txn.getAll(ref, quoteCounterDoc(workspaceId))
    if (existingSnap.exists) return readQuote(existingSnap.data())
    const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0)
    const nowIso = new Date().toISOString()
    const quote = QuoteSchema.parse({
      id: ref.id,
      workspaceId,
      number: String(lastNumber + 1).padStart(4, "0"),
      clientName: input.clientName,
      clientId: client.id,
      clientEmail: input.clientEmail || null,
      clientPhone: input.clientPhone || null,
      clientAddress: input.clientAddress || null,
      lines: input.lines,
      total: invoiceTotalFromLines(input.lines),
      issueDate: input.issueDate,
      validUntil: input.validUntil,
      note: input.note ?? "",
      policies: input.policies ?? settings.defaultPolicies,
      deposit: input.deposit ?? null,
      status: input.send ? "sent" : "draft",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    txn.create(ref, quote)
    txn.set(quoteCounterDoc(workspaceId), { lastNumber: lastNumber + 1, updatedAt: nowIso }, { merge: true })
    return quote
  })
}

// Drafts and sent quotes only: once the client has answered, what they
// answered stays as it was.
export async function updateQuote(workspaceId: string, uid: string, quoteId: string, raw: unknown): Promise<QuoteType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = QuotePatchSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid quote changes", formatIssues(parsed.error))
  const patch = parsed.data
  const ref = quotesCol(workspaceId).doc(quoteId)
  const before = await ref.get()
  if (!before.exists) throw new NotFoundError("Quote not found")
  let relinkedClientId: string | undefined
  if (patch.clientId !== undefined || patch.clientName !== undefined) {
    const client = await resolveInvoiceClient(workspaceId, {
      clientId: patch.clientId ?? null,
      clientName: patch.clientName ?? ((before.data()?.clientName as string | undefined) ?? ""),
      clientEmail: patch.clientEmail,
      clientPhone: patch.clientPhone,
      clientAddress: patch.clientAddress,
    })
    relinkedClientId = client.id
  }
  return db.runTransaction(async (txn) => {
    const current = readQuote((await txn.get(ref)).data())
    if (current.status !== "draft" && current.status !== "sent") throw new ConflictError(`A ${current.status} quote can't be edited.`)
    const lines = patch.lines ?? current.lines
    const next = QuoteSchema.parse({
      ...current,
      ...patch,
      clientId: relinkedClientId ?? current.clientId,
      clientEmail: patch.clientEmail === undefined ? current.clientEmail : patch.clientEmail || null,
      clientPhone: patch.clientPhone === undefined ? current.clientPhone : patch.clientPhone || null,
      clientAddress: patch.clientAddress === undefined ? current.clientAddress : patch.clientAddress || null,
      deposit: patch.deposit === undefined ? current.deposit : patch.deposit,
      lines,
      total: invoiceTotalFromLines(lines),
      updatedAt: new Date().toISOString(),
    })
    if (next.validUntil < next.issueDate) throw new BadRequestError("Valid until can't be before the quote date.")
    txn.set(ref, next)
    return next
  })
}

// Drafts only — a sent quote is withdrawn instead, so the numbers a client
// has seen never have holes.
export async function deleteQuote(workspaceId: string, uid: string, quoteId: string): Promise<{ deleted: boolean }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = quotesCol(workspaceId).doc(quoteId)
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists) return { deleted: false }
    const current = readQuote(snap.data())
    if (current.status !== "draft") throw new ConflictError("Only a draft can be deleted — withdraw a sent quote instead.")
    txn.delete(ref)
    return { deleted: true }
  })
}

export async function updateQuoteStatus(
  workspaceId: string,
  uid: string,
  quoteId: string,
  raw: unknown
): Promise<{ quote: QuoteType; shareUrl?: string }> {
  await assertWorkspaceMembership(workspaceId, uid)
  const parsed = QuoteActionSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError("Invalid quote action", formatIssues(parsed.error))
  const action = parsed.data
  const ref = quotesCol(workspaceId).doc(quoteId)
  if (action.action === "share") return shareQuote(workspaceId, ref)
  if (action.action === "email") return emailQuote(workspaceId, ref, { to: action.to, message: action.message })

  const quote = await db.runTransaction(async (txn) => {
    const current = readQuote((await txn.get(ref)).data())
    if (current.status === "withdrawn") return current
    if (current.status !== "sent" && current.status !== "accepted") throw new ConflictError(`A ${current.status} quote can't be withdrawn.`)
    const next = QuoteSchema.parse({ ...current, status: "withdrawn", updatedAt: new Date().toISOString() })
    txn.set(ref, next)
    return next
  })
  return { quote }
}

export async function shareQuote(
  workspaceId: string,
  ref: FirebaseFirestore.DocumentReference
): Promise<{ quote: QuoteType; shareUrl: string }> {
  const quote = await db.runTransaction(async (txn) => {
    const current = readQuote((await txn.get(ref)).data())
    if (current.status === "withdrawn") throw new ConflictError("A withdrawn quote can't be shared.")
    if (current.shareToken && current.status !== "draft") return current
    const nowIso = new Date().toISOString()
    const shareToken = current.shareToken ?? randomBytes(16).toString("base64url")
    if (!current.shareToken) {
      txn.create(quoteSharesCol().doc(shareToken), { workspaceId, quoteId: current.id, createdAt: nowIso })
    }
    const next = QuoteSchema.parse({
      ...current,
      shareToken,
      sharedAt: current.sharedAt ?? nowIso,
      status: current.status === "draft" ? "sent" : current.status,
      updatedAt: nowIso,
    })
    txn.set(ref, next)
    return next
  })
  return { quote, shareUrl: publicQuoteUrl(quote.shareToken!) }
}

// Same caps as invoice emails, and the same daily count per workspace.
async function emailQuote(
  workspaceId: string,
  ref: FirebaseFirestore.DocumentReference,
  request: { to: string; message?: string }
): Promise<{ quote: QuoteType; shareUrl: string }> {
  const { DAY_MS, MAX_SENDS_PER_INVOICE_PER_DAY, MAX_SENDS_PER_WORKSPACE_PER_DAY, emailCounterDoc, sendInvoiceEmailMessage } = await import(
    "./invoiceEmailService.js"
  )
  const current = readQuote((await ref.get()).data())
  if (current.status === "withdrawn") throw new ConflictError("A withdrawn quote can't be sent.")
  const now = Date.now()
  const recent = current.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS)
  if (recent.length >= MAX_SENDS_PER_INVOICE_PER_DAY) {
    throw new TooManyRequestsError("This quote has been emailed several times today — try again tomorrow.")
  }
  const today = new Date(now).toISOString().slice(0, 10)
  await db.runTransaction(async (txn) => {
    const counter = await txn.get(emailCounterDoc(workspaceId))
    const count = counter.data()?.date === today ? Number(counter.data()?.count ?? 0) : 0
    if (count >= MAX_SENDS_PER_WORKSPACE_PER_DAY) {
      throw new TooManyRequestsError("You've sent a lot of emails today — try again tomorrow.")
    }
    txn.set(emailCounterDoc(workspaceId), { date: today, count: count + 1 }, { merge: true })
  })

  const { quote: shared, shareUrl } = await shareQuote(workspaceId, ref)
  const settings = await readInvoiceSettings(workspaceId)
  await sendInvoiceEmailMessage(request.to, settings, buildQuoteEmail({ quote: shared, settings, link: shareUrl, message: request.message }), "quote")

  const sentAt = new Date().toISOString()
  return db.runTransaction(async (txn) => {
    const fresh = readQuote((await txn.get(ref)).data())
    const next = QuoteSchema.parse({
      ...fresh,
      clientEmail: request.to,
      lastEmailedAt: sentAt,
      lastEmailedTo: request.to,
      recentEmailSends: [...fresh.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS), sentAt].slice(-10),
      updatedAt: sentAt,
    })
    txn.set(ref, next)
    return { quote: next, shareUrl }
  })
}

// ---------------------------------------------------------------------------
// The client's side (routes/publicQuote.ts)
// ---------------------------------------------------------------------------

type SharedQuote = { workspaceId: string; ref: FirebaseFirestore.DocumentReference; quote: QuoteType; settings: InvoiceSettings }

// Drafts never show (the link is made when it's sent, but the quote's own
// data is the check, not the index).
export async function findSharedQuote(shareToken: string): Promise<SharedQuote | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(shareToken)) return null
  const share = (await quoteSharesCol().doc(shareToken).get()).data() as { workspaceId?: string; quoteId?: string } | undefined
  if (!share?.workspaceId || !share.quoteId) return null
  const ref = quotesCol(share.workspaceId).doc(share.quoteId)
  const [snap, settings] = await Promise.all([ref.get(), readInvoiceSettings(share.workspaceId)])
  const parsed = QuoteSchema.safeParse(snap.data())
  if (!parsed.success || parsed.data.shareToken !== shareToken || parsed.data.status === "draft") return null
  return { workspaceId: share.workspaceId, ref, quote: parsed.data, settings }
}

export type QuoteAnswerResult =
  | { kind: "not_found" }
  | { kind: "answered"; quote: QuoteType }
  | { kind: "invalid"; message: string; shared: SharedQuote }

/** Accept (with the name they typed) or decline (with an optional note). A repeat of the same answer is a no-op. */
export async function answerQuote(shareToken: string, raw: unknown): Promise<QuoteAnswerResult> {
  const shared = await findSharedQuote(shareToken)
  if (!shared) return { kind: "not_found" }
  const parsed = QuoteResponseSchema.safeParse(raw)
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Please try again.", shared }
  const response = parsed.data
  const outcome = await db.runTransaction(async (txn) => {
    const current = readQuote((await txn.get(shared.ref)).data())
    const repeat =
      (response.answer === "accept" && (current.status === "accepted" || current.status === "invoiced")) ||
      (response.answer === "decline" && current.status === "declined")
    if (repeat) return { quote: current, changed: false, blocker: null }
    const blocker = quoteAnswerBlocker(current, new Date().toISOString().slice(0, 10))
    if (blocker) return { quote: current, changed: false, blocker }
    const nowIso = new Date().toISOString()
    const next = QuoteSchema.parse(
      response.answer === "accept"
        ? { ...current, status: "accepted", acceptedAt: nowIso, acceptedName: response.name, updatedAt: nowIso }
        : { ...current, status: "declined", declinedAt: nowIso, declineNote: response.note || null, updatedAt: nowIso }
    )
    txn.set(shared.ref, next)
    return { quote: next, changed: true, blocker: null }
  })
  if (outcome.blocker) return { kind: "invalid", message: outcome.blocker, shared: { ...shared, quote: outcome.quote } }
  if (outcome.changed) await notifyOwnerAboutQuote(shared.workspaceId, outcome.quote, response.answer)
  return { kind: "answered", quote: outcome.quote }
}

// Once per quote and answer (a retried form post doesn't push twice).
async function notifyOwnerAboutQuote(workspaceId: string, quote: QuoteType, answer: "accept" | "decline"): Promise<void> {
  try {
    await db.doc(`workspaces/${workspaceId}/notificationState/quote_${answer}_${quote.id}`).create({ sentAt: new Date().toISOString() })
  } catch {
    return // Already told.
  }
  try {
    const ownerUid = (await db.doc(`workspaces/${workspaceId}`).get()).data()?.ownerId as string | undefined
    if (!ownerUid) return
    const { sendTransactionNotification } = await import("./pushNotificationService.js")
    await sendTransactionNotification(ownerUid, {
      ...quoteAnswerNotificationText(quote, answer),
      data: { deepLink: `stackin://quotes/${quote.id}`, workspaceId },
    })
  } catch (error) {
    console.error("quotesService: push failed", { workspaceId, id: quote.id, answer }, error)
  }
}

// ---------------------------------------------------------------------------
// Turning a quote into an invoice (invoicesService.createInvoice / deleteInvoice)
// ---------------------------------------------------------------------------

/** Read inside createInvoice's transaction (before its writes). Throws when the quote already has another invoice. */
export async function readQuoteToInvoice(
  txn: FirebaseFirestore.Transaction,
  workspaceId: string,
  quoteId: string,
  invoiceId: string
): Promise<{ ref: FirebaseFirestore.DocumentReference; quote: QuoteType }> {
  const ref = quotesCol(workspaceId).doc(quoteId)
  const quote = readQuote((await txn.get(ref)).data())
  if (quote.invoiceId && quote.invoiceId !== invoiceId) throw new ConflictError("This quote has already been turned into an invoice.")
  return { ref, quote }
}

// Called from account/workspace deletion before the workspace tree is
// wiped — recursiveDelete doesn't reach this top-level index.
export async function deleteQuoteSharesForWorkspace(workspaceId: string): Promise<void> {
  const snap = await quoteSharesCol().where("workspaceId", "==", workspaceId).get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch()
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref)
    await batch.commit()
  }
}
