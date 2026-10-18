"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  BusinessMark,
  InvoicesPage,
  cardClass,
  fieldLabelClass,
  useQueryParam,
  softInputClass,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import OnlinePaymentsCard from "@/components/invoices/online-payments-card"
import { saveInvoiceSettings } from "@/lib/api/invoicesApi"
import { prepareInvoiceLogo } from "@/lib/invoiceLogo"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { INVOICE_TERMS_LABELS } from "@shared/invoiceDisplay"
import {
  DEFAULT_INVOICE_ACCENT_COLOR,
  InvoiceSettingsSchema,
  type InvoiceSettings,
  type InvoiceTerms,
} from "@shared/schemas/invoice"

const SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: DEFAULT_INVOICE_ACCENT_COLOR, label: "521 green" },
  { hex: "#161B1E", label: "Charcoal" },
  { hex: "#2F6FD6", label: "Blue" },
  { hex: "#6B3A73", label: "Plum" },
  { hex: "#C8574A", label: "Clay" },
  { hex: "#C98A2B", label: "Gold" },
]
const TERMS: InvoiceTerms[] = ["due_on_receipt", "net_15", "net_30"]
const TERMS_SHORT: Record<InvoiceTerms, string> = { due_on_receipt: "Due now", net_15: "15 days", net_30: "30 days" }
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const DEPOSIT_TYPES: Array<{ value: InvoiceSettings["defaultDeposit"]["type"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fixed", label: "$ amount" },
  { value: "percent", label: "% of total" },
]
const DEPOSIT_DUE_DAYS = [3, 7, 14]

type Draft = Omit<InvoiceSettings, "updatedAt">

function toDraft(settings: InvoiceSettings | null): Draft {
  const { updatedAt: _updatedAt, ...rest } = settings ?? InvoiceSettingsSchema.parse({})
  return rest
}

export default function InvoiceSettingsPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoiceSettingsPage />
    </Suspense>
  )
}

function InvoiceSettingsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, workspaceId, settings, loadStatus } = useInvoicesWorkspace()
  const setSettings = useInvoicesStore((state) => state.setSettings)
  const [draft, setDraft] = useState<Draft>(() => toDraft(null))
  const [hexText, setHexText] = useState(DEFAULT_INVOICE_ACCENT_COLOR)
  const [saving, setSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const initialized = useRef(false)
  const stripeParam = useQueryParam("stripe")
  // Arrived from Stripe's sign-up redirect: "back" would return to Stripe.
  const [fromStripe] = useState(() => stripeParam !== null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // Typed as text so "12." isn't rewritten mid-typing; parsed on save.
  const [depositText, setDepositText] = useState("")

  useEffect(() => {
    if (initialized.current || loadStatus !== "ready") return
    initialized.current = true
    const next = toDraft(settings)
    setDraft(next)
    setHexText(next.accentColor)
    if (next.defaultDeposit.type !== "none") setDepositText(String(next.defaultDeposit.value))
  }, [loadStatus, settings])

  const depositValue = (() => {
    const cleaned = depositText.replace(/[$,%\s]/g, "")
    if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
    const value = Number(cleaned)
    return value > 0 ? value : null
  })()
  const depositError =
    draft.defaultDeposit.type === "none"
      ? null
      : depositValue === null
        ? "Enter the deposit amount, or choose None."
        : draft.defaultDeposit.type === "percent" && depositValue >= 100
          ? "A percent deposit has to be under 100%."
          : null

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const emailInvalid = draft.businessEmail.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.businessEmail.trim())
  const accent = HEX_RE.test(draft.accentColor) ? draft.accentColor : DEFAULT_INVOICE_ACCENT_COLOR

  async function onPickLogo(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    try {
      update({ logoDataUrl: await prepareInvoiceLogo(file) })
    } catch (error) {
      toast({
        title: "Couldn't use that image",
        description: error instanceof Error ? error.message : "Try a PNG or JPEG.",
        variant: "destructive",
      })
    } finally {
      setLogoBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function save() {
    if (!workspaceId || emailInvalid || depositError) return
    setSaving(true)
    try {
      const saved = await saveInvoiceSettings(workspaceId, {
        ...draft,
        defaultDeposit:
          draft.defaultDeposit.type === "none" || depositValue === null
            ? { ...draft.defaultDeposit, type: "none", value: 0 }
            : { ...draft.defaultDeposit, value: depositValue },
        businessName: draft.businessName.trim(),
        businessEmail: draft.businessEmail.trim(),
        businessPhone: draft.businessPhone.trim(),
        defaultNote: draft.defaultNote.trim(),
      })
      setSettings(workspaceId, saved)
      toast({ title: "Invoice settings saved" })
      if (fromStripe) router.replace("/app/invoices")
      else router.back()
    } catch (error) {
      toast({
        title: "Couldn't save your settings",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
      setSaving(false)
    }
  }

  const previewSettings = { ...draft, updatedAt: undefined }

  return (
    <InvoicesPage ready={ready} loadingLabel="Loading invoice settings..." title="Invoice settings" backHref="/app/invoices" backLabel="Back to invoices">
      {loadStatus !== "ready" ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-24 w-full rounded-[18px]" />
          <Skeleton className="h-80 w-full rounded-[18px]" />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <section aria-label="Preview" className="overflow-hidden rounded-[18px] border border-card-border bg-white text-[#161B1E]">
            <div style={{ height: 5, background: accent }} />
            <div className="flex items-center gap-3 px-4 py-3.5">
              <BusinessMark settings={previewSettings} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{draft.businessName || "Your business name"}</div>
                <div className="truncate text-[13px] text-[#5F6864]">
                  {[draft.businessEmail, draft.businessPhone].filter(Boolean).join(" · ") || "Email · phone"}
                </div>
              </div>
              <div className="text-[13px] font-bold tracking-wide" style={{ color: accent }}>
                INVOICE
              </div>
            </div>
            <div className="px-4 pb-3.5 text-xs text-[#5F6864]">How your invoices look to clients</div>
          </section>

          {/* Acts on its own (Stripe), not through this form's Save. */}
          {workspaceId ? <OnlinePaymentsCard workspaceId={workspaceId} /> : null}

          <section className={cn(cardClass, "space-y-3")}>
            <h2 className="text-sm font-semibold text-muted-foreground">Your business</h2>
            <div className="flex items-center gap-3">
              <BusinessMark settings={previewSettings} size={64} />
              <div className="flex flex-col items-start gap-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-full border-card-border bg-card px-4 font-semibold"
                  disabled={logoBusy}
                  onClick={() => fileInput.current?.click()}
                >
                  {logoBusy ? "Processing..." : draft.logoDataUrl ? "Change logo" : "Add logo"}
                </Button>
                {draft.logoDataUrl ? (
                  <button
                    type="button"
                    className="h-8 px-4 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => update({ logoDataUrl: null })}
                  >
                    Remove
                  </button>
                ) : (
                  <span className="px-1 text-xs text-muted-foreground">PNG or JPEG</span>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void onPickLogo(event.target.files?.[0])}
              />
            </div>
            <label className={fieldLabelClass}>
              Business name
              <input
                className={softInputClass}
                value={draft.businessName}
                onChange={(event) => update({ businessName: event.target.value })}
                maxLength={80}
                placeholder="As your clients know you"
                autoComplete="organization"
              />
            </label>
            <label className={fieldLabelClass}>
              Email
              <input
                type="email"
                className={softInputClass}
                value={draft.businessEmail}
                onChange={(event) => update({ businessEmail: event.target.value })}
                maxLength={254}
                placeholder="Where clients can reach you"
                autoComplete="email"
              />
            </label>
            {emailInvalid ? <p className="text-sm text-destructive">That email doesn&apos;t look right.</p> : null}
            <label className={fieldLabelClass}>
              Phone
              <input
                type="tel"
                className={softInputClass}
                value={draft.businessPhone}
                onChange={(event) => update({ businessPhone: event.target.value })}
                maxLength={40}
                placeholder="Optional"
                autoComplete="tel"
              />
            </label>
          </section>

          <section className={cn(cardClass, "space-y-3")}>
            <h2 className="text-sm font-semibold text-muted-foreground">Accent color</h2>
            <div role="radiogroup" aria-label="Accent color" className="grid grid-cols-6 justify-items-center gap-2.5">
              {SWATCHES.map((swatch) => {
                const active = draft.accentColor.toLowerCase() === swatch.hex.toLowerCase()
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={swatch.label}
                    onClick={() => {
                      update({ accentColor: swatch.hex })
                      setHexText(swatch.hex)
                    }}
                    style={{ background: swatch.hex }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full text-white ring-1 ring-inset ring-black/10 dark:ring-white/25",
                      active && "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    )}
                  >
                    {active ? <Check className="size-4 drop-shadow" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
              Custom
              <input
                className={cn(softInputClass, "h-10 w-32 tabular-nums")}
                value={hexText}
                maxLength={7}
                onChange={(event) => {
                  const value = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`
                  setHexText(value)
                  if (HEX_RE.test(value)) update({ accentColor: value.toUpperCase() })
                }}
                aria-invalid={!HEX_RE.test(hexText)}
              />
            </label>
          </section>

          <section className={cn(cardClass, "space-y-3")}>
            <h2 className="text-sm font-semibold text-muted-foreground">New invoices</h2>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">When it&apos;s due</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {TERMS.map((terms) => {
                  const active = draft.defaultTerms === terms
                  return (
                    <button
                      key={terms}
                      type="button"
                      aria-pressed={active}
                      aria-label={INVOICE_TERMS_LABELS[terms]}
                      onClick={() => update({ defaultTerms: terms })}
                      className={cn(
                        "h-10 rounded-[10px] text-sm transition-colors",
                        active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      {TERMS_SHORT[terms]}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                How long clients have to pay. You can change it on each invoice.
              </p>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">Deposit</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {DEPOSIT_TYPES.map((option) => {
                  const active = draft.defaultDeposit.type === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update({ defaultDeposit: { ...draft.defaultDeposit, type: option.value } })}
                      className={cn(
                        "h-10 rounded-[10px] text-sm transition-colors",
                        active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {draft.defaultDeposit.type !== "none" ? (
                <div className="flex gap-2.5 pt-1">
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    {draft.defaultDeposit.type === "percent" ? "Percent" : "Amount"}
                    <input
                      type="text"
                      inputMode="decimal"
                      className={cn(softInputClass, "tabular-nums")}
                      value={depositText}
                      placeholder={draft.defaultDeposit.type === "percent" ? "25" : "100.00"}
                      onChange={(event) => setDepositText(event.target.value)}
                    />
                  </label>
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    Due within
                    <select
                      className={softInputClass}
                      value={draft.defaultDeposit.dueInDays}
                      onChange={(event) =>
                        update({ defaultDeposit: { ...draft.defaultDeposit, dueInDays: Number(event.target.value) } })
                      }
                    >
                      {[...new Set([...DEPOSIT_DUE_DAYS, draft.defaultDeposit.dueInDays])]
                        .sort((a, b) => a - b)
                        .map((days) => (
                          <option key={days} value={days}>
                            {days === 0 ? "Same day" : `${days} days`}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              ) : null}
              {depositError ? <p className="text-sm text-destructive">{depositError}</p> : null}
              <p className="text-xs text-muted-foreground">
                Asked for up front on new invoices; the rest is due by the due date. You can change it on each invoice.
              </p>
            </fieldset>
            <label className={fieldLabelClass}>
              Note to customer
              <Textarea
                rows={4}
                value={draft.defaultNote}
                onChange={(event) => update({ defaultNote: event.target.value })}
                maxLength={1000}
                placeholder={"Venmo @yourname\nZelle you@email.com\nThank you!"}
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Shows under &ldquo;How to pay&rdquo; on every invoice. Put your Venmo, Zelle or Cash App details here so
              clients know where to send money.
            </p>
          </section>

          <Button type="submit" disabled={saving || emailInvalid} className="h-[52px] w-full rounded-full text-base font-semibold">
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      )}
    </InvoicesPage>
  )
}
