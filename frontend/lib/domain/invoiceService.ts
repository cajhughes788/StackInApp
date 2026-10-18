"use client"

// lib/domain/invoiceService.ts
// Invoice changes that don't make the user wait. The invoice functions often
// cold-start (~12s), so creates, edits, mark paid, void and delete update the
// invoices store at once and reach the server in the background:
//
// • Each invoice's server calls run one after another (a quick edit then
//   mark paid reaches the server in that order).
// • A new invoice gets a temporary id ("tmp-<clientMutationId>") until the
//   server answers with its real id and number. Work queued on the temporary
//   id then runs against the real one.
// • The server's copy replaces the optimistic one once nothing else is
//   queued for that invoice.
// • A failure puts the invoice back, says so, and reloads from the server.
//   A failed create offers "Try again" (same clientMutationId, so it can't
//   make two invoices).
//
// Sending, sharing and refunds stay server-confirmed: they wait for
// invoiceSaved() first, then for their own call.

import { createElement } from "react"

import { ToastAction, type ToastActionElement } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { createInvoice, deleteInvoice, editInvoice, updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { useEntriesStore } from "@/lib/stores/useEntriesStore"
import { isTempInvoiceId, useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import {
  invoiceTotalFromLines,
  type InvoiceCreateInput,
  type InvoicePaidMethod,
  type InvoicePatch,
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
    lastEmailedAt: null,
    lastEmailedTo: null,
    recentEmailSends: [],
    lines: input.lines,
    total: invoiceTotalFromLines(input.lines),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    note: input.note ?? "",
    shareToken: null,
    status: "draft",
    paidAt: null,
    paidVia: null,
    paidEntryId: null,
    paidPlaidTransactionId: null,
    checkoutSessionId: null,
    paidStripePaymentIntentId: null,
    pendingPaymentAt: null,
    refunds: [],
    dispute: null,
    paymentFailedAt: null,
    paidFeeAmount: 0,
    paidMethod: null,
    sharedAt: null,
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
    lines,
    total: invoiceTotalFromLines(lines),
    updatedAt: new Date().toISOString(),
  })
  enqueue(invoice.id, async (id) => {
    applyServerCopy(workspaceId, invoice.id, await editInvoice(workspaceId, requireSaved(id), patch))
  }).catch((error) => onFailure(workspaceId, `Couldn't save invoice #${previous.number}`, error, previous))
}

export function markInvoicePaidInBackground(
  workspaceId: string,
  invoice: InvoiceType,
  paidDate: string,
  paymentMethod: InvoicePaidMethod
) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  store().upsertInvoice(workspaceId, {
    ...previous,
    status: "paid",
    // As the server records a hand-marked payment.
    paidAt: `${paidDate}T12:00:00.000Z`,
    paidVia: "manual",
    paidMethod: paymentMethod,
    pendingPaymentAt: null,
    paymentFailedAt: null,
    updatedAt: new Date().toISOString(),
  })
  enqueue(invoice.id, async (id) => {
    const { invoice: paid } = await updateInvoiceStatus(workspaceId, requireSaved(id), {
      action: "mark_paid",
      paidDate,
      paymentMethod,
    })
    applyServerCopy(workspaceId, invoice.id, paid)
    // The income entry was booked server-side; refresh whatever period the
    // home page has loaded.
    const entries = useEntriesStore.getState()
    const periodId = entries.byWorkspaceId[workspaceId]?.periodId
    if (periodId) void entries.refreshFromBackend(workspaceId, periodId, { force: true }).catch(() => {})
  }).catch((error) => onFailure(workspaceId, `Couldn't mark #${previous.number} paid`, error, previous))
}

export function voidInvoiceInBackground(workspaceId: string, invoice: InvoiceType) {
  const previous = latestInvoice(workspaceId, invoice.id) ?? invoice
  store().upsertInvoice(workspaceId, { ...previous, status: "void", updatedAt: new Date().toISOString() })
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
