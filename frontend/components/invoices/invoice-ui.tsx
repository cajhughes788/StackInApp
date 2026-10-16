"use client"

import { useEffect, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceBalanceDue,
  invoiceDisplayStatus,
  type InvoiceDisplayStatus,
} from "@shared/invoiceDisplay"
import {
  DEFAULT_INVOICE_ACCENT_COLOR,
  type InvoicePaidMethod,
  type InvoiceSettings,
  type InvoiceType,
} from "@shared/schemas/invoice"

// Shared pieces of the invoice screens (app/app/invoices/*).

export const PAID_METHOD_LABELS: Record<InvoicePaidMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  venmo: "Venmo",
  check: "Check",
  card: "Card",
  pos: "Card",
  apple_cash: "Apple Pay",
  other: "Other",
}

// The device's own date, which is what "due today" means to the person.
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// Query params through Next's router, which keeps them current across
// in-app navigation (a one-time window.location read on mount sees the
// previous page's URL when the page is reached by router.push / <Link>).
// Pages using it render inside <Suspense> (static export requirement).
export function useQueryParam(name: string): string | null {
  return useSearchParams().get(name)
}

// Sign-in and workspace guard plus the invoices load, shared by every invoice
// page. Invoices are self-employed only.
export function useInvoicesWorkspace(): {
  ready: boolean
  workspaceId: string | null
  invoices: InvoiceType[]
  settings: InvoiceSettings | null
  loadStatus: "loading" | "ready" | "error"
} {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace = workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const workspaceId = activeWorkspace?.type === "independent" ? activeWorkspace.id : null
  const entry = useInvoicesStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useInvoicesStore((state) => state.load)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }
    if (workspaceState.status === "ready" && activeWorkspace?.type !== "independent") {
      router.replace("/app/home")
    }
  }, [activeWorkspace?.type, authLoading, router, user, workspaceState.status])

  useEffect(() => {
    if (workspaceId) void load(workspaceId).catch(() => {})
  }, [load, workspaceId])

  return {
    ready: !authLoading && !!user && workspaceState.status === "ready" && !!workspaceId,
    workspaceId,
    invoices: entry?.invoices ?? [],
    settings: entry?.settings ?? null,
    loadStatus: entry?.status ?? "loading",
  }
}

export function InvoicesPage({
  ready,
  loadingLabel,
  title,
  backHref,
  backLabel,
  action,
  children,
}: {
  ready: boolean
  loadingLabel: string
  title: ReactNode
  backHref?: string
  backLabel?: string
  action?: ReactNode
  children: ReactNode
}) {
  if (!ready) return <AppLoader label={loadingLabel} />
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />
      <main className="flex-1 px-4 pb-[calc(2rem+var(--safe-area-inset-bottom))] pt-4 max-w-xl mx-auto w-full space-y-4">
        <div className="flex min-h-11 items-center gap-1">
          {backHref ? (
            <Link
              href={backHref}
              aria-label={backLabel ?? "Back"}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
          ) : null}
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">{title}</h1>
          {action}
        </div>
        {children}
      </main>
    </div>
  )
}

const TONE_CLASSES: Record<InvoiceDisplayStatus["tone"], string> = {
  paid: "bg-accent text-emerald-800 dark:text-emerald-300",
  open: "bg-secondary text-foreground",
  overdue: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  draft: "border border-dashed border-input text-muted-foreground",
  void: "bg-secondary text-muted-foreground line-through",
}

// List rows use the short form ("Due Nov 14"); the detail page the full date.
export function shortStatusLabel(invoice: InvoiceType, today: string): string {
  if (invoice.status === "sent" && invoice.pendingPaymentAt) return "Processing"
  const status = invoiceDisplayStatus(invoice, today)
  // Refund and dispute states are already short.
  if (status.label === "Disputed" || status.label === "Refunded") return status.label
  if (status.label === "Paid · partly refunded") return "Partly refunded"
  if (status.tone === "overdue") {
    const days = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${invoice.dueDate}T12:00:00Z`)) / 86400000
    )
    return `Overdue ${days} day${days === 1 ? "" : "s"}`
  }
  if (status.tone === "open" && status.label !== "Due today") {
    return `Due ${formatInvoiceDate(invoice.dueDate).replace(/, \d{4}$/, "")}`
  }
  if (status.tone === "paid") return "Paid"
  return status.label
}

export function InvoiceStatusPill({ invoice, today, short }: { invoice: InvoiceType; today: string; short?: boolean }) {
  const status = invoiceDisplayStatus(invoice, today)
  // A bank transfer clearing reads as on its way, not overdue.
  const tone = invoice.status === "sent" && invoice.pendingPaymentAt ? "open" : status.tone
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone]
      )}
    >
      {short ? shortStatusLabel(invoice, today) : invoice.status === "sent" && invoice.pendingPaymentAt ? "Payment processing" : status.label}
    </span>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
}

export function BusinessMark({ settings, size = 48 }: { settings: InvoiceSettings | null; size?: number }) {
  if (settings?.logoDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={settings.logoDataUrl}
        alt=""
        style={{ maxWidth: size * 2, maxHeight: size }}
        className="shrink-0 object-contain"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      // Fixed charcoal: it stands in for a logo printed on the invoice.
      className="flex shrink-0 items-center justify-center rounded-xl bg-[#161B1E] text-base font-bold uppercase text-[#ECEBE6] ring-1 ring-inset ring-white/15"
    >
      {initials(settings?.businessName || "?") || "?"}
    </span>
  )
}

// What the client sees, condensed — the same content as the PDF and the
// public page. Always light: it's a picture of a printed document.
export function InvoicePreview({ invoice, settings }: { invoice: InvoiceType; settings: InvoiceSettings | null }) {
  const accent = settings?.accentColor || DEFAULT_INVOICE_ACCENT_COLOR
  return (
    <section aria-label="Invoice preview" className="overflow-hidden rounded-[18px] border border-card-border bg-white text-[#161B1E]">
      <div style={{ height: 5, background: accent }} />
      <div className="space-y-3 p-4 text-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{settings?.businessName || "Your business name"}</div>
            {settings?.businessEmail ? <div className="truncate text-[#5F6864]">{settings.businessEmail}</div> : null}
          </div>
          <div className="text-right">
            <div className="font-bold tracking-wide" style={{ color: accent }}>
              INVOICE
            </div>
            <div className="text-[#5F6864]">#{invoice.number}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["BILLED TO", invoice.clientName],
            ["ISSUED", formatInvoiceDate(invoice.issueDate)],
            ["DUE", formatInvoiceDate(invoice.dueDate)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="text-[10px] font-semibold tracking-wide text-[#5F6864]">{label}</div>
              <div className="break-words">{value}</div>
            </div>
          ))}
        </div>
        <div>
          {invoice.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-3 border-b border-[#ECEBE6] py-2 last:border-0">
              <span className="min-w-0 break-words">{line.description}</span>
              <span className="shrink-0 tabular-nums">{formatInvoiceMoney(line.amount)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[15px] font-bold">
          <span>Balance due</span>
          <span className="tabular-nums">{formatInvoiceMoney(invoiceBalanceDue(invoice))}</span>
        </div>
        {invoice.note && invoice.status !== "void" ? (
          <div className="whitespace-pre-line rounded-[10px] bg-[#FAFAF8] px-3 py-2.5">
            <span className="mb-1 block text-[10px] font-semibold tracking-wide text-[#5F6864]">
              {invoice.status === "paid" ? "NOTE" : "HOW TO PAY"}
            </span>
            {invoice.note}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export const fieldLabelClass = "flex flex-col gap-1.5 text-sm font-medium text-muted-foreground"
export const softInputClass =
  "h-11 w-full rounded-xl border-0 bg-muted px-3 text-[15px] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
export const cardClass = "rounded-[18px] border border-card-border bg-card p-4"
