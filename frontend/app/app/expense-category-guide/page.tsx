"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { EXPENSE_CATEGORY_GUIDE } from "@/lib/expenseCategories"

export default function ExpenseCategoryGuidePage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null

  useEffect(() => {
    if (authLoading || workspaceState.status !== "ready") return

    if (!user) {
      router.replace("/login")
      return
    }

    if (activeWorkspace?.type !== "independent") {
      router.replace("/app/home")
    }
  }, [authLoading, workspaceState.status, user, activeWorkspace?.type, router])

  if (
    authLoading ||
    workspaceState.status !== "ready" ||
    !user ||
    activeWorkspace?.type !== "independent"
  ) {
    return <AppLoader label="Loading expense category guide..." />
  }

  return (
    <>
      <StackInHeader />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <section className="space-y-3">
          <h1 className="text-2xl font-semibold">Expense Category Guide</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Accurate expense tracking can help reduce your taxable income, which
            may lower what you owe. The more consistently you track real business
            expenses, the clearer your records become at tax time.
          </p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Use this guide to keep your expense tracking consistent across your
            work. Each category below explains what belongs there, gives
            real-world examples, and offers a quick rule of thumb for everyday
            decisions.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {EXPENSE_CATEGORY_GUIDE.map((entry) => (
            <Card key={entry.category} className="h-full">
              <CardHeader>
                <CardTitle>{entry.category}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="font-medium">Simple definition</p>
                  <p className="text-muted-foreground">
                    {entry.simpleDefinition}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="font-medium">What this includes</p>
                  <p className="text-muted-foreground">{entry.includes}</p>
                </div>

                <div className="space-y-1">
                  <p className="font-medium">Examples</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {entry.examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1">
                  <p className="font-medium">Rule of thumb</p>
                  <p className="text-muted-foreground">{entry.ruleOfThumb}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </>
  )
}
