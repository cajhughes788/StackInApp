"use client"

import { useEffect, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { CreditCard, ExternalLink, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { cardClass, useQueryParam } from "@/components/invoices/invoice-ui"
import { updatePaymentAccount } from "@/lib/api/invoicesApi"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { cn } from "@/lib/utils"
import type { PaymentAccount } from "@shared/schemas/paymentAccount"

// "Get paid online" — Stripe Connect sign-up and status in Invoice settings.
// Sign-up runs on Stripe's own hosted pages: the in-app browser on iOS, a
// full-page redirect on the web (which comes back through app/stripe-return
// to ?stripe=done|refresh here).

type Busy = null | "onboard" | "refresh" | "dashboard" | "toggle"

function StatusLine({ account }: { account: PaymentAccount }) {
  const copy: Record<PaymentAccount["status"], { text: string; tone: string }> = {
    onboarding: { text: "Setup isn't finished", tone: "text-muted-foreground" },
    verifying: { text: "Stripe is checking your details — usually a few minutes", tone: "text-muted-foreground" },
    active: { text: "Ready to take payments", tone: "text-emerald-700 dark:text-emerald-400" },
    restricted: {
      text:
        account.requirementsDueCount > 0
          ? `Stripe needs ${account.requirementsDueCount === 1 ? "one more detail" : `${account.requirementsDueCount} more details`}`
          : "Stripe has paused payments on this account",
      tone: "text-red-700 dark:text-red-400",
    },
  }
  const { text, tone } = copy[account.status]
  return <p className={cn("text-sm font-medium", tone)}>{text}</p>
}

export default function OnlinePaymentsCard({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const account = useInvoicesStore((state) => state.byWorkspaceId[workspaceId]?.paymentAccount ?? null)
  const setPaymentAccount = useInvoicesStore((state) => state.setPaymentAccount)
  const [busy, setBusy] = useState<Busy>(null)
  const handledReturn = useRef(false)
  const stripeReturn = useQueryParam("stripe")

  function fail(title: string, error: unknown) {
    toast({
      title,
      description: error instanceof Error ? error.message : "Check your connection and try again.",
      variant: "destructive",
    })
  }

  async function refresh(quiet = false) {
    setBusy("refresh")
    try {
      const result = await updatePaymentAccount(workspaceId, { action: "refresh" })
      setPaymentAccount(workspaceId, result.paymentAccount)
      if (!quiet && result.paymentAccount?.status === "active") toast({ title: "You're set up to get paid online" })
    } catch (error) {
      if (!quiet) fail("Couldn't check your Stripe account", error)
    } finally {
      setBusy(null)
    }
  }

  async function onboard() {
    setBusy("onboard")
    try {
      const native = Capacitor.isNativePlatform()
      const result = await updatePaymentAccount(workspaceId, { action: "onboard", client: native ? "native" : "browser" })
      setPaymentAccount(workspaceId, result.paymentAccount)
      if (!result.url) throw new Error("Stripe didn't return a sign-up link.")
      if (!native) {
        window.location.href = result.url
        return
      }
      const { runNativeStripeOnboarding } = await import("@/lib/mobile/stripeOnboarding")
      const outcome = await runNativeStripeOnboarding(result.url)
      setBusy(null)
      // Closed early or finished: either way, see where Stripe got to.
      await refresh(outcome !== "done")
      if (outcome === "refresh") toast({ title: "That link expired", description: "Tap Continue setup to pick up where you left off." })
    } catch (error) {
      fail("Couldn't open Stripe", error)
      setBusy(null)
    }
  }

  async function openDashboard() {
    setBusy("dashboard")
    try {
      const result = await updatePaymentAccount(workspaceId, { action: "dashboard" })
      if (!result.url) throw new Error("Stripe didn't return a dashboard link.")
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser")
        await Browser.open({ url: result.url })
      } else {
        window.open(result.url, "_blank", "noopener,noreferrer")
      }
    } catch (error) {
      fail("Couldn't open your Stripe dashboard", error)
    } finally {
      setBusy(null)
    }
  }

  async function setAcceptOnline(acceptOnline: boolean) {
    setBusy("toggle")
    try {
      const result = await updatePaymentAccount(workspaceId, { action: "set_accept_online", acceptOnline })
      setPaymentAccount(workspaceId, result.paymentAccount)
    } catch (error) {
      fail("Couldn't change online payments", error)
    } finally {
      setBusy(null)
    }
  }

  // Back from Stripe on the web (app/stripe-return → ?stripe=done|refresh).
  useEffect(() => {
    if (handledReturn.current) return
    const back = stripeReturn
    if (!back) return
    handledReturn.current = true
    window.history.replaceState(null, "", window.location.pathname)
    if (back === "refresh") void onboard()
    else void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeReturn])

  return (
    <section className={cn(cardClass, "space-y-3")} aria-labelledby="online-payments-heading">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
          <CreditCard className="size-[18px]" aria-hidden="true" />
        </span>
        <h2 id="online-payments-heading" className="font-semibold text-foreground">
          Get paid online
        </h2>
      </div>

      {!account ? (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Let clients pay by card, Apple Pay or Google Pay straight from your invoice link. Stripe handles the
            payment and pays out to your bank. Stripe&apos;s fee is 2.9% + 30¢ per card payment — 521 adds nothing.
          </p>
          <Button type="button" className="h-11 rounded-full px-5 font-semibold" disabled={busy !== null} onClick={() => void onboard()}>
            {busy === "onboard" ? "Opening Stripe..." : "Set up with Stripe"}
          </Button>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Stripe asks for your identity and bank details on its own secure pages. 521 never sees them.
          </p>
        </>
      ) : (
        <>
          <StatusLine account={account} />

          {account.status === "onboarding" || account.status === "restricted" ? (
            <Button type="button" className="h-11 rounded-full px-5 font-semibold" disabled={busy !== null} onClick={() => void onboard()}>
              {busy === "onboard" ? "Opening Stripe..." : account.status === "onboarding" ? "Continue setup" : "Update details"}
            </Button>
          ) : null}

          {account.status === "verifying" ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full border-card-border px-5 font-semibold"
              disabled={busy !== null}
              onClick={() => void refresh()}
            >
              {busy === "refresh" ? "Checking..." : "Check again"}
            </Button>
          ) : null}

          {account.chargesEnabled ? (
            <label className="flex items-center justify-between gap-4 rounded-xl bg-muted px-3.5 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Show a Pay button on invoices</span>
                <span className="block text-xs text-muted-foreground">Clients pay on Stripe&apos;s checkout page — no account needed.</span>
              </span>
              <Switch
                checked={account.acceptOnline}
                disabled={busy !== null}
                onCheckedChange={(checked) => void setAcceptOnline(checked)}
                aria-label="Show a Pay button on invoices"
              />
            </label>
          ) : null}

          {account.chargesEnabled ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {account.achStatus === "active"
                ? "Clients can also pay by bank transfer: 0.8%, capped at $5 — the cheapest option on big invoices."
                : account.achStatus === "pending"
                  ? "Bank transfers are being turned on by Stripe."
                  : "Bank transfers (0.8%, capped at $5) need a little more info — tap Update details if Stripe asks."}
            </p>
          ) : null}

          {account.detailsSubmitted ? (
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
              disabled={busy !== null}
              onClick={() => void openDashboard()}
            >
              {busy === "dashboard" ? "Opening..." : "Payouts and bank details in Stripe"}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}
