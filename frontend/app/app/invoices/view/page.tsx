"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, FileText, Landmark, Link2, Mail, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import RecordPaymentSheet from "@/components/invoices/record-payment-sheet"
import RefundSheet from "@/components/invoices/refund-sheet"
import SendInvoiceSheet from "@/components/invoices/send-invoice-sheet"
import {
  InvoiceDisputeCard,
  InvoiceMoneyBreakdown,
  hasMoneyHistory,
  invoiceKeptAmount,
} from "@/components/invoices/invoice-money"
import {
  InvoicePreview,
  InvoicesPage,
  InvoiceStatusPill,
  PAID_METHOD_LABELS,
  cardClass,
  localToday,
  useQueryParam,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import { updateInvoiceStatus } from "@/lib/api/invoicesApi"
import {
  currentInvoiceId,
  deleteInvoiceInBackground,
  invoiceSaved,
  latestInvoice,
  useInvoiceSaving,
  voidInvoiceInBackground,
  closeInvoiceInBackground,
  waiveDepositInBackground,
} from "@/lib/domain/invoiceService"
import { shareLink } from "@/lib/documentExport"
import { shareInvoicePdf } from "@/lib/invoicePdf"
import { isTempInvoiceId, useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import {
  INVOICE_TERMS_LABELS,
  dueDateForTerms,
  formatInvoiceDate,
  formatInvoiceMoney,
  publicInvoiceUrl,
} from "@shared/invoiceDisplay"
import {
  invoiceAmountPaid,
  invoiceBalanceDue,
  invoiceDepositOutstanding,
  invoiceHasPayments,
  invoiceLatestPayment,
  invoiceRefundable,
  invoiceRefundTarget,
} from "@shared/invoicePayments"
import type { InvoiceTerms, InvoiceType } from "@shared/schemas/invoice"

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function termsLabel(invoice: InvoiceType): string | null {
  const terms = (["due_on_receipt", "net_15", "net_30"] as InvoiceTerms[]).find(
    (t) => dueDateForTerms(invoice.issueDate, t) === invoice.dueDate
  )
  return terms ? INVOICE_TERMS_LABELS[terms] : null
}

function metaLine(invoice: InvoiceType): string {
  switch (invoice.status) {
    case "draft":
      return "Draft · not shared yet"
    case "void":
      return "Voided · nothing is owed"
    case "closed":
      return "Closed · nothing more is owed"
    case "paid": {
      const latest = invoiceLatestPayment(invoice)
      if (!latest) return "Paid"
      const parts = [`Paid ${formatInvoiceDate(latest.receivedOn)}`]
      if (latest.via === "bank_match") parts.push("matched from your bank")
      else if (latest.via === "online") parts.push(latest.method === "other" ? "paid by bank transfer" : "paid online")
      else parts.push(PAID_METHOD_LABELS[latest.method])
      return parts.join(" · ")
    }
    case "sent":
      if (invoice.pendingPayment) {
        return `Bank payment processing · started ${formatInvoiceDate(invoice.pendingPayment.startedAt.slice(0, 10))}`
      }
      if (invoiceDepositOutstanding(invoice) > 0 && invoice.deposit) {
        const late = invoice.deposit.dueDate < localToday()
        return `Deposit ${formatInvoiceMoney(invoiceDepositOutstanding(invoice))} ${late ? "was due" : "due"} ${formatInvoiceDate(invoice.deposit.dueDate)} · ${formatInvoiceMoney(invoice.total)} total`
      }
      if (invoiceHasPayments(invoice)) {
        return `${formatInvoiceMoney(invoiceAmountPaid(invoice))} paid · ${formatInvoiceMoney(invoiceBalanceDue(invoice))} due`
      }
      return [invoice.sharedAt ? `Shared ${formatInvoiceDate(invoice.sharedAt.slice(0, 10))}` : "Sent", termsLabel(invoice)]
        .filter(Boolean)
        .join(" · ")
  }
}

export default function InvoiceDetailPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoiceDetailPage />
    </Suspense>
  )
}

function InvoiceDetailPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, workspaceId, invoices, settings, loadStatus } = useInvoicesWorkspace()
  const paymentAccount = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.paymentAccount ?? null : null))
  const payableOnline = !!paymentAccount?.chargesEnabled && !!paymentAccount.acceptOnline
  const upsertInvoice = useInvoicesStore((state) => state.upsertInvoice)
  const invoiceId = useQueryParam("id")
  const justCreated = useQueryParam("share") === "1"
  // A just-created invoice is found under its real id as soon as it has one.
  const invoice = invoiceId ? invoices.find((i) => i.id === currentInvoiceId(invoiceId)) ?? null : null
  const saving = useInvoiceSaving(invoice?.id ?? null)
  const [busy, setBusy] = useState<null | "link" | "pdf">(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  // The payment a refund comes off; null means the latest with anything left.
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  // The link, when neither a share sheet nor the clipboard was available.
  const [manualLink, setManualLink] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | "void" | "delete" | "close">(null)
  // Deleted here: it's gone from the store before the list page opens.
  const [leaving, setLeaving] = useState(false)
  const today = localToday()

  // A just-created invoice opens straight into the send sheet, once.
  const autoOpenedSend = useRef(false)
  const canSend = !!workspaceId && (invoice?.status === "draft" || invoice?.status === "sent")
  useEffect(() => {
    if (!justCreated || !canSend || autoOpenedSend.current) return
    autoOpenedSend.current = true
    setSendOpen(true)
  }, [justCreated, canSend])

  // Once a new invoice has its real id, the URL gets it too; one whose
  // create failed (or a stale temporary link) goes back to the list.
  useEffect(() => {
    if (!invoiceId || !isTempInvoiceId(invoiceId) || loadStatus !== "ready") return
    if (invoice && !isTempInvoiceId(invoice.id)) {
      router.replace(`/app/invoices/view?id=${encodeURIComponent(invoice.id)}${justCreated ? "&share=1" : ""}`, {
        scroll: false,
      })
    } else if (!invoice) {
      router.replace("/app/invoices")
    }
  }, [invoice, invoiceId, justCreated, loadStatus, router])

  // Creates the link the first time (and sends a draft). Returns the latest invoice.
  async function ensureShared(shown: InvoiceType): Promise<{ invoice: InvoiceType; url: string }> {
    // Changes still saving go first; the link needs the saved invoice.
    const id = await invoiceSaved(shown.id)
    const current = latestInvoice(workspaceId!, id) ?? shown
    if (current.shareToken && current.status !== "draft") {
      return { invoice: current, url: publicInvoiceUrl(current.shareToken) }
    }
    const result = await updateInvoiceStatus(workspaceId!, id, { action: "share" })
    upsertInvoice(workspaceId!, result.invoice)
    return { invoice: result.invoice, url: result.shareUrl ?? publicInvoiceUrl(result.invoice.shareToken!) }
  }

  async function onShareLink() {
    if (!invoice || !workspaceId) return
    setBusy("link")
    try {
      const { url } = await ensureShared(invoice)
      const business = settings?.businessName || "me"
      const outcome = await shareLink(
        url,
        `Invoice #${invoice.number}`,
        `Invoice #${invoice.number} from ${business}: ${formatInvoiceMoney(invoiceBalanceDue(invoice))}`
      )
      if (outcome === "copied") toast({ title: "Link copied", description: "Paste it into a text or email to your client." })
      if (outcome === "unavailable") setManualLink(url)
    } catch (error) {
      toast({
        title: "Couldn't share the link",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  async function onSharePdf() {
    if (!invoice || !workspaceId || !settings) return
    setBusy("pdf")
    try {
      // A PDF going to the client counts as sending it.
      const latest = invoice.status === "draft" ? (await ensureShared(invoice)).invoice : invoice
      await shareInvoicePdf(latest, settings)
    } catch (error) {
      toast({
        title: "Couldn't create the PDF",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  function onWaiveDeposit() {
    if (!invoice || !workspaceId) return
    waiveDepositInBackground(workspaceId, invoice)
    toast({
      title: "Deposit waived",
      description: `${formatInvoiceMoney(invoiceBalanceDue(invoice))} is due by ${formatInvoiceDate(invoice.dueDate)}.`,
    })
  }

  function openRefund(paymentId: string | null) {
    setRefundPaymentId(paymentId)
    setRefundOpen(true)
  }

  function onConfirmAction(action: "void" | "delete" | "close") {
    if (!invoice || !workspaceId) return
    setConfirm(null)
    // Saved in the background (invoiceService).
    if (action === "void") {
      voidInvoiceInBackground(workspaceId, invoice)
      toast({ title: `Invoice #${invoice.number} voided` })
    } else if (action === "close") {
      closeInvoiceInBackground(workspaceId, invoice)
      toast({ title: `Invoice #${invoice.number} closed`, description: `${formatInvoiceMoney(invoiceAmountPaid(invoice))} stays in your income.` })
    } else {
      setLeaving(true)
      deleteInvoiceInBackground(workspaceId, invoice)
      toast({ title: `Draft #${invoice.number} deleted` })
      router.replace("/app/invoices")
    }
  }

  const depositOverdue =
    !!invoice?.deposit && invoiceDepositOutstanding(invoice) > 0 && !invoice.pendingPayment && invoice.deposit.dueDate < today

  // Not while a bank payment clears: it would land against a changed invoice.
  const editable = (invoice?.status === "draft" || invoice?.status === "sent") && !invoice?.pendingPayment

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading invoice..."
      title={invoice ? `Invoice #${invoice.number}` : "Invoice"}
      backHref="/app/invoices"
      backLabel="Back to invoices"
      action={
        invoice && invoice.status !== "void" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editable ? (
                <DropdownMenuItem asChild>
                  <Link href={`/app/invoices/edit?id=${encodeURIComponent(invoice.id)}`}>Edit</Link>
                </DropdownMenuItem>
              ) : null}
              {(invoice.status === "sent" || invoice.status === "draft") && !invoiceHasPayments(invoice) ? (
                <DropdownMenuItem onSelect={() => setConfirm("void")}>Void invoice</DropdownMenuItem>
              ) : null}
              {invoice.status === "sent" && invoiceHasPayments(invoice) && !invoice.pendingPayment ? (
                <DropdownMenuItem onSelect={() => setConfirm("close")}>Close invoice</DropdownMenuItem>
              ) : null}
              {invoice.status === "draft" ? (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("delete")}>
                  Delete draft
                </DropdownMenuItem>
              ) : null}
              {invoiceDepositOutstanding(invoice) > 0 && !invoice.pendingPayment ? (
                <DropdownMenuItem onSelect={() => onWaiveDeposit()}>Waive deposit</DropdownMenuItem>
              ) : null}
              {invoiceRefundable(invoice) > 0 ? (
                <DropdownMenuItem onSelect={() => openRefund(null)}>
                  {invoiceRefundTarget(invoice)?.via === "online" ? "Refund" : "Record a refund"}
                </DropdownMenuItem>
              ) : null}
              {invoiceHasPayments(invoice) ? (
                <DropdownMenuItem disabled>To undo a payment, delete its income entry</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      {!invoice ? (
        // On its way to the list: just deleted, or a new invoice whose save failed.
        loadStatus === "loading" || leaving || (invoiceId && isTempInvoiceId(invoiceId)) ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-32 w-full rounded-[18px]" />
            <Skeleton className="h-14 w-full rounded-full" />
            <Skeleton className="h-72 w-full rounded-[18px]" />
          </div>
        ) : (
          <div className={cn(cardClass, "text-sm text-muted-foreground")}>
            This invoice wasn&apos;t found.{" "}
            <Link href="/app/invoices" className="font-medium text-foreground underline">
              Back to invoices
            </Link>
          </div>
        )
      ) : (
        <>
          {justCreated && invoice.status === "draft" ? (
            <div className="rounded-[14px] bg-accent px-3.5 py-3 text-sm text-foreground">
              {isTempInvoiceId(invoice.id) ? "Saving your invoice." : `Saved as #${invoice.number}.`} Send it to {invoice.clientName} by email or text, or share a link or PDF.
            </div>
          ) : null}

          <section className={cn(cardClass, "space-y-1 py-[18px]")}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-muted-foreground">{invoice.clientName}</span>
              <InvoiceStatusPill invoice={invoice} today={today} short />
            </div>
            <div className="text-[34px] font-bold leading-tight tracking-tight tabular-nums text-foreground">
              {hasMoneyHistory(invoice) ? (
                <>
                  {formatInvoiceMoney(invoiceKeptAmount(invoice))}{" "}
                  <span className="text-[15px] font-medium text-muted-foreground">kept</span>
                </>
              ) : (
                formatInvoiceMoney(invoice.total)
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {metaLine(invoice)}
              {saving ? <span className="ml-1.5 text-xs">· Saving…</span> : null}
            </div>
          </section>

          {invoice.status === "draft" || invoice.status === "sent" ? (
            <Button
              type="button"
              className="h-[52px] w-full rounded-full text-base font-semibold"
              disabled={busy !== null || !workspaceId}
              onClick={() => setSendOpen(true)}
            >
              <Mail className="size-[18px]" aria-hidden="true" />
              {invoice.lastEmailedAt ? "Send again" : "Send invoice"}
            </Button>
          ) : null}

          {invoice.status !== "void" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-[52px] rounded-full border-card-border bg-card font-semibold"
                disabled={busy !== null}
                onClick={() => void onShareLink()}
              >
                <Link2 className="size-[18px]" aria-hidden="true" />
                {busy === "link" ? "Sharing..." : "Share link"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-[52px] rounded-full border-card-border bg-card font-semibold"
                disabled={busy !== null || !settings}
                onClick={() => void onSharePdf()}
              >
                <FileText className="size-[18px]" aria-hidden="true" />
                {busy === "pdf" ? "Preparing..." : "Share PDF"}
              </Button>
            </div>
          ) : null}

          {workspaceId && invoice.dispute ? (
            <InvoiceDisputeCard invoice={invoice} workspaceId={workspaceId} onSharePdf={() => void onSharePdf()} />
          ) : null}

          {hasMoneyHistory(invoice) ? <InvoiceMoneyBreakdown invoice={invoice} onRefund={openRefund} /> : null}

          {invoice.refunds.length > 0 && invoice.payments.length === 1 && invoiceRefundable(invoice) > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-full border-card-border bg-transparent font-semibold"
              onClick={() => openRefund(null)}
            >
              Refund more
            </Button>
          ) : null}

          {depositOverdue && invoice.deposit ? (
            // Past the deposit's due date: the booking is the user's call.
            <div className="space-y-3 rounded-[14px] bg-red-100 px-3.5 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
              <p>
                {invoice.clientName}&apos;s {formatInvoiceMoney(invoiceDepositOutstanding(invoice))} deposit was due{" "}
                {formatInvoiceDate(invoice.deposit.dueDate)}. Keep the booking without it, or cancel?
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="rounded-full bg-card" onClick={() => onWaiveDeposit()}>
                  Waive deposit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full bg-card"
                  onClick={() => setConfirm(invoiceHasPayments(invoice) ? "close" : "void")}
                >
                  Cancel booking
                </Button>
              </div>
            </div>
          ) : null}

          {invoice.status === "sent" && invoice.paymentFailedAt && !invoice.pendingPayment ? (
            <div className="rounded-[14px] bg-red-100 px-3.5 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
              {invoice.clientName}&apos;s bank payment failed on {formatInvoiceDate(invoice.paymentFailedAt.slice(0, 10))}.
              The invoice is open again — they can pay from the same link.
            </div>
          ) : null}

          {invoice.status === "sent" && invoice.pendingPayment ? (
            // Marking it paid now would make the clearing payment a duplicate
            // (refunded when it lands).
            <div className="rounded-[14px] bg-muted px-3.5 py-3 text-sm text-foreground">
              {invoice.clientName} started a bank payment. It usually clears in about 4 business days, then this
              invoice is marked paid automatically.
            </div>
          ) : editable ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-full border-card-border bg-transparent font-semibold"
              disabled={busy !== null}
              onClick={() => setPaymentOpen(true)}
            >
              <Check className="size-[18px]" aria-hidden="true" />
              {invoiceHasPayments(invoice) ? "Record a payment" : "Mark as paid"}
            </Button>
          ) : null}

          {invoice.status === "sent" && !invoice.pendingPayment ? (
            <div className="flex items-start gap-2.5 rounded-[14px] bg-accent px-3.5 py-3 text-sm leading-relaxed text-foreground">
              <Landmark className="mt-0.5 size-[18px] shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>
                {payableOnline
                  ? "Your client can pay by card from the link — it's marked paid here automatically. Paid another way? A matching bank deposit shows up for you to confirm."
                  : "When a matching deposit lands in your connected bank, we'll ask you to confirm it as this payment — no need to mark it paid yourself."}
              </span>
            </div>
          ) : null}

          <InvoicePreview invoice={invoice} settings={settings} />

          <section aria-label="History" className="space-y-2 px-1 pb-2 text-sm text-muted-foreground">
            {[...invoice.refunds].reverse().map((refund) => (
              <div key={refund.id} className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-red-600" aria-hidden="true" />
                Refunded {formatInvoiceMoney(refund.amount)} · {formatInvoiceDate(refund.date)}
              </div>
            ))}
            {invoice.dispute ? (
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-red-600" aria-hidden="true" />
                Dispute {invoice.dispute.status === "won" ? "won" : invoice.dispute.status === "lost" ? "lost" : "opened"} ·{" "}
                {formatInvoiceDate(invoice.dispute.updatedAt.slice(0, 10))}
              </div>
            ) : null}
            {[...invoice.payments].reverse().map((payment) => (
              <div key={payment.id} className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                Paid · {formatInvoiceDate(payment.receivedOn)}
                {payment.feeAmount > 0
                  ? ` · ${payment.via === "online" ? "Stripe kept" : "processing fee"} ${formatInvoiceMoney(payment.feeAmount)}`
                  : ""}
              </div>
            ))}
            {invoice.lastEmailedAt ? (
              <div className="flex items-center gap-2.5">
                <span className={cn("size-2 rounded-full", invoiceHasPayments(invoice) ? "bg-input" : "bg-primary")} aria-hidden="true" />
                <span className="min-w-0 truncate">
                  Emailed to {invoice.lastEmailedTo} · {formatMoment(invoice.lastEmailedAt)}
                </span>
              </div>
            ) : null}
            {invoice.sharedAt ? (
              <div className="flex items-center gap-2.5">
                <span
                  className={cn("size-2 rounded-full", invoiceHasPayments(invoice) || invoice.lastEmailedAt ? "bg-input" : "bg-primary")}
                  aria-hidden="true"
                />
                Link shared · {formatMoment(invoice.sharedAt)}
              </div>
            ) : null}
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-input" aria-hidden="true" />
              Created · {formatMoment(invoice.createdAt)}
            </div>
          </section>

          {workspaceId ? (
            <RecordPaymentSheet open={paymentOpen} onOpenChange={setPaymentOpen} invoice={invoice} workspaceId={workspaceId} />
          ) : null}
          {workspaceId && (invoice.status === "draft" || invoice.status === "sent") ? (
            <SendInvoiceSheet
              open={sendOpen}
              onOpenChange={setSendOpen}
              invoice={invoice}
              settings={settings}
              workspaceId={workspaceId}
            />
          ) : null}
          {workspaceId && invoiceHasPayments(invoice) ? (
            <RefundSheet
              open={refundOpen}
              onOpenChange={setRefundOpen}
              invoice={invoice}
              workspaceId={workspaceId}
              paymentId={refundPaymentId}
            />
          ) : null}

          <Dialog open={manualLink !== null} onOpenChange={(open) => !open && setManualLink(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Invoice link</DialogTitle>
                <DialogDescription>Send this to {invoice.clientName} in a text or email.</DialogDescription>
              </DialogHeader>
              <input
                readOnly
                value={manualLink ?? ""}
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 w-full rounded-xl border-0 bg-muted px-3 text-sm text-foreground"
                aria-label="Invoice link"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="h-11 flex-1 rounded-full font-semibold"
                  onClick={() => {
                    if (!manualLink) return
                    // A fresh tap, so the clipboard is allowed now.
                    navigator.clipboard
                      .writeText(manualLink)
                      .then(() => {
                        toast({ title: "Link copied" })
                        setManualLink(null)
                      })
                      .catch(() => toast({ title: "Select the link above and copy it", variant: "destructive" }))
                  }}
                >
                  Copy link
                </Button>
                <Button asChild type="button" variant="outline" className="h-11 flex-1 rounded-full font-semibold">
                  <a href={manualLink ?? "#"} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm === "delete"
                    ? `Delete draft #${invoice.number}?`
                    : confirm === "close"
                      ? `Close invoice #${invoice.number}?`
                      : `Void invoice #${invoice.number}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "delete"
                    ? "The draft is removed for good."
                    : confirm === "close"
                      ? `The ${formatInvoiceMoney(invoiceAmountPaid(invoice))} already paid stays in your income, and the ${formatInvoiceMoney(invoiceBalanceDue(invoice))} left is no longer owed. Its link tells the client nothing more is due. This can't be undone.`
                      : "It stays in your list marked Void, and its link tells the client nothing is owed. This can't be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => confirm && onConfirmAction(confirm)}>
                  {confirm === "delete" ? "Delete draft" : confirm === "close" ? "Close invoice" : "Void invoice"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </InvoicesPage>
  )
}
