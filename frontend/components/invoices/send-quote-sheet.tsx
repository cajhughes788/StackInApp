"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Mail, MessageSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { updateQuoteStatus } from "@/lib/api/quotesApi"
import { useQuotesStore } from "@/lib/stores/useQuotesStore"
import { smsHref } from "@/lib/smsLink"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import { publicQuoteUrl, quoteNumberLabel } from "@shared/quotes"
import type { InvoiceSettings } from "@shared/schemas/invoice"
import type { QuoteType } from "@shared/schemas/quote"

// Getting a quote to the client, like SendInvoiceSheet: 521 emails it (from
// "<Business> via 521"), or a pre-filled text in Messages. Both share the
// quote first, which sends a draft. Quotes wait for the server, so this does too.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SendQuoteSheet({
  open,
  onOpenChange,
  quote,
  settings,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quote: QuoteType
  settings: InvoiceSettings | null
  workspaceId: string
}) {
  const { toast } = useToast()
  const upsertQuote = useQuotesStore((state) => state.upsertQuote)
  const [to, setTo] = useState("")
  const [message, setMessage] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState<null | "email" | "text">(null)

  useEffect(() => {
    if (!open) return
    setTo(quote.clientEmail ?? "")
    setPhone(quote.clientPhone ?? "")
    setMessage("")
    setBusy(null)
  }, [open, quote.clientEmail, quote.clientPhone])

  const emailValid = EMAIL_RE.test(to.trim())
  const label = quoteNumberLabel(quote.number)
  const total = formatInvoiceMoney(quote.total)
  const validUntil = formatInvoiceDate(quote.validUntil).replace(/, \d{4}$/, "")

  async function sendEmail() {
    if (!emailValid) return
    setBusy("email")
    try {
      const result = await updateQuoteStatus(workspaceId, quote.id, {
        action: "email",
        to: to.trim(),
        ...(message.trim() ? { message: message.trim() } : {}),
      })
      upsertQuote(workspaceId, result.quote)
      toast({ title: "Quote sent", description: `Emailed to ${to.trim()}.` })
      onOpenChange(false)
    } catch (error) {
      toast({ title: "Couldn't email the quote", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  async function sendText() {
    if (!phone.trim()) return
    setBusy("text")
    try {
      let url = quote.shareToken && quote.status !== "draft" ? publicQuoteUrl(quote.shareToken) : null
      if (!url) {
        const result = await updateQuoteStatus(workspaceId, quote.id, { action: "share" })
        upsertQuote(workspaceId, result.quote)
        url = result.shareUrl ?? publicQuoteUrl(result.quote.shareToken!)
      }
      const business = settings?.businessName || "me"
      window.location.href = smsHref(phone, `Quote ${label} from ${business}: ${total}, valid until ${validUntil}. View and accept it here: ${url}`)
      onOpenChange(false)
    } catch (error) {
      toast({ title: "Couldn't open Messages", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">Send quote {label}</SheetTitle>
          <SheetDescription>
            {quote.clientName} · {total} · valid until {validUntil}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <label className={fieldLabelClass}>
            Client email
            <input
              type="email"
              inputMode="email"
              className={softInputClass}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="client@example.com"
              maxLength={254}
              autoComplete="off"
            />
          </label>
          <label className={fieldLabelClass}>
            Message (optional)
            <Textarea
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              placeholder="Thanks for considering us!"
              className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
            />
          </label>
          <Button
            type="button"
            className="h-[52px] w-full rounded-full text-base font-semibold"
            disabled={!emailValid || busy !== null}
            onClick={() => void sendEmail()}
          >
            <Mail className="size-[18px]" aria-hidden="true" />
            {busy === "email" ? "Sending..." : "Email quote"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sent from &ldquo;{settings?.businessName || "521"} via 521&rdquo; with a link to view and accept the quote.{" "}
            {settings?.businessEmail ? (
              <>Replies go to {settings.businessEmail}.</>
            ) : (
              <>
                <Link href="/app/invoices/settings" className="font-medium text-foreground underline">
                  Add your email
                </Link>{" "}
                so client replies reach you.
              </>
            )}
          </p>

          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex items-end gap-2">
            <label className={`${fieldLabelClass} flex-1`}>
              Client phone
              <input
                type="tel"
                className={softInputClass}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(555) 123-4567"
                maxLength={40}
                autoComplete="off"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 rounded-full border-card-border px-4 font-semibold"
              disabled={!phone.trim() || busy !== null}
              onClick={() => void sendText()}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              {busy === "text" ? "Opening..." : "Text it"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
