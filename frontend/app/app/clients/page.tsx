"use client"

import { Suspense } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import ClientList from "@/components/clients/client-list"
import { InvoicesPage, localToday, useInvoicesWorkspace } from "@/components/invoices/invoice-ui"

// Everyone who pays you: saved clients with their invoices and other
// payments (shared/clients.ts).
export default function ClientsPageRoute() {
  return (
    <Suspense fallback={null}>
      <ClientsPage />
    </Suspense>
  )
}

function ClientsPage() {
  const { ready, workspaceId, invoices } = useInvoicesWorkspace()
  const today = localToday()
  return (
    <InvoicesPage ready={ready} loadingLabel="Loading clients..." title="Clients">
      {workspaceId ? <ClientList workspaceId={workspaceId} invoices={invoices} today={today} /> : null}
      <div className="sticky bottom-[calc(1rem+var(--safe-area-inset-bottom))] pt-2">
        <Link
          href="/app/invoices/edit"
          className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm"
        >
          <Plus className="size-5" aria-hidden="true" />
          New invoice
        </Link>
      </div>
    </InvoicesPage>
  )
}
