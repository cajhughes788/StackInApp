"use client"

import { useEffect } from "react"

import { reportCrash } from "@/lib/crashReports"

// Last resort: an error in the root layout itself (app/app/error.tsx handles
// the app's pages). It replaces the whole page, global styles included, so
// it's styled inline.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportCrash("global_error_screen", error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#ECEBE6", color: "#161B1E", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "25vh 24px 40px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            The app hit an unexpected error. Your data is still safe. Try reloading.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 24, border: 0, borderRadius: 8, padding: "8px 16px", background: "#2FA866", color: "#fff", fontSize: 14, fontWeight: 500 }}
          >
            Reload App
          </button>
        </div>
      </body>
    </html>
  )
}
