"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight } from "lucide-react"

import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import PlaidConnectButton from "@/components/plaid-connect-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

// Everything about where bank data comes from: the connected banks, and the
// two lists that shape how their transactions are sorted. Self-employed
// workspaces only, like the bank review on the home screen.
const BANK_TOOLS = [
  {
    label: "Learned merchants",
    detail: "Merchants 521 sorts for you automatically",
    href: "/app/learned-merchants",
  },
  {
    label: "Hidden transfers",
    detail: "Deposits you marked as not income",
    href: "/app/hidden-transfers",
  },
]

export default function BankConnectionsPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null

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

  if (authLoading || workspaceState.status !== "ready") {
    return <AppLoader label="Loading bank connections..." />
  }

  if (!user || !activeWorkspace || activeWorkspace.type !== "independent") {
    return null
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 pb-10 pt-4">
        <div className="space-y-1 px-1">
          <h1 className="text-2xl font-semibold text-foreground">Bank connections</h1>
          <p className="text-sm text-muted-foreground">
            New deposits and charges from these banks show up in Needs you on your home screen.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your banks</CardTitle>
          </CardHeader>
          <CardContent>
            <PlaidConnectButton workspaceId={activeWorkspace.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sorting</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70 rounded-2xl bg-muted px-4">
              {BANK_TOOLS.map((tool) => (
                <li key={tool.href}>
                  <button
                    type="button"
                    onClick={() => router.push(tool.href)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{tool.label}</span>
                      <span className="block text-xs text-muted-foreground">{tool.detail}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
