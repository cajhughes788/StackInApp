"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  InvoicesPage,
  cardClass,
  fieldLabelClass,
  localToday,
  readQueryParam,
  softInputClass,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import { createInvoice, editInvoice } from "@/lib/api/invoicesApi"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import { dueDateForTerms, formatInvoiceDate, formatInvoiceMoney, INVOICE_TERMS_LABELS } from "@shared/invoiceDisplay"
import type { IncomeCategory } from "@shared/schemas/entry"
import type { InvoiceTerms, InvoiceType } from "@shared/schemas/invoice"

type DraftLine = { key: number; description: string; amount: string; category: IncomeCategory }

const CATEGORY_OPTIONS: Array<{ value: IncomeCategory; label: string }> = [
  { value: "services", label: "Services" },
  { value: "products", label: "Products" },
  { value: "tips", label: "Tips" },
  { value: "other", label: "Other" },
]
const TERMS: InvoiceTerms[] = ["due_on_receipt", "net_15", "net_30"]
const TERMS_SHORT: Record<InvoiceTerms, string> = { due_on_receipt: "On receipt", net_15: "Net 15", net_30: "Net 30" }

// "$1,250.5" → 1250.5; null when it isn't a positive amount in whole cents.
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned) * 100) / 100
  return value > 0 ? value : null
}

function termsFor(issueDate: string, dueDate: string): InvoiceTerms | null {
  return TERMS.find((terms) => dueDateForTerms(issueDate, terms) === dueDate) ?? null
}

let lineKey = 0
function newLine(category: IncomeCategory = "services"): DraftLine {
  return { key: ++lineKey, description: "", amount: "", category }
}

export default function InvoiceFormPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, workspaceId, invoices, settings, loadStatus } = useInvoicesWorkspace()
  const upsertInvoice = useInvoicesStore((state) => state.upsertInvoice)
  const [invoiceId] = useState(() => readQueryParam("id"))
  const existing = invoiceId ? invoices.find((invoice) => invoice.id === invoiceId) ?? null : null
  // One id per form, so a retried create can't make a second invoice.
  const clientMutationId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`
  )

  const [clientName, setClientName] = useState("")
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()])
  const [issueDate, setIssueDate] = useState(localToday())
  const [dueDate, setDueDate] = useState(() => dueDateForTerms(localToday(), "net_30"))
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState<null | "draft" | "share">(null)
  const [showErrors, setShowErrors] = useState(false)
  const initialized = useRef(false)

  // Fill the form once: from the invoice being edited, or from settings.
  useEffect(() => {
    if (initialized.current || loadStatus !== "ready") return
    if (invoiceId && !existing) return
    initialized.current = true
    if (existing) {
      setClientName(existing.clientName)
      setLines(existing.lines.map((line) => ({ ...newLine(line.category), description: line.description, amount: line.amount.toFixed(2) })))
      setIssueDate(existing.issueDate)
      setDueDate(existing.dueDate)
      setNote(existing.note)
    } else if (settings) {
      setDueDate(dueDateForTerms(localToday(), settings.defaultTerms))
      setNote(settings.defaultNote)
    }
  }, [existing, invoiceId, loadStatus, settings])

  // Paid and void invoices can't be edited.
  useEffect(() => {
    if (existing && existing.status !== "draft" && existing.status !== "sent") {
      router.replace(`/app/invoices/view?id=${encodeURIComponent(existing.id)}`)
    }
  }, [existing, router])

  const recentClients = useMemo(() => {
    const names: string[] = []
    for (const invoice of invoices) {
      if (!names.includes(invoice.clientName)) names.push(invoice.clientName)
      if (names.length === 3) break
    }
    return names
  }, [invoices])

  const parsedLines = lines.map((line) => ({ ...line, value: parseAmount(line.amount) }))
  const total = parsedLines.reduce((sum, line) => sum + Math.round((line.value ?? 0) * 100), 0) / 100
  const selectedTerms = termsFor(issueDate, dueDate)
  const filledLines = parsedLines.filter((line) => line.description.trim() || line.amount.trim())
  const errors = {
    client: !clientName.trim() ? "Who is this invoice for?" : null,
    lines:
      filledLines.length === 0
        ? "Add at least one line."
        : filledLines.some((line) => !line.description.trim() || line.value === null)
          ? "Each line needs a description and an amount."
          : null,
    dates: dueDate < issueDate ? "The due date can't be before the invoice date." : null,
  }
  const valid = !errors.client && !errors.lines && !errors.dates

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function save(mode: "draft" | "share") {
    if (!workspaceId) return
    if (!valid) {
      setShowErrors(true)
      return
    }
    const body = {
      clientName: clientName.trim(),
      lines: filledLines.map((line) => ({
        description: line.description.trim(),
        amount: line.value as number,
        category: line.category,
      })),
      issueDate,
      dueDate,
      note: note.trim(),
    }
    setSaving(mode)
    try {
      let saved: InvoiceType
      if (existing) {
        saved = await editInvoice(workspaceId, existing.id, body)
      } else {
        saved = await createInvoice(workspaceId, { ...body, clientMutationId: clientMutationId.current })
      }
      upsertInvoice(workspaceId, saved)
      if (mode === "share") {
        // A new invoice lands on its share step; an edit just goes back.
        router.replace(`/app/invoices/view?id=${encodeURIComponent(saved.id)}${existing ? "" : "&share=1"}`)
      } else {
        toast({ title: existing ? "Invoice saved" : `Draft #${saved.number} saved` })
        router.replace("/app/invoices")
      }
    } catch (error) {
      toast({
        title: "Couldn't save the invoice",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
      setSaving(null)
    }
  }

  const title = existing ? `Edit #${existing.number}` : "New invoice"
  const waitingForInvoice = loadStatus === "loading" || (invoiceId && !existing && loadStatus === "ready" && !initialized.current)

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading invoice..."
      title={title}
      backHref={existing ? `/app/invoices/view?id=${encodeURIComponent(existing.id)}` : "/app/invoices"}
      backLabel="Cancel"
      action={
        existing?.status === "sent" ? null : (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full px-3 font-semibold text-emerald-700 dark:text-emerald-400"
            disabled={saving !== null}
            onClick={() => void save("draft")}
          >
            {saving === "draft" ? "Saving..." : "Save draft"}
          </Button>
        )
      }
    >
      {invoiceId && loadStatus === "ready" && !existing ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>This invoice wasn&apos;t found.</div>
      ) : waitingForInvoice ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 w-full rounded-[18px]" />
          <Skeleton className="h-64 w-full rounded-[18px]" />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save("share")
          }}
        >
          <section className={cn(cardClass, "space-y-3")}>
            <label className={fieldLabelClass}>
              Bill to
              <input
                className={softInputClass}
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="Client or business name"
                maxLength={80}
                autoComplete="organization"
              />
            </label>
            {recentClients.length > 0 && !existing ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Recent:</span>
                {recentClients.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setClientName(name)}
                    className="h-8 rounded-full border border-card-border bg-card px-3 text-sm text-foreground hover:bg-muted"
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
            {showErrors && errors.client ? <p className="text-sm text-destructive">{errors.client}</p> : null}
          </section>

          <section className={cn(cardClass, "space-y-3.5")}>
            <h2 className="text-sm font-semibold text-muted-foreground">What it&apos;s for</h2>
            {lines.map((line, index) => (
              <div key={line.key} className="space-y-2 border-b border-border pb-3.5">
                <div className="flex items-end gap-2">
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    Description
                    <input
                      className={softInputClass}
                      value={line.description}
                      onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      placeholder="e.g. Logo design"
                      maxLength={200}
                    />
                  </label>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    Amount
                    <input
                      className={cn(softInputClass, "tabular-nums")}
                      value={line.amount}
                      onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                      onBlur={() => {
                        const value = parseAmount(line.amount)
                        if (value !== null) updateLine(line.key, { amount: value.toFixed(2) })
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </label>
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    Type
                    <select
                      className={softInputClass}
                      value={line.category}
                      onChange={(event) => updateLine(line.key, { category: event.target.value as IncomeCategory })}
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((current) => [...current, newLine(current[current.length - 1]?.category)])}
              disabled={lines.length >= 50}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input font-semibold text-emerald-700 hover:bg-muted dark:text-emerald-400"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a line
            </button>
            {showErrors && errors.lines ? <p className="text-sm text-destructive">{errors.lines}</p> : null}
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-semibold text-foreground">Total</span>
              <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(total)}
              </span>
            </div>
          </section>

          <section className={cn(cardClass, "space-y-3")}>
            <label className={fieldLabelClass}>
              Invoice date
              <input
                type="date"
                className={softInputClass}
                value={issueDate}
                onChange={(event) => {
                  const next = event.target.value
                  if (!next) return
                  // Keep the chosen terms when the start date moves.
                  setDueDate(selectedTerms ? dueDateForTerms(next, selectedTerms) : dueDate)
                  setIssueDate(next)
                }}
              />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">When it&apos;s due</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {TERMS.map((terms) => {
                  const active = selectedTerms === terms
                  return (
                    <button
                      key={terms}
                      type="button"
                      aria-pressed={active}
                      aria-label={INVOICE_TERMS_LABELS[terms]}
                      onClick={() => setDueDate(dueDateForTerms(issueDate, terms))}
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
              <label className="flex items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
                <span>Due {formatInvoiceDate(dueDate)}</span>
                <input
                  type="date"
                  aria-label="Due date"
                  className="h-9 rounded-lg border-0 bg-transparent px-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                  value={dueDate}
                  min={issueDate}
                  onChange={(event) => event.target.value && setDueDate(event.target.value)}
                />
              </label>
              {showErrors && errors.dates ? <p className="text-sm text-destructive">{errors.dates}</p> : null}
            </fieldset>
          </section>

          <section className={cn(cardClass, "space-y-1.5")}>
            <label className={fieldLabelClass}>
              Note to customer
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                placeholder="How to pay you, e.g. Venmo @yourname"
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {settings?.defaultNote ? "From your default note in Invoice settings" : "Set a default note in Invoice settings"}
            </p>
          </section>

          <div className="flex gap-2.5 pt-1">
            <Button
              type="submit"
              disabled={saving !== null}
              className="h-[52px] flex-1 rounded-full text-base font-semibold"
            >
              {saving === "share" ? "Saving..." : existing ? "Save" : "Save & share"}
            </Button>
          </div>
        </form>
      )}
    </InvoicesPage>
  )
}
