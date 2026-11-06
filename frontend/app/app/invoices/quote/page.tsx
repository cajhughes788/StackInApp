"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, FileText, Link2, Mail, MoreHorizontal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
import SendQuoteSheet from "@/components/invoices/send-quote-sheet"
import { InvoicesPage, QuoteStatusPill, cardClass, localToday, useInvoicesWorkspace, useQueryParam } from "@/components/invoices/invoice-ui"
import { deleteQuote, updateQuoteStatus } from "@/lib/api/quotesApi"
import { shareLink } from "@/lib/documentExport"
import { useQuotesStore, useWorkspaceQuotes } from "@/lib/stores/useQuotesStore"
import { cn } from "@/lib/utils"
import { formatInvoiceDate, formatInvoiceMoney, formatInvoiceQuantity } from "@shared/invoiceDisplay"
import { publicQuoteUrl, quoteNumberLabel } from "@shared/quotes"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings } from "@shared/schemas/invoice"
import type { QuoteType } from "@shared/schemas/quote"

// One quote: where it stands, the client's answer, and what to do next —
// send it, turn it into an invoice, or withdraw / delete it.

export default function QuotePageRoute() {
  return (
    <Suspense fallback={null}>
      <QuotePage />
    </Suspense>
  )
}

function QuotePage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, workspaceId, invoices, settings } = useInvoicesWorkspace()
  const { quotes, status } = useWorkspaceQuotes(workspaceId)
  const upsertQuote = useQuotesStore((state) => state.upsertQuote)
  const removeQuote = useQuotesStore((state) => state.removeQuote)
  const quoteId = useQueryParam("id")
  const quote = quotes.find((q) => q.id === quoteId) ?? null
  const today = localToday()
  const [sendOpen, setSendOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | "withdraw" | "delete">(null)
  const [busy, setBusy] = useState<null | "link" | "withdraw" | "delete">(null)

  // A push about the client's answer opens here: get their answer, not the cached copy.
  const refreshed = useRef(false)
  useEffect(() => {
    if (!workspaceId || refreshed.current || status !== "ready") return
    refreshed.current = true
    void useQuotesStore.getState().load(workspaceId, { force: true }).catch(() => {})
  }, [status, workspaceId])

  // A new quote lands here on its send step (?share=1).
  const shareParam = useQueryParam("share")
  const openedSend = useRef(false)
  useEffect(() => {
    if (shareParam === "1" && quote && !openedSend.current) {
      openedSend.current = true
      setSendOpen(true)
      router.replace(`/app/invoices/quote?id=${encodeURIComponent(quote.id)}`, { scroll: false })
    }
  }, [quote, router, shareParam])

  async function onShareLink() {
    if (!workspaceId || !quote) return
    setBusy("link")
    try {
      let current = quote
      if (!current.shareToken || current.status === "draft") {
        current = (await updateQuoteStatus(workspaceId, quote.id, { action: "share" })).quote
        upsertQuote(workspaceId, current)
      }
      const result = await shareLink(
        publicQuoteUrl(current.shareToken!),
        `Quote ${quoteNumberLabel(current.number)}`,
        `Quote ${quoteNumberLabel(current.number)} from ${settings?.businessName || "me"}: ${formatInvoiceMoney(current.total)}`
      )
      if (result === "copied") toast({ title: "Link copied", description: "Paste it anywhere to send the quote." })
    } catch (error) {
      toast({ title: "Couldn't get the link", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  async function onConfirm() {
    if (!workspaceId || !quote || !confirm) return
    const action = confirm
    setConfirm(null)
    setBusy(action)
    try {
      if (action === "delete") {
        await deleteQuote(workspaceId, quote.id)
        removeQuote(workspaceId, quote.id)
        router.replace("/app/invoices?filter=quotes")
        return
      }
      upsertQuote(workspaceId, (await updateQuoteStatus(workspaceId, quote.id, { action: "withdraw" })).quote)
      toast({ title: "Quote withdrawn", description: "The client's link now says it was withdrawn." })
    } catch (error) {
      toast({
        title: action === "delete" ? "Couldn't delete the quote" : "Couldn't withdraw the quote",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const invoice = quote?.invoiceId ? invoices.find((i) => i.id === quote.invoiceId) ?? null : null
  const editable = quote?.status === "draft" || quote?.status === "sent"
  const canInvoice = !!quote && quote.status !== "invoiced" && quote.status !== "withdrawn"

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading quote..."
      title={quote ? `Quote ${quoteNumberLabel(quote.number)}` : "Quote"}
      backHref="/app/invoices?filter=quotes"
      backLabel="Quotes"
      action={
        quote && (editable || quote.status === "accepted") ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editable ? (
                <DropdownMenuItem asChild>
                  <Link href={`/app/invoices/edit?kind=quote&id=${encodeURIComponent(quote.id)}`}>Edit</Link>
                </DropdownMenuItem>
              ) : null}
              {quote.status === "draft" ? (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("delete")}>
                  Delete draft
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("withdraw")}>
                  Withdraw quote
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      {!quote ? (
        status === "loading" ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-28 w-full rounded-[18px]" />
            <Skeleton className="h-64 w-full rounded-[18px]" />
          </div>
        ) : (
          <div className={cn(cardClass, "text-sm text-muted-foreground")}>This quote wasn&apos;t found.</div>
        )
      ) : (
        <>
          <section className={cn(cardClass, "space-y-1")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-foreground">{quote.clientName}</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">{formatInvoiceMoney(quote.total)}</div>
              </div>
              <QuoteStatusPill quote={quote} today={today} />
            </div>
            <div className="text-sm text-muted-foreground">
              {formatInvoiceDate(quote.issueDate)} · valid until {formatInvoiceDate(quote.validUntil)}
              {quote.deposit ? ` · ${formatInvoiceMoney(quote.deposit.amount)} deposit` : ""}
            </div>
          </section>

          {quote.status === "accepted" || (quote.status === "invoiced" && quote.acceptedAt) ? (
            <div className="flex items-start gap-3 rounded-[18px] bg-accent p-4 text-sm text-foreground">
              <Check className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>
                <span className="block font-semibold">Accepted{quote.acceptedName ? ` by ${quote.acceptedName}` : ""}</span>
                {quote.acceptedAt ? <span className="text-muted-foreground">{formatInvoiceDate(quote.acceptedAt.slice(0, 10))}</span> : null}
              </span>
            </div>
          ) : quote.status === "declined" ? (
            <div className="flex items-start gap-3 rounded-[18px] bg-muted p-4 text-sm text-foreground">
              <X className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-semibold">
                  Declined{quote.declinedAt ? ` ${formatInvoiceDate(quote.declinedAt.slice(0, 10))}` : ""}
                </span>
                {quote.declineNote ? <span className="text-muted-foreground">&ldquo;{quote.declineNote}&rdquo;</span> : null}
              </span>
            </div>
          ) : null}

          {quote.status === "invoiced" && quote.invoiceId ? (
            <Button asChild className="h-[52px] w-full rounded-full text-base font-semibold">
              <Link href={`/app/invoices/view?id=${encodeURIComponent(quote.invoiceId)}`}>
                <FileText className="size-[18px]" aria-hidden="true" />
                {invoice && invoice.number !== "…" ? `View invoice #${invoice.number}` : "View invoice"}
              </Link>
            </Button>
          ) : null}

          {canInvoice ? (
            <Button
              asChild
              variant={quote.status === "accepted" ? "default" : "outline"}
              className={cn(
                "h-[52px] w-full rounded-full text-base font-semibold",
                quote.status !== "accepted" && "border-card-border bg-card"
              )}
            >
              <Link href={`/app/invoices/edit?fromQuote=${encodeURIComponent(quote.id)}`}>
                <FileText className="size-[18px]" aria-hidden="true" />
                Turn into invoice
              </Link>
            </Button>
          ) : null}

          {editable && workspaceId ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant={quote.status === "draft" ? "default" : "outline"}
                className={cn("h-[52px] rounded-full font-semibold", quote.status !== "draft" && "border-card-border bg-card")}
                disabled={busy !== null}
                onClick={() => setSendOpen(true)}
              >
                <Mail className="size-[18px]" aria-hidden="true" />
                {quote.status === "draft" ? "Send quote" : "Send again"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-[52px] rounded-full border-card-border bg-card font-semibold"
                disabled={busy !== null}
                onClick={() => void onShareLink()}
              >
                <Link2 className="size-[18px]" aria-hidden="true" />
                {busy === "link" ? "Getting link..." : "Share link"}
              </Button>
            </div>
          ) : null}

          <QuotePreview quote={quote} settings={settings} />

          {workspaceId ? (
            <SendQuoteSheet open={sendOpen} onOpenChange={setSendOpen} quote={quote} settings={settings} workspaceId={workspaceId} />
          ) : null}

          <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirm === "delete" ? "Delete this draft?" : `Withdraw quote ${quoteNumberLabel(quote.number)}?`}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "delete"
                    ? "It hasn't been sent, so nobody has seen it."
                    : `${quote.clientName} won't be able to accept it, and their link will say it was withdrawn.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onConfirm()}>{confirm === "delete" ? "Delete" : "Withdraw"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </InvoicesPage>
  )
}

// What the client sees, in miniature (as InvoicePreview).
function QuotePreview({ quote, settings }: { quote: QuoteType; settings: InvoiceSettings | null }) {
  const accent = settings?.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  return (
    <section aria-label="Quote preview" className="overflow-hidden rounded-[18px] border border-card-border bg-white text-[#161B1E]">
      <div style={{ height: 5, background: accent }} />
      <div className="space-y-3 p-4 text-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 truncate text-[15px] font-semibold">{settings?.businessName || "Your business name"}</div>
          <div className="text-right">
            <div className="font-bold tracking-wide" style={{ color: accent }}>
              QUOTE
            </div>
            <div className="text-[#5F6864]">{quoteNumberLabel(quote.number)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["PREPARED FOR", quote.clientName],
            ["DATE", formatInvoiceDate(quote.issueDate)],
            ["VALID UNTIL", formatInvoiceDate(quote.validUntil)],
          ].map(([label, value]) => (
            <div key={label} className={cn("min-w-0", label === "PREPARED FOR" && "col-span-2")}>
              <div className="text-[10px] font-semibold tracking-wide text-[#5F6864]">{label}</div>
              <div className="break-words">{value}</div>
            </div>
          ))}
        </div>
        <div>
          {quote.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-3 border-b border-[#ECEBE6] py-2 last:border-0">
              <span className="min-w-0 break-words">
                {line.description}
                {line.quantity !== 1 ? (
                  <span className="block tabular-nums text-[#5F6864]">
                    {formatInvoiceQuantity(line.quantity)} × {formatInvoiceMoney(line.rate)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatInvoiceMoney(line.amount)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[15px] font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatInvoiceMoney(quote.total)}</span>
        </div>
        {quote.deposit ? <div className="text-[#5F6864]">{formatInvoiceMoney(quote.deposit.amount)} deposit up front once booked</div> : null}
        {quote.note ? (
          <div className="whitespace-pre-line rounded-[10px] bg-[#FAFAF8] px-3 py-2.5">
            <span className="mb-1 block text-[10px] font-semibold tracking-wide text-[#5F6864]">NOTE</span>
            {quote.note}
          </div>
        ) : null}
        {quote.policies ? (
          <div className="whitespace-pre-wrap break-words text-[#5F6864]">
            <span className="mb-1 block text-[10px] font-semibold tracking-wide">POLICIES &amp; TERMS</span>
            {quote.policies}
          </div>
        ) : null}
      </div>
    </section>
  )
}
