"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Copy, QrCode, Share2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cardClass, fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { shareLink } from "@/lib/documentExport"
import { cn } from "@/lib/utils"
import { PUBLIC_BOOKING_BASE_URL, bookingSlugFrom, bookingSlugProblem, publicBookingUrl } from "@shared/onlineBooking"

// Booking setup's "Online booking": the public booking page's on/off switch
// and link name, and — once saved and on — the link to copy, share or show
// as a QR code.
export function OnlineBookingSection({
  enabled,
  slug,
  savedEnabled,
  savedSlug,
  businessName,
  hasActiveService,
  onChange,
}: {
  enabled: boolean
  slug: string
  // What's saved: the link only works once it's saved and on.
  savedEnabled: boolean
  savedSlug: string
  businessName: string
  hasActiveService: boolean
  onChange: (patch: { onlineBookingEnabled?: boolean; bookingSlug?: string }) => void
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const problem = slug ? bookingSlugProblem(slug) : enabled ? "Pick a link." : null
  const live = savedEnabled && !!savedSlug && savedSlug === slug && enabled
  const url = live ? publicBookingUrl(savedSlug) : null

  useEffect(() => {
    if (!url || !showQr) return
    let cancelled = false
    void QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 640 }).then((data) => {
      if (!cancelled) setQr(data)
    })
    return () => {
      cancelled = true
    }
  }, [url, showQr])

  async function share() {
    if (!url) return
    const result = await shareLink(url, "Book with me", `Book with ${businessName || "me"} online:`)
    setNote(result === "copied" ? "Link copied." : result === "unavailable" ? url : null)
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setNote("Link copied.")
    } catch {
      setNote(url)
    }
  }

  return (
    <section className={cn(cardClass, "space-y-3")}>
      <h2 className="text-sm font-semibold text-muted-foreground">Online booking</h2>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Take bookings online</span>
          <span className="block text-xs text-muted-foreground">
            Customers pick a service and an open time from your link. Bookings are instant; a deposit is paid by card first.
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            onChange({ onlineBookingEnabled: checked, ...(checked && !slug ? { bookingSlug: bookingSlugFrom(businessName) } : {}) })
          }
          aria-label="Take bookings online"
        />
      </label>
      {!hasActiveService && enabled ? (
        <p className="text-sm text-destructive">Add a service customers can book first.</p>
      ) : null}
      <label className={fieldLabelClass}>
        Your link
        <span className={cn(softInputClass, "flex items-center gap-0 pr-2")}>
          <span className="shrink-0 text-muted-foreground">{PUBLIC_BOOKING_BASE_URL.replace(/^https:\/\//, "")}</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
            value={slug}
            onChange={(event) => onChange({ bookingSlug: event.target.value.toLowerCase().replace(/\s+/g, "-").slice(0, 40) })}
            placeholder={bookingSlugFrom(businessName) || "your-name"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Booking link name"
          />
        </span>
      </label>
      {problem ? (
        <p className="text-xs text-destructive">{problem}</p>
      ) : savedSlug && slug !== savedSlug ? (
        <p className="text-xs text-muted-foreground">Save to switch to the new link. The old one stops working.</p>
      ) : null}
      {url ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-full" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden="true" />
              Copy
            </Button>
            <Button type="button" variant="outline" className="h-10 rounded-full" onClick={() => void share()}>
              <Share2 className="size-4" aria-hidden="true" />
              Share
            </Button>
            <Button type="button" variant="outline" className="h-10 rounded-full" onClick={() => setShowQr((open) => !open)}>
              <QrCode className="size-4" aria-hidden="true" />
              QR
            </Button>
          </div>
          {note ? <p className="break-all text-center text-sm text-muted-foreground">{note}</p> : null}
          {showQr ? (
            <div className="rounded-[14px] bg-white p-4 text-center">
              {qr ? <img src={qr} alt={`QR code for ${url}`} className="mx-auto w-full max-w-[240px]" /> : null}
              <p className="mt-2 break-all text-xs text-neutral-600">{url}</p>
            </div>
          ) : null}
        </div>
      ) : enabled && !problem ? (
        <p className="text-xs text-muted-foreground">Save to turn on your link.</p>
      ) : null}
    </section>
  )
}
