"use client"

import { useEffect } from "react"

import { wakeChargeServers } from "@/lib/api/invoicesApi"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"

// When Home is up, and again whenever the app comes back on screen, wake
// the servers Charge now uses, so the QR code and the customer's pay page
// both load at once. Only for workspaces that take card payments.

export function useWarmChargeServers(workspaceId: string | null): void {
  // Home's Needs-you panel loads the invoices store, payment account included.
  const takesPayments = useInvoicesStore((s) => {
    const account = workspaceId ? s.byWorkspaceId[workspaceId]?.paymentAccount : null
    return !!account?.chargesEnabled && !!account.acceptOnline
  })

  useEffect(() => {
    if (!takesPayments) return
    wakeChargeServers()
    const onVisible = () => {
      if (document.visibilityState === "visible") wakeChargeServers()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [takesPayments])
}
