"use client"

import { useEffect, useState } from "react"

// Where Stripe's hosted Connect sign-up sends the person back (return_url /
// refresh_url, built in paymentAccountsService.ts). It's opened in the
// in-app browser on iOS, which doesn't share the app's state, so it only
// hands control back: client=native → the app's stackin:// scheme (see
// lib/mobile/stripeOnboarding.ts); otherwise → Invoice settings, which
// re-reads the account (result=done) or asks for a fresh link (refresh).
export default function StripeReturnPage() {
  const [native, setNative] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get("result") === "refresh" ? "refresh" : "done"
    if (params.get("client") === "native") {
      setNative(true)
      window.location.href = `stackin://stripe/onboarding-return?result=${result}`
      return
    }
    window.location.replace(`/app/invoices/settings?stripe=${result}`)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{native ? "All set" : "Returning to 521…"}</h1>
        {native ? <p className="text-sm text-muted-foreground">You can close this window and go back to 521.</p> : null}
      </div>
    </main>
  )
}
