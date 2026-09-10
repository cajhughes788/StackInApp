"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { usePlaidLink } from "react-plaid-link"

// sessionStorage, not a query param, survives the full-page navigation to
// the bank's OAuth login and back — Plaid/the bank control the return URL's
// query params (just oauth_state_id), so there's no way to round-trip our
// own linkToken param through that redirect.
const LINK_TOKEN_STORAGE_KEY = "stackin_plaid_link_token"

// Standalone page opened inside the native in-app browser
// (@capacitor/browser) to run Plaid Link outside the app's own WKWebView —
// Plaid Link needs a real browser context. On completion it redirects to the
// app's stackin:// URL scheme (already declared in Info.plist), which
// frontend/lib/mobile/plaidLinkDeepLink.ts listens for; the app then
// exchanges the public token with its own authenticated session, since this
// in-app browser tab does not share the app's Firebase auth state.
//
// This same page also doubles as the OAuth redirect_uri registered in the
// Plaid Dashboard (see PLAID_OAUTH_REDIRECT_URI in plaidService.ts) — for
// institutions that require Plaid's OAuth flow (a growing list, including
// several major banks), Link navigates this browser tab away to the bank's
// own login page, and the bank redirects back to this same URL with an
// oauth_state_id param. That's a full page reload, not a callback, so the
// original link token has to be persisted (sessionStorage) rather than
// carried in memory, and Link is resumed via receivedRedirectUri instead of
// started fresh.
function PlaidLinkRunner() {
  const searchParams = useSearchParams()
  const oauthStateId = searchParams.get("oauth_state_id")
  const [linkToken, setLinkToken] = useState<string | null>(null)

  useEffect(() => {
    if (oauthStateId) {
      // Resuming after the bank's OAuth redirect — the token from the URL
      // is gone by now, only sessionStorage has it.
      setLinkToken(sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY))
      return
    }
    const freshToken = searchParams.get("linkToken")
    if (freshToken) {
      sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, freshToken)
    }
    setLinkToken(freshToken)
  }, [oauthStateId, searchParams])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    receivedRedirectUri: oauthStateId ? window.location.href : undefined,
    onSuccess: (publicToken, metadata) => {
      sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY)
      // Carried through so the native app can check for an accidental
      // duplicate connection before exchanging — see exchangePublicToken in
      // plaidService.ts. This in-app browser tab has no way to reach the
      // app's own API directly (no auth session here), so this redirect is
      // the only path for this data to get back to the app at all.
      const accounts = metadata.accounts.map((account) => ({ name: account.name, mask: account.mask }))
      const params = new URLSearchParams({ public_token: publicToken })
      if (metadata.institution?.institution_id) {
        params.set("institution_id", metadata.institution.institution_id)
      }
      params.set("accounts", JSON.stringify(accounts))
      window.location.href = `stackin://plaid/link-complete?${params.toString()}`
    },
    onExit: () => {
      sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY)
      window.location.href = "stackin://plaid/link-complete"
    },
  })

  useEffect(() => {
    // receivedRedirectUri mode resumes automatically once ready; calling
    // open() ourselves is still required for the normal (non-OAuth-resume)
    // path, and is a harmless no-op if Link has already auto-opened.
    if (ready) open()
  }, [ready, open])

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Connecting to your bank...
    </div>
  )
}

export default function PlaidLinkPage() {
  return (
    <Suspense fallback={null}>
      <PlaidLinkRunner />
    </Suspense>
  )
}
