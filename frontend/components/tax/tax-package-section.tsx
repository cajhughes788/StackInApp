"use client"

import { useEffect, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Capacitor } from "@capacitor/core"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { buildTaxPackage, getTaxPackageSummary } from "@/lib/api/taxPackageApi"
import { formatCurrency } from "@/lib/helpers"
import type { TaxPackageData } from "@shared/taxPackage"

// P&L page: business income by payment app for a year, and the tax-time
// package download (shared/taxPackage.ts) — the year's records organized
// for an accountant, receipts included.

async function openDownload(url: string) {
  if (Capacitor.isNativePlatform()) {
    // Safari can save the zip to Files.
    const { Browser } = await import("@capacitor/browser")
    await Browser.open({ url })
    return
  }
  window.location.assign(url)
}

export default function TaxPackageSection({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const thisYear = new Date().getFullYear()
  // Early in the year, last year's records are the ones people need.
  const [year, setYear] = useState(new Date().getMonth() < 4 ? thisYear - 1 : thisYear)
  const [summary, setSummary] = useState<TaxPackageData | null>(null)
  const [failed, setFailed] = useState(false)
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setFailed(false)
    getTaxPackageSummary(workspaceId, year)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, year])

  async function download() {
    setBuilding(true)
    try {
      const result = await buildTaxPackage(workspaceId, year)
      await openDownload(result.url)
      toast({
        title: "Your tax-time package is ready",
        description:
          result.receiptsLeftOut > 0
            ? `${result.receiptsIncluded} receipts included; ${result.receiptsLeftOut} couldn't be added and are listed in the expenses file.`
            : `${result.receiptsIncluded} receipts included. Open "Start here" first.`,
      })
    } catch {
      toast({ title: "Couldn't build the package", description: "Please try again in a moment.", variant: "destructive" })
    } finally {
      setBuilding(false)
    }
  }

  const anyOver = summary?.incomeByApp.some((app) => app.over1099KAmount) ?? false
  const anyNear = summary?.incomeByApp.some((app) => app.near1099KAmount) ?? false

  return (
    <section aria-labelledby="tax-package-heading" className="rounded-[22px] bg-card border border-card-border p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="tax-package-heading" className="text-lg font-semibold text-foreground">Tax time</h2>
        <div className="flex rounded-full bg-muted p-0.5" role="group" aria-label="Tax year">
          {[thisYear - 1, thisYear].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={year === option}
              onClick={() => setYear(option)}
              className={`rounded-full px-3 py-1 text-sm font-medium tabular-nums transition-colors ${
                year === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <h3 className="text-sm font-medium text-muted-foreground">Business income by payment app</h3>
      {failed ? (
        <p className="mt-2 text-sm text-muted-foreground">Couldn&apos;t load {year} totals.</p>
      ) : !summary ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading {year}…
        </p>
      ) : summary.incomeByApp.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No business income recorded for {year}.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border/70">
          {summary.incomeByApp.map((app) => (
            <li key={app.key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="text-foreground">
                {app.label}
                {app.over1099KAmount ? <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">1099-K possible</span> : null}
              </span>
              <span className="tabular-nums text-foreground">{formatCurrency(app.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        All business income is taxable, whether or not an app sends you a 1099-K.
        {anyOver || anyNear
          ? ` Apps report once you pass both $${summary?.form1099K.amountOver.toLocaleString("en-US")} and ${summary?.form1099K.transactionsOver} payments on one app.`
          : ""}
      </p>

      <div className="mt-4 rounded-2xl bg-muted/60 p-4">
        <p className="text-sm font-medium text-foreground">Tax-time package for {year}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          One download for your tax preparer: a Schedule C summary, income by app, mileage log, estimated tax payments,
          and every receipt.
        </p>
        <Button className="mt-3" onClick={download} disabled={building || !summary}>
          {building ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          {building ? "Building… this can take a minute" : "Download package"}
        </Button>
      </div>
    </section>
  )
}
