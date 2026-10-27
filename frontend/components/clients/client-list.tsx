"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Plus, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cardClass } from "@/components/invoices/invoice-ui"
import { createClient } from "@/lib/api/clientsApi"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { cn } from "@/lib/utils"
import { buildClientRows, type ClientRow } from "@shared/clients"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { InvoiceType } from "@shared/schemas/invoice"

type Sort = "name" | "earned"

export function clientHref(row: Pick<ClientRow, "client" | "name">): string {
  return row.client
    ? `/app/invoices/client?id=${encodeURIComponent(row.client.id)}`
    : `/app/invoices/client?name=${encodeURIComponent(row.name)}`
}

// Saved clients (plus invoice names that match none), with search, sort by
// what they paid this year, and a Repeat badge.
export default function ClientList({
  workspaceId,
  invoices,
  today,
}: {
  workspaceId: string
  invoices: InvoiceType[]
  today: string
}) {
  const router = useRouter()
  const entry = useClientsStore((state) => state.byWorkspaceId[workspaceId])
  const load = useClientsStore((state) => state.load)
  const upsert = useClientsStore((state) => state.upsert)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("name")
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    void load(workspaceId, { force: true }).catch(() => {})
  }, [load, workspaceId])

  const rows = useMemo(
    () => buildClientRows(entry?.clients ?? [], entry?.payments ?? {}, invoices, today),
    [entry?.clients, entry?.payments, invoices, today]
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            (row.client?.email ?? "").toLowerCase().includes(q) ||
            (row.client?.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000")
        )
      : rows
    return sort === "earned" ? [...filtered].sort((a, b) => b.thisYear - a.thisYear) : filtered
  }, [rows, query, sort])

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!newName.trim()) {
      setAddError("What's their name?")
      return
    }
    setSaving(true)
    setAddError(null)
    try {
      const client = await createClient(workspaceId, {
        name: newName.trim(),
        phone: newPhone.trim() || null,
        email: newEmail.trim() || null,
      })
      upsert(workspaceId, client)
      router.push(`/app/invoices/client?id=${encodeURIComponent(client.id)}`)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add this client.")
    } finally {
      setSaving(false)
    }
  }

  const loading = !entry || (entry.status === "loading" && entry.clients.length === 0)

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
            className="h-10 rounded-full pl-9"
          />
        </div>
        <Button type="button" variant="outline" className="h-10 rounded-full" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add client
        </Button>
      </div>

      {adding ? (
        <form onSubmit={handleAdd} className={cn(cardClass, "space-y-3")}>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus />
          <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" aria-label="Phone" inputMode="tel" />
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" aria-label="Email" inputMode="email" />
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? "Adding..." : "Add client"}</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <div role="group" aria-label="Sort clients" className="flex gap-2 text-sm">
        {(["name", "earned"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={sort === option}
            onClick={() => setSort(option)}
            className={cn(
              "h-8 rounded-full px-3",
              sort === option ? "bg-foreground font-semibold text-background" : "border border-card-border bg-card text-foreground"
            )}
          >
            {option === "name" ? "A–Z" : "Earned this year"}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-[18px]" />
      ) : visible.length === 0 ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>
          {query ? "No clients match that." : "No clients yet. Add one, or they're added when you send an invoice."}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
          {visible.map((row) => (
            <li key={row.key} className="border-b border-border last:border-0">
              <Link href={clientHref(row)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{row.name}</span>
                    {row.isRepeat ? (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        Repeat
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[
                      row.invoices.length > 0 ? `${row.invoices.length} invoice${row.invoices.length === 1 ? "" : "s"}` : null,
                      row.visitCount > 0 ? `${row.visitCount} other payment${row.visitCount === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No payments yet"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums text-foreground">
                    {formatInvoiceMoney(row.thisYear)}{" "}
                    <span className="text-xs font-medium text-muted-foreground">this year</span>
                  </div>
                  {row.overdue > 0 ? (
                    <div className="text-xs font-semibold text-red-700 dark:text-red-400">
                      {formatInvoiceMoney(row.overdue)} overdue
                    </div>
                  ) : row.open > 0 ? (
                    <div className="text-xs text-muted-foreground">{formatInvoiceMoney(row.open)} open</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{formatInvoiceMoney(row.lifetime)} all time</div>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
