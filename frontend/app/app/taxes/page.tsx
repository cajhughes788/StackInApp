"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import TaxAnswersForm from "@/components/tax/tax-answers-form"
import TaxEstimateCard from "@/components/tax/tax-estimate-card"
import { useTaxEstimate } from "@/components/tax/use-tax-estimate"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { SHOW_TAXES } from "@shared/estimatedTax/featureFlag"

// Self-employed taxes: the estimate (what to set aside and pay each
// quarter) on top, the questions it needs underneath (shared/estimatedTax).
export default function TaxesPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspace = workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const { data, refresh } = useTaxEstimate()
  const answersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }
    // Hidden for now (featureFlag.ts): send anyone with an old link home.
    if (!SHOW_TAXES || (workspaceState.status === "ready" && activeWorkspace?.type !== "independent")) {
      router.replace("/app/home")
    }
  }, [activeWorkspace?.type, authLoading, router, user, workspaceState.status])

  if (!SHOW_TAXES || authLoading || !user || activeWorkspace?.type !== "independent") return <AppLoader label="Loading taxes..." />

  const scrollToAnswers = () => answersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  const afterSave = () => {
    refresh()
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />
      <main className="flex-1 px-4 pb-[calc(2rem+var(--safe-area-inset-bottom))] pt-4 max-w-xl mx-auto w-full space-y-4">
        <div className="flex min-h-11 items-center">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">Taxes</h1>
        </div>

        <section className="rounded-[22px] border border-amber-500/40 bg-amber-500/10 p-5" aria-label="About your tax estimate">
          <p className="font-semibold text-foreground">Your estimate is only as accurate as the information you give us.</p>
          <p className="mt-2 text-sm text-foreground">To estimate your taxes correctly, we need:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            <li>every question below answered</li>
            <li>all of your business income and expenses recorded in 521</li>
            <li>all of your W-2 income, recorded in 521 or entered below</li>
          </ul>
          <p className="mt-2 text-sm text-foreground">If anything is missing or out of date, your estimate will be wrong.</p>
        </section>

        <TaxEstimateCard onEditAnswers={scrollToAnswers} />

        {data?.eligible ? (
          <div ref={answersRef} className="scroll-mt-20 space-y-3">
            <div className="px-1">
              <h2 className="text-lg font-semibold text-foreground">Your answers</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">All questions are required</span> except last year&apos;s
                return. Answer for your whole tax return, not just this business. When something changes, update your
                answers; your estimate changes with them.
              </p>
            </div>
            <TaxAnswersForm
              profile={data.profile}
              w2={data.w2 ?? { workspaces: [], key: "" }}
              hasTips={data.ytdTips > 0}
              suggestedStateCode={data.suggestedStateCode}
              onSaved={afterSave}
            />
          </div>
        ) : null}
      </main>
    </div>
  )
}
