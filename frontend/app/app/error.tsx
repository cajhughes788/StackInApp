"use client"

import { useEffect, useState } from "react"

import { clearAllLocalDomainData } from "@/lib/domain"
import { debugError } from "@/lib/debugLoop"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [resettingCache, setResettingCache] = useState(false)

  useEffect(() => {
    debugError("app-error-boundary", "segment_error", {
      message: error.message,
      stack: error.stack ?? null,
      digest: error.digest ?? null,
    })
  }, [error])

  async function handleResetCache() {
    setResettingCache(true)
    try {
      await clearAllLocalDomainData()
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("stackin-active-workspace-id")
        window.localStorage.removeItem("stackin-workspace-snapshot")
        window.location.replace("/app")
      }
    } finally {
      setResettingCache(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
        <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The app hit an unexpected startup error. Your data is still safe. Try
            reloading first, and if it keeps happening, reset the local cache on this
            device.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Reload App
            </button>
            <button
              type="button"
              onClick={() => void handleResetCache()}
              disabled={resettingCache}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-60"
            >
              {resettingCache ? "Resetting Cache..." : "Reset Local Cache"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
