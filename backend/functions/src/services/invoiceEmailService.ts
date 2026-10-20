import sgMail from "@sendgrid/mail"
import { db } from "../admin"
import { SENDGRID_API_KEY } from "../secrets"
import { ConflictError, NotFoundError, TooManyRequestsError } from "../lib/httpErrors"
import { InvoiceSchema, type InvoiceSettings, type InvoiceType } from "@shared/schemas/invoice"
import { buildInvoiceEmail, type InvoiceEmail } from "@shared/invoiceEmail"
import { publicInvoiceUrl } from "@shared/invoiceDisplay"
import { readInvoiceSettings, shareInvoice } from "./invoicesService"

// ---------------------------------------------------------------------------
// 521 emails a client their invoice (updateInvoiceStatus { action: "email" }).
//
// Sent from 521's verified SendGrid sender with the business as the display
// name ("Barber Shop via 521") and the business email as Reply-To, so
// replies reach the user, not 521.
//
// the521app.com is domain-authenticated in SendGrid (DKIM + DMARC on
// Spaceship DNS), so any address on it can send without per-address
// verification.
// ---------------------------------------------------------------------------

export const INVOICE_EMAIL_FROM = "invoices@the521app.com"

// Caps so 521 can't be used to flood an inbox: per invoice, and per
// workspace per day. Automatic reminders count too (invoiceReminderService.ts).
export const MAX_SENDS_PER_INVOICE_PER_DAY = 5
export const MAX_SENDS_PER_WORKSPACE_PER_DAY = 50
export const DAY_MS = 86_400_000

export function emailCounterDoc(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("counters").doc("invoiceEmails")
}

export async function emailInvoice(
  workspaceId: string,
  ref: FirebaseFirestore.DocumentReference,
  request: { to: string; message?: string }
): Promise<{ invoice: InvoiceType; shareUrl: string }> {
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("Invoice not found")
  const current = InvoiceSchema.parse(snap.data())
  if (current.status === "void") throw new ConflictError("A void invoice can't be sent.")

  const now = Date.now()
  const recent = current.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS)
  if (recent.length >= MAX_SENDS_PER_INVOICE_PER_DAY) {
    throw new TooManyRequestsError("This invoice has been emailed several times today — try again tomorrow.")
  }

  // Workspace daily cap, reserved before sending.
  const today = new Date(now).toISOString().slice(0, 10)
  await db.runTransaction(async (txn) => {
    const counter = await txn.get(emailCounterDoc(workspaceId))
    const count = counter.data()?.date === today ? Number(counter.data()?.count ?? 0) : 0
    if (count >= MAX_SENDS_PER_WORKSPACE_PER_DAY) {
      throw new TooManyRequestsError("You've sent a lot of invoice emails today — try again tomorrow.")
    }
    txn.set(emailCounterDoc(workspaceId), { date: today, count: count + 1 }, { merge: true })
  })

  // Sharing creates the link (and sends a draft) — the email carries it.
  const { invoice: shared, shareUrl } = await shareInvoice(workspaceId, ref)
  const settings = await readInvoiceSettings(workspaceId)
  const { invoiceOnlinePayment } = await import("./invoicePaymentsService.js")
  const online = await invoiceOnlinePayment(workspaceId, shared).catch(() => ({ payable: false, bankTransfer: false }))
  const email = buildInvoiceEmail({
    invoice: shared,
    settings,
    link: shareUrl || publicInvoiceUrl(shared.shareToken!),
    message: request.message,
    payableOnline: online.payable,
  })

  await sendInvoiceEmailMessage(request.to, settings, email, "invoice")

  const sentAt = new Date().toISOString()
  return db.runTransaction(async (txn) => {
    const fresh = InvoiceSchema.parse((await txn.get(ref)).data())
    const next = InvoiceSchema.parse({
      ...fresh,
      clientEmail: request.to,
      lastEmailedAt: sentAt,
      lastEmailedTo: request.to,
      recentEmailSends: [...fresh.recentEmailSends.filter((at) => now - Date.parse(at) < DAY_MS), sentAt].slice(-10),
      updatedAt: sentAt,
    })
    txn.set(ref, next)
    return { invoice: next, shareUrl }
  })
}

// Sends one invoice email (an invoice or a reminder) from the business.
export async function sendInvoiceEmailMessage(
  to: string,
  settings: InvoiceSettings,
  email: InvoiceEmail,
  category: "invoice" | "invoice_reminder"
): Promise<void> {
  sgMail.setApiKey(SENDGRID_API_KEY.value())
  await sgMail.send({
    to,
    from: { email: INVOICE_EMAIL_FROM, name: `${(settings.businessName || "521").slice(0, 60)} via 521` },
    ...(settings.businessEmail ? { replyTo: settings.businessEmail } : {}),
    subject: email.subject,
    text: email.text,
    html: email.html,
    categories: [category],
    // Click tracking would rewrite the private invoice link through
    // SendGrid's redirect domain.
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  })
}
