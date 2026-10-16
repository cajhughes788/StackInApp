"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, FileText, Landmark, Link2, MoreHorizontal } from "lucide-react"

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
import MarkPaidSheet from "@/components/invoices/mark-paid-sheet"
import RefundSheet from "@/components/invoices/refund-sheet"
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
  readQueryParam,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import { deleteInvoice, updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { shareLink } from "@/lib/documentExport"
import { shareInvoicePdf } from "@/lib/invoicePdf"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import {
  INVOICE_TERMS_LABELS,
  dueDateForTerms,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceBalanceDue,
  publicInvoiceUrl,
} from "@shared/invoiceDisplay"
import { invoiceRefundableAmount, type InvoiceTerms, type InvoiceType } from "@shared/schemas/invoice"

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
    case "paid": {
      const parts = [invoice.paidAt ? `Paid ${formatInvoiceDate(invoice.paidAt.slice(0, 10))}` : "Paid"]
      if (invoice.paidVia === "bank_match") parts.push("matched from your bank")
      else if (invoice.paidVia === "online") parts.push(invoice.paidMethod === "other" ? "paid by bank transfer" : "paid online")
      else if (invoice.paidMethod) parts.push(PAID_METHOD_LABELS[invoice.paidMethod])
      return parts.join(" · ")
    }
    case "sent":
      if (invoice.pendingPaymentAt) {
        return `Bank payment processing · started ${formatInvoiceDate(invoice.pendingPaymentAt.slice(0, 10))}`
      }
      return [invoice.sharedAt ? `Shared ${formatInvoiceDate(invoice.sharedAt.slice(0, 10))}` : "Sent", termsLabel(invoice)]
        .filter(Boolean)
        .join(" · ")
  }
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, workspaceId, invoices, settings, loadStatus } = useInvoicesWorkspace()
  const paymentAccount = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.paymentAccount ?? null : null))
  const payableOnline = !!paymentAccount?.chargesEnabled && !!paymentAccount.acceptOnline
  const upsertInvoice = useInvoicesStore((state) => state.upsertInvoice)
  const removeInvoice = useInvoicesStore((state) => state.removeInvoice)
  const [invoiceId] = useState(() => readQueryParam("id"))
  const [justCreated] = useState(() => readQueryParam("share") === "1")
  const invoice = invoices.find((i) => i.id === invoiceId) ?? null
  const [busy, setBusy] = useState<null | "link" | "pdf" | "void" | "delete">(null)
  const [markPaidOpen, setMarkPaidOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | "void" | "delete">(null)
  const today = localToday()

  // Creates the link the first time (and sends a draft). Returns the latest invoice.
  async function ensureShared(current: InvoiceType): Promise<{ invoice: InvoiceType; url: string }> {
    if (current.shareToken && current.status !== "draft") {
      return { invoice: current, url: publicInvoiceUrl(current.shareToken) }
    }
    const result = await updateInvoiceStatus(workspaceId!, current.id, { action: "share" })
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

  async function onConfirmAction(action: "void" | "delete") {
    if (!invoice || !workspaceId) return
    setConfirm(null)
    setBusy(action)
    try {
      if (action === "void") {
        const { invoice: voided } = await updateInvoiceStatus(workspaceId, invoice.id, { action: "void" })
        upsertInvoice(workspaceId, voided)
        toast({ title: `Invoice #${invoice.number} voided` })
      } else {
        await deleteInvoice(workspaceId, invoice.id)
        removeInvoice(workspaceId, invoice.id)
        toast({ title: `Draft #${invoice.number} deleted` })
        router.replace("/app/invoices")
      }
    } catch (error) {
      toast({
        title: action === "void" ? "Couldn't void the invoice" : "Couldn't delete the draft",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  // Not while a bank payment clears: it would land against a changed invoice.
  const editable = (invoice?.status === "draft" || invoice?.status === "sent") && !invoice?.pendingPaymentAt

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
              {invoice.status === "sent" || invoice.status === "draft" ? (
                <DropdownMenuItem onSelect={() => setConfirm("void")}>Void invoice</DropdownMenuItem>
              ) : null}
              {invoice.status === "draft" ? (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("delete")}>
                  Delete draft
                </DropdownMenuItem>
              ) : null}
              {invoice.status === "paid" && invoiceRefundableAmount(invoice) > 0 ? (
                <DropdownMenuItem onSelect={() => setRefundOpen(true)}>
                  {invoice.paidVia === "online" ? "Refund" : "Record a refund"}
                </DropdownMenuItem>
              ) : null}
              {invoice.status === "paid" ? (
                <DropdownMenuItem disabled>To undo a payment, delete its income entry</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      {!invoice ? (
        loadStatus === "loading" ? (
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
              Saved as #{invoice.number}. Share it with {invoice.clientName} as a link or a PDF.
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
            <div className="text-sm text-muted-foreground">{metaLine(invoice)}</div>
          </section>

          {invoice.status !== "void" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                className="h-[52px] rounded-full font-semibold"
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

          {hasMoneyHistory(invoice) ? <InvoiceMoneyBreakdown invoice={invoice} /> : null}

          {invoice.refunds.length > 0 && invoiceRefundableAmount(invoice) > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-full border-card-border bg-transparent font-semibold"
              onClick={() => setRefundOpen(true)}
            >
              Refund more
            </Button>
          ) : null}

          {invoice.status === "sent" && invoice.paymentFailedAt && !invoice.pendingPaymentAt ? (
            <div className="rounded-[14px] bg-red-100 px-3.5 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
              {invoice.clientName}&apos;s bank payment failed on {formatInvoiceDate(invoice.paymentFailedAt.slice(0, 10))}.
              The invoice is open again — they can pay from the same link.
            </div>
          ) : null}

          {invoice.status === "sent" && invoice.pendingPaymentAt ? (
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
              onClick={() => setMarkPaidOpen(true)}
            >
              <Check className="size-[18px]" aria-hidden="true" />
              Mark as paid
            </Button>
          ) : null}

          {invoice.status === "sent" && !invoice.pendingPaymentAt ? (
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
            {invoice.paidAt ? (
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                Paid · {formatInvoiceDate(invoice.paidAt.slice(0, 10))}
                {invoice.paidFeeAmount > 0
                  ? ` · ${invoice.paidVia === "online" ? "Stripe kept" : "processing fee"} ${formatInvoiceMoney(invoice.paidFeeAmount)}`
                  : ""}
              </div>
            ) : null}
            {invoice.sharedAt ? (
              <div className="flex items-center gap-2.5">
                <span className={cn("size-2 rounded-full", invoice.paidAt ? "bg-input" : "bg-primary")} aria-hidden="true" />
                Link shared · {formatMoment(invoice.sharedAt)}
              </div>
            ) : null}
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-input" aria-hidden="true" />
              Created · {formatMoment(invoice.createdAt)}
            </div>
          </section>

          {workspaceId ? (
            <MarkPaidSheet open={markPaidOpen} onOpenChange={setMarkPaidOpen} invoice={invoice} workspaceId={workspaceId} />
          ) : null}
          {workspaceId && invoice.status === "paid" ? (
            <RefundSheet open={refundOpen} onOpenChange={setRefundOpen} invoice={invoice} workspaceId={workspaceId} />
          ) : null}

          <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm === "delete" ? `Delete draft #${invoice.number}?` : `Void invoice #${invoice.number}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "delete"
                    ? "The draft is removed for good."
                    : "It stays in your list marked Void, and its link tells the client nothing is owed. This can't be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => confirm && void onConfirmAction(confirm)}>
                  {confirm === "delete" ? "Delete draft" : "Void invoice"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </InvoicesPage>
  )
}
