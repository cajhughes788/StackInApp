"use client"

import { useEffect, useState } from "react"
import { Unbounded } from "next/font/google"

// The website's headline face (the521app.com's FIVE TO ONE opener), so the
// page reads as the same brand as the pricing page people just came from.
// Loaded here only, not app-wide.
const statement = Unbounded({ subsets: ["latin"], weight: ["700"], display: "swap" })

// Checkout success (and cancel) page for subscriptions bought from the iOS
// app. Stripe Checkout sends people here (success_url / cancel_url for
// source=ios-app, built in backend/functions/src/routes/createCheckoutSession.ts).
//
// Checkout runs in Safari, which doesn't share the app's state, so this page
// only confirms the outcome and hands control back through the app's
// stackin:// scheme; the app re-checks the subscription when it opens
// (app/welcome/page.tsx). Safari asks "Open in 521?" before following a
// custom scheme, so the button is the reliable path and the automatic
// redirect is a convenience.
type Outcome = "success" | "cancel"

export default function CheckoutReturnPage() {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [appUrl, setAppUrl] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result: Outcome = params.get("result") === "cancel" ? "cancel" : "success"

    if (params.get("source") !== "ios-app") {
      // Not from the app: the web app's own setup flow picks it up.
      window.location.replace(result === "success" ? "/welcome?checkout=success" : "/welcome")
      return
    }

    const url = `stackin://checkout/return?result=${result}`
    setOutcome(result)
    setAppUrl(url)
    window.location.href = url
  }, [])

  // Nothing to show until the outcome is known (avoids a flash of the
  // success copy on a canceled checkout, or on the web redirect).
  if (!outcome || !appUrl) {
    return <main className="min-h-screen bg-background" />
  }

  const success = outcome === "success"

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export */}
        <img src="/brand/521-wordmark-dark.svg" alt="521" width={176} height={95} className="mb-12 h-auto w-44" />

        <h1 className={`${statement.className} text-balance text-[1.75rem] font-bold leading-tight tracking-[-0.02em] sm:text-4xl`}>
          {success ? "You're subscribed" : "Checkout canceled"}
        </h1>
        <p className="mt-4 max-w-sm text-balance text-base text-muted-foreground">
          {success
            ? "Your plan is active. Head back to 521 to set up your first workspace."
            : "No charge was made. You can pick a plan in 521 whenever you're ready."}
        </p>

        <a
          href={appUrl}
          className="mt-10 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
        >
          {success ? "Open 521" : "Back to 521"}
        </a>

        <p className="mt-5 max-w-xs text-balance text-sm text-muted-foreground">
          {success
            ? "If 521 doesn't open, switch back to the app. Your subscription will be there."
            : "If 521 doesn't open, just switch back to the app."}
        </p>
      </div>
    </main>
  )
}
