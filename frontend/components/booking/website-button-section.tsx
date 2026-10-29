"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cardClass, fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import {
  BOOKING_BUTTON_LABEL_MAX,
  DEFAULT_BOOKING_BUTTON_LABEL,
  bookingButtonCode,
  websiteBookingUrl,
} from "@shared/onlineBooking"
import { DEFAULT_INVOICE_ACCENT_COLOR } from "@shared/schemas/invoice"

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const STEPS: Array<{ name: string; how: string }> = [
  { name: "Squarespace", how: "Edit a page, add a Code block, and paste." },
  { name: "Wix", how: "Add › Embed code › Embed HTML, and paste." },
  { name: "Shopify", how: "Customize your theme, add a Custom Liquid section, and paste." },
  { name: "Anything else", how: "Paste it wherever your site lets you add HTML." },
]

// Booking setup's "Add to your website": a "Book now" button the owner
// pastes into their own site. It's a plain styled link (bookingButtonCode)
// that opens their booking page in a new tab, marked as from their website.
// The label and color aren't saved; they only shape the code to copy.
export function WebsiteButtonSection({ slug, accentColor }: { slug: string; accentColor: string }) {
  const brand = HEX_RE.test(accentColor) ? accentColor.toUpperCase() : DEFAULT_INVOICE_ACCENT_COLOR
  const swatches = useMemo(
    () =>
      [
        { hex: brand, label: "Your color" },
        { hex: DEFAULT_INVOICE_ACCENT_COLOR, label: "521 green" },
        { hex: "#161B1E", label: "Charcoal" },
      ].filter((swatch, at, all) => all.findIndex((other) => other.hex === swatch.hex) === at),
    [brand]
  )
  const [label, setLabel] = useState(DEFAULT_BOOKING_BUTTON_LABEL)
  const [color, setColor] = useState(brand)
  const [hexText, setHexText] = useState(brand)
  const [note, setNote] = useState<string | null>(null)
  // Folded until the owner wants it: most won't paste code anywhere.
  const [open, setOpen] = useState(false)
  const code = bookingButtonCode({ slug, label, color })

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNote(done)
    } catch {
      setNote("Couldn't copy. Select the code below and copy it.")
    }
  }

  return (
    <section className={cn(cardClass, "space-y-3")}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-muted-foreground">Add to your website</span>
          <span className="mt-1 block text-xs text-muted-foreground">A &quot;Book now&quot; button for your own site.</span>
        </span>
        <ChevronDown className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <p className="text-xs text-muted-foreground">
            Put a button on your site that opens your booking page. Bookings from it are marked as from your website.
          </p>

          {/* The real code, so the preview is exactly what customers see. */}
          <div
            className="flex min-h-[88px] items-center justify-center rounded-[14px] bg-white p-4"
            dangerouslySetInnerHTML={{ __html: code }}
          />

          <label className={fieldLabelClass}>
            Button text
            <input
              className={softInputClass}
              value={label}
              maxLength={BOOKING_BUTTON_LABEL_MAX}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={DEFAULT_BOOKING_BUTTON_LABEL}
            />
          </label>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-muted-foreground">Button color</span>
            <div className="flex flex-wrap items-center gap-2.5">
              <div role="radiogroup" aria-label="Button color" className="flex gap-2.5">
                {swatches.map((swatch) => {
                  const active = color === swatch.hex
                  return (
                    <button
                      key={swatch.hex}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={swatch.label}
                      onClick={() => {
                        setColor(swatch.hex)
                        setHexText(swatch.hex)
                      }}
                      style={{ background: swatch.hex }}
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full text-white ring-1 ring-inset ring-black/10 dark:ring-white/25",
                        active && "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      )}
                    >
                      {active ? <Check className="size-4 drop-shadow" aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
              <input
                className={cn(softInputClass, "h-10 w-28 tabular-nums")}
                value={hexText}
                maxLength={7}
                onChange={(event) => {
                  const value = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`
                  setHexText(value)
                  if (HEX_RE.test(value)) setColor(value.toUpperCase())
                }}
                aria-label="Custom button color"
                aria-invalid={!HEX_RE.test(hexText)}
              />
            </div>
          </div>

          <Button type="button" className="h-11 w-full rounded-full" onClick={() => void copy(code, "Code copied.")}>
            <Copy className="size-4" aria-hidden="true" />
            Copy code
          </Button>
          {note ? <p className="text-center text-sm text-muted-foreground">{note}</p> : null}
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-muted p-3 text-[11px] leading-snug text-muted-foreground">
            {code}
          </pre>

          <ul className="space-y-1.5 text-sm">
            {STEPS.map((step) => (
              <li key={step.name}>
                <span className="font-medium text-foreground">{step.name}:</span>{" "}
                <span className="text-muted-foreground">{step.how}</span>
              </li>
            ))}
          </ul>

          <p className="rounded-[12px] bg-muted px-3 py-2 text-sm text-muted-foreground">
            Or skip the code: most website builders have a Button block. Add one and paste your booking link into it.{" "}
            <button
              type="button"
              className="font-medium text-foreground underline"
              onClick={() => void copy(websiteBookingUrl(slug), "Link copied.")}
            >
              Copy link
            </button>
          </p>
        </>
      ) : null}
    </section>
  )
}
