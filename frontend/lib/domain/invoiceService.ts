"use client"

// lib/domain/invoiceService.ts
// Invoice changes that don't make the user wait. The invoice functions often
// cold-start (~12s), so creates, edits, recorded payments, void, close and
// delete update the invoices store at once and reach the server in the
// background:
//
// • Each invoice's server calls run one after another (a quick edit then a
//   recorded payment reach the server in that order).
// • A new invoice gets a temporary id ("tmp-<clientMutationId>") until the
//   server answers with its real id and number. Work queued on the temporary
//   id then runs against the real one.
// • The server's copy replaces the optimistic one once nothing else is
//   queued for that invoice.
// • A failure puts the invoice back, says so, and reloads from the server.
//   A failed create offers "Try again" (same clientMutationId, so it can't
//   make two invoices).
//
// Emailing an invoice and saving invoice settings work the same way: the
// screen moves on at once, and a failure puts things back and says so.
//
// Sharing a link, texting and refunds stay server-confirmed: they wait for
// invoiceSaved() first, then for their own call.

import { createElement } from "react"

import { ToastAction, type ToastActionElement } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { createInvoice, deleteInvoice, editInvoice, saveInvoiceSettings, updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { isTempInvoiceId, useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { invoicePaymentPurposeFor, invoiceWithPayments } from "@shared/invoicePayments"
import {
  InvoiceSettingsSchema,
  invoiceTotalFromLines,
  type InvoiceCreateInput,
  type InvoicePaidMethod,
  type InvoicePatch,
  type InvoicePayment,
  type InvoiceSettingsPatch,
  type InvoiceType,
} from "@shared/schemas/invoice"

const realIdByTempId = new Map<string, string>()
const tempIdByRealId = new Map<string, string>()
// The tail of each invoice's queue; never rejects.
const queues = new Map<string, Promise<void>>()

// The invoice's create failed, so work queued behind it has nothing to act on.
class InvoiceNotSavedError extends Error {
  constructor() {
    super("This invoice didn't save.")
  }
}

function store() {
  return useInvoicesStore.getState()
}

/** One key per invoice for its whole life: the temporary id for one created here. */
export function invoiceKey(invoiceId: string): string {
  return tempIdByRealId.get(invoiceId) ?? invoiceId
}

/** The id the invoice has now: the real one once a new invoice is saved. */
export function currentInvoiceId(invoiceId: string): string {
  const key = invoiceKey(invoiceId)
  return realIdByTempId.get(key) ?? key
}

export function latestInvoice(workspaceId: string, invoiceId: string): InvoiceType | null {
  const id = currentInvoiceId(invoiceId)
  return store().byWorkspaceId[workspaceId]?.invoices.find((invoice) => invoice.id === id) ?? null
}

/** Whether this invoice still has changes on their way to the server. */
export function useInvoiceSaving(invoiceId: string | null): boolean {
  return useInvoicesStore((state) => (invoiceId ? (state.savingByKey[invoiceKey(invoiceId)] ?? 0) > 0 : false))
}

/** Waits for the invoice's queued changes; returns its real id. */
export async function invoiceSaved(invoiceId: string): Promise<string> {
  await queues.get(invoiceKey(invoiceId))
  const id = currentInvoiceId(invoiceId)
  if (isTempInvoiceId(id)) throw new InvoiceNotSavedError()
  return id
}

function enqueue<T>(invoiceId: string, task: (savedId: string) => Promise<T>): Promise<T> {
  const key = invoiceKey(invoiceId)
  const previous = queues.get(key) ?? Promise.resolve()
  store().adjustSaving(key, 1)
  const run = previous.then(() => {
    const id = currentInvoiceId(key)
    // A create is the only task that runs on a temporary id.
    return task(id)
  })
  const tail: Promise<void> = run.then(
    () => {},
    () => {}
  ).then(() => {
    store().adjustSaving(key, -1)
    if (queues.get(key) === tail) queues.delete(key)
  })
  queues.set(key, tail)
  return run
}

function requireSaved(id: string): string {
  if (isTempInvoiceId(id)) throw new InvoiceNotSavedError()
  return id
}

// The server's copy, unless more changes are queued behind this one — their
// optimistic state stays on screen and the last answer settles it.
function applyServerCopy(workspaceId: string, invoiceId: string, saved: InvoiceType) {
  if ((store().savingByKey[invoiceKey(invoiceId)] ?? 0) > 1) return
  store().upsertInvoice(workspaceId, saved)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Check your connection and try again."
}

function onFailure(workspaceId: string, title: string, error: unknown, restore: InvoiceType | null) {
  // Its create already failed and said so.
  if (error instanceof InvoiceNotSavedError) return
  if (restore) store().upsertInvoice(workspaceId, { ...restore, id: currentInvoiceId(restore.id) })
  toast({ title, description: errorMessage(error), variant: "destructive" })
  // Anything queued after it may have built on the change that failed.
  void store().load(workspaceId, { force: true }).catch(() => {})
}

type CreateInput = InvoiceCreateInput & { clientMutationId: string }

/** Shows the new invoice now (temporary id) and creates it in the background. */
export function createInvoiceInBackground(workspaceId: string, input: CreateInput): InvoiceType {
  const tempId = `tmp-${input.clientMutationId}`
  const now = new Date().toISOString()
  const optimistic: InvoiceType = {
    id: tempId,
    workspaceId,
    // The server numbers invoices.
    number: "…",
    clientName: input.clientName,
    clientEmail: input.clientEmail || null,
    clientPhone: input.clientPhone || null,
    clientAddress: input.clientAddress || null,
    lastEmailedAt: null,
    lastEmailedTo: null,
    recentEmailSends: [],
    reminderSends: [],
    remindersPaused: false,
    lines: input.lines,
    total: invoiceTotalFromLines(input.lines),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    note: input.note ?? "",
    // The server fills in the default policies when none were sent.
    policies: input.policies ?? "",
    shareToken: null,
    status: "draft",
    refunds: [],
    dispute: null,
    paymentFailedAt: null,
    sharedAt: null,
    payments: [],
    deposit: input.deposit ? { ...input.deposit, waivedAt: null } : null,
    pendingPayment: null,
    openCheckout: null,
    closedAt: null,
    amountPaid: 0,
    paymentEntryIds: [],
    paymentPlaidTransactionIds: [],
    paymentIntentIds: [],
    lastManualPaymentOn: null,
    createdAt: now,
    updatedAt: now,
  }
  store().upsertInvoice(workspaceId, optimistic)

  enqueue(tempId, async () => {
    const saved = await createInvoice(workspaceId, input)
    // Edits made while it was saving stay on screen, under the real id.
    const shown = latestInvoice(workspaceId, tempId)
    realIdByTempId.set(tempId, saved.id)
    tempIdByRealId.set(saved.id, tempId)
    store().removeInvoice(workspaceId, tempId)
    // Deleted while it was saving: the queued delete removes it on the server.
    if (!shown) return
    const queuedBehind = (store().savingByKey[tempId] ?? 0) > 1
    store().upsertInvoice(
      workspaceId,
      queuedBehind && shown ? { ...shown, id: saved.id, number: saved.number, createdAt: saved.createdAt } : saved
    )
  }).catch((error) => {
    store().removeInvoice(workspaceId, tempId)
    toast({
      title: `Couldn't save the invoice for ${input.clientName}`,
      description: errorMessage(error),
      variant: "destructive",
      action: createElement(
        ToastAction,
        { altText: "Try again", onClick: () => createInvoiceInBackground(workspaceId, input) },
        "Try again"
        // shadcn types the element by the component, which createElement can't express.
      ) as unknown as ToastActionElement,
    })
  })

  return optimistic
}

export function editInvoiceInBackground(workspaceId: string, invoice: InvoiceType, patch: InvoicePatch) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  const lines = patch.lines ?? previous.lines
  store().upsertInvoice(workspaceId, {
    ...previous,
    ...patch,
    clientEmail: patch.clientEmail === undefined ? previous.clientEmail : patch.clientEmail || null,
    clientPhone: patch.clientPhone === undefined ? previous.clientPhone : patch.clientPhone || null,
    note: patch.note ?? previous.note,
    deposit: patch.deposit === undefined ? previous.deposit : patch.deposit ? { ...patch.deposit, waivedAt: null } : null,
    lines,
    total: invoiceTotalFromLines(lines),
    updatedAt: new Date().toISOString(),
  })
  enqueue(invoice.id, async (id) => {
    applyServerCopy(workspaceId, invoice.id, await editInvoice(workspaceId, requireSaved(id), patch))
  }).catch((error) => onFailure(workspaceId, `Couldn't save invoice #${previous.number}`, error, previous))
}

export type RecordPaymentInput = {
  amount: number
  tipAmount: number
  paidDate: string
  paymentMethod: InvoicePaidMethod
  // One per sheet opening, so a retried save can't record it twice.
  clientMutationId: string
}

/** A payment received outside 521 (cash, check, Zelle…): shown now, booked in the background. */
export function recordPaymentInBackground(workspaceId: string, invoice: InvoiceType, input: RecordPaymentInput) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  // As the server's payment engine applies it (shared/invoicePayments.ts).
  const payment: InvoicePayment = {
    id: `manual_${input.clientMutationId}`,
    purpose: invoicePaymentPurposeFor(previous, input.amount),
    amount: input.amount,
    tipAmount: input.tipAmount,
    receivedOn: input.paidDate,
    via: "manual",
    method: input.paymentMethod,
    entryId: null,
    plaidTransactionId: null,
    stripePaymentIntentId: null,
    checkoutSessionId: null,
    feeAmount: 0,
    createdAt: new Date().toISOString(),
  }
  store().upsertInvoice(workspaceId, {
    ...invoiceWithPayments(previous, [...previous.payments, payment]),
    openCheckout: null,
    paymentFailedAt: null,
    updatedAt: new Date().toISOString(),
  })
  enqueue(invoice.id, async (id) => {
    const { invoice: saved } = await updateInvoiceStatus(workspaceId, requireSaved(id), { action: "record_payment", ...input })
    applyServerCopy(workspaceId, invoice.id, saved)
    // The income entry was booked server-side; refresh whatever period the
    // home page has loaded.
    const entries = useEntriesStore.getState()
    const periodId = entries.byWorkspaceId[workspaceId]?.periodId
    if (periodId) void entries.refreshFromBackend(workspaceId, periodId, { force: true }).catch(() => {})
  }).catch((error) => onFailure(workspaceId, `Couldn't record the payment on #${previous.number}`, error, previous))
}

/** The deposit isn't needed: the whole amount is due by the invoice's due date. */
export function waiveDepositInBackground(workspaceId: string, invoice: InvoiceType) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  if (!previous.deposit) return
  const now = new Date().toISOString()
  store().upsertInvoice(workspaceId, { ...previous, deposit: { ...previous.deposit, waivedAt: now }, openCheckout: null, updatedAt: now })
  enqueue(invoice.id, async (id) => {
    const { invoice: waived } = await updateInvoiceStatus(workspaceId, requireSaved(id), { action: "waive_deposit" })
    applyServerCopy(workspaceId, invoice.id, waived)
  }).catch((error) => onFailure(workspaceId, `Couldn't waive the deposit on #${previous.number}`, error, previous))
}

/** Ends a partly paid invoice, keeping what was paid. */
export function closeInvoiceInBackground(workspaceId: string, invoice: InvoiceType) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  const now = new Date().toISOString()
  store().upsertInvoice(workspaceId, { ...previous, status: "closed", closedAt: now, openCheckout: null, updatedAt: now })
  enqueue(invoice.id, async (id) => {
    const { invoice: closed } = await updateInvoiceStatus(workspaceId, requireSaved(id), { action: "close" })
    applyServerCopy(workspaceId, invoice.id, closed)
  }).catch((error) => onFailure(workspaceId, `Couldn't close invoice #${previous.number}`, error, previous))
}

/**
 * Emails the client the invoice (sharing it first, which sends a draft). It
 * shows as sent and emailed now; a failure (a send cap, no connection) puts
 * the invoice back and says so.
 */
export function emailInvoiceInBackground(workspaceId: string, invoice: InvoiceType, request: { to: string; message?: string }) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  const now = new Date().toISOString()
  store().upsertInvoice(workspaceId, {
    ...previous,
    status: previous.status === "draft" ? "sent" : previous.status,
    clientEmail: request.to,
    lastEmailedAt: now,
    lastEmailedTo: request.to,
    sharedAt: previous.sharedAt ?? now,
    updatedAt: now,
  })
  enqueue(invoice.id, async (id) => {
    // The email shows the business details just saved.
    await invoiceSettingsSaved(workspaceId)
    const { invoice: sent } = await updateInvoiceStatus(workspaceId, requireSaved(id), {
      action: "email",
      to: request.to,
      ...(request.message ? { message: request.message } : {}),
    })
    applyServerCopy(workspaceId, invoice.id, sent)
  }).catch((error) => onFailure(workspaceId, `Couldn't email invoice #${previous.number}`, error, previous))
}

/* --------------------------------------------------------
 * Invoice settings — saved in the background, one save at a time
 * -------------------------------------------------------- */

const settingsQueues = new Map<string, { tail: Promise<void>; pending: number }>()

/** Waits for invoice settings still on their way to the server. */
export async function invoiceSettingsSaved(workspaceId: string): Promise<void> {
  await settingsQueues.get(workspaceId)?.tail
}

export function saveInvoiceSettingsInBackground(workspaceId: string, patch: InvoiceSettingsPatch) {
  const previous = store().byWorkspaceId[workspaceId]?.settings ?? null
  store().setSettings(workspaceId, InvoiceSettingsSchema.parse({ ...(previous ?? {}), ...patch }))
  const queue = settingsQueues.get(workspaceId) ?? { tail: Promise.resolve(), pending: 0 }
  queue.pending += 1
  const run = queue.tail.then(() => saveInvoiceSettings(workspaceId, patch))
  queue.tail = run.then(
    (saved) => {
      queue.pending -= 1
      // A later save's optimistic copy stays until its own answer.
      if (queue.pending === 0) store().setSettings(workspaceId, saved)
    },
    (error) => {
      queue.pending -= 1
      if (previous) store().setSettings(workspaceId, previous)
      toast({ title: "Couldn't save your invoice settings", description: errorMessage(error), variant: "destructive" })
      void store().load(workspaceId, { force: true }).catch(() => {})
    }
  )
  settingsQueues.set(workspaceId, queue)
}

/** Stops or resumes automatic reminders for one invoice. */
export function setRemindersPausedInBackground(workspaceId: string, invoice: InvoiceType, paused: boolean) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  store().upsertInvoice(workspaceId, { ...previous, remindersPaused: paused, updatedAt: new Date().toISOString() })
  enqueue(invoice.id, async (id) => {
    const { invoice: saved } = await updateInvoiceStatus(workspaceId, requireSaved(id), { action: "set_reminders", paused })
    applyServerCopy(workspaceId, invoice.id, saved)
  }).catch((error) =>
    onFailure(workspaceId, `Couldn't ${paused ? "stop" : "resume"} reminders on #${previous.number}`, error, previous)
  )
}

export function voidInvoiceInBackground(workspaceId: string, invoice: InvoiceType) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  store().upsertInvoice(workspaceId, { ...previous, status: "void", openCheckout: null, updatedAt: new Date().toISOString() })
  enqueue(invoice.id, async (id) => {
    const { invoice: voided } = await updateInvoiceStatus(workspaceId, requireSaved(id), { action: "void" })
    applyServerCopy(workspaceId, invoice.id, voided)
  }).catch((error) => onFailure(workspaceId, `Couldn't void invoice #${previous.number}`, error, previous))
}

/** Drafts only. */
export function deleteInvoiceInBackground(workspaceId: string, invoice: InvoiceType) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  store().removeInvoice(workspaceId, previous.id)
  enqueue(invoice.id, async (id) => {
    await deleteInvoice(workspaceId, requireSaved(id))
  }).catch((error) => onFailure(workspaceId, `Couldn't delete draft #${previous.number}`, error, previous))
}
