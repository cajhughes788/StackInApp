"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Capacitor } from "@capacitor/core"
import { Mail, MessageSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { updateInvoiceStatus } from "@/lib/api/invoicesApi"
import { emailInvoiceInBackground, invoiceSaved, latestInvoice } from "@/lib/domain/invoiceService"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { formatInvoiceDate, formatInvoiceMoney, publicInvoiceUrl } from "@shared/invoiceDisplay"
import { invoiceBalanceDue } from "@shared/invoicePayments"
import type { InvoiceSettings, InvoiceType } from "@shared/schemas/invoice"

// Getting an invoice to the client: 521 emails it (from "<Business> via 521",
// replies to the business email), or a pre-filled text in Messages. Both
// share the invoice first, which sends a draft.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// iOS wants "sms:<number>&body=", everything else "sms:<number>?body=".
function smsHref(phone: string, body: string): string {
  const number = phone.replace(/[^\d+]/g, "")
  const ios = Capacitor.getPlatform() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent)
  return `sms:${number}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`
}

export default function SendInvoiceSheet({
  open,
  onOpenChange,
  invoice,
  settings,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceType
  settings: InvoiceSettings | null
  workspaceId: string
}) {
  const { toast } = useToast()
  const upsertInvoice = useInvoicesStore((state) => state.upsertInvoice)
  const [to, setTo] = useState("")
  const [message, setMessage] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState<null | "text">(null)

  useEffect(() => {
    if (!open) return
    setTo(invoice.clientEmail ?? "")
    setPhone(invoice.clientPhone ?? "")
    setMessage("")
    setBusy(null)
  }, [open, invoice.clientEmail, invoice.clientPhone])

  const emailValid = EMAIL_RE.test(to.trim())
  const business = settings?.businessName || "me"
  const amount = formatInvoiceMoney(invoiceBalanceDue(invoice))
  const due = formatInvoiceDate(invoice.dueDate).replace(/, \d{4}$/, "")

  // Sent in the background (invoiceService): the invoice shows as emailed
  // at once, and a new one still saving is emailed once it's saved.
  function sendEmail() {
    if (!emailValid) return
    emailInvoiceInBackground(workspaceId, invoice, { to: to.trim(), ...(message.trim() ? { message: message.trim() } : {}) })
    onOpenChange(false)
  }

  async function sendText() {
    if (!phone.trim()) return
    setBusy("text")
    try {
      // The text needs the link, which sharing creates (on the saved invoice).
      const id = await invoiceSaved(invoice.id)
      const current = latestInvoice(workspaceId, id) ?? invoice
      let url = current.shareToken && current.status !== "draft" ? publicInvoiceUrl(current.shareToken) : null
      if (!url) {
        const result = await updateInvoiceStatus(workspaceId, id, { action: "share" })
        upsertInvoice(workspaceId, result.invoice)
        url = result.shareUrl ?? publicInvoiceUrl(result.invoice.shareToken!)
      }
      window.location.href = smsHref(phone, `Invoice #${invoice.number} from ${business}: ${amount} due ${due}. ${url}`)
      onOpenChange(false)
    } catch (error) {
      toast({
        title: "Couldn't open Messages",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // The address is usually prefilled — don't pop the keyboard over it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="mx-auto max-w-lg gap-0 rounded-t-[22px] border-x border-t border-card-border bg-card px-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="px-0 pb-4 pt-1 text-left">
          <SheetTitle className="text-xl">Send invoice #{invoice.number}</SheetTitle>
          <SheetDescription>
            {invoice.clientName} · {amount} due {due}
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
              placeholder="Thanks for your business!"
              className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
            />
          </label>
          <Button
            type="button"
            className="h-[52px] w-full rounded-full text-base font-semibold"
            disabled={!emailValid || busy !== null}
            onClick={() => sendEmail()}
          >
            <Mail className="size-[18px]" aria-hidden="true" />
            Email invoice
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sent from &ldquo;{settings?.businessName || "521"} via 521&rdquo; with a link to the invoice.{" "}
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
