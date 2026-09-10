"use client"

import { useCallback, useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Browser } from "@capacitor/browser"
import { usePlaidLink } from "react-plaid-link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { ApiError } from "@/lib/api/core/errors"
import {
  exchangePlaidPublicToken,
  getPlaidItems,
  getPlaidLinkToken,
  getPlaidUpdateLinkToken,
  unlinkPlaidItem,
  updatePlaidAccountDefault,
  type PlaidItem,
} from "@/lib/api/plaidApi"
import { waitForPlaidLinkExit } from "@/lib/mobile/plaidLinkDeepLink"

type LinkMetadata = { institutionId: string | null; accounts: Array<{ name: string; mask: string | null }> }

// window.location.origin inside the native app is Capacitor's internal
// webview origin (e.g. capacitor://localhost), not a real HTTPS URL —
// @capacitor/browser's SFSafariViewController-backed Browser.open() can't
// display it ("Unable to display URL"). Note this is NOT stackin-app.com —
// that domain is a separate GitHub Pages marketing site (used only for
// Stripe checkout redirects and the public signup link) and doesn't serve
// this Next.js app at all. This app's actual Firebase Hosting deploy lives
// at stackin.web.app.
const STACKIN_APP_HOSTING_URL =
  process.env.NEXT_PUBLIC_STACKIN_APP_HOSTING_URL?.trim() || "https://stackin.web.app"

function WebPlaidLink({
  linkToken,
  onSuccess,
  onExit,
}: {
  linkToken: string
  onSuccess: (publicToken: string, metadata: LinkMetadata) => void
  onExit: () => void
}) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken, metadata) =>
      onSuccess(publicToken, {
        institutionId: metadata.institution?.institution_id ?? null,
        accounts: metadata.accounts.map((account) => ({ name: account.name, mask: account.mask })),
      }),
    onExit: () => onExit(),
  })
  useEffect(() => {
    if (ready) open()
  }, [ready, open])
  return null
}

export default function PlaidConnectButton({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [items, setItems] = useState<PlaidItem[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [webLinkToken, setWebLinkToken] = useState<string | null>(null)
  const [webLinkMode, setWebLinkMode] = useState<"connect" | "reconnect">("connect")
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null)
  const [unlinkPromptItem, setUnlinkPromptItem] = useState<PlaidItem | null>(null)
  const isNative = Capacitor.isNativePlatform()

  const loadItems = useCallback(async () => {
    try {
      setItems(await getPlaidItems(workspaceId))
    } catch {
      // Best-effort — the account page still functions without the list.
    }
  }, [workspaceId])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const finishExchange = useCallback(
    async (publicToken: string, linkMetadata: LinkMetadata) => {
      try {
        await exchangePlaidPublicToken(workspaceId, publicToken, linkMetadata)
        toast({ title: "Bank connected" })
        await loadItems()
      } catch (err) {
        // A 409 here means the duplicate-connection check in
        // exchangePublicToken (plaidService.ts) caught this before it ever
        // created a second Item for an account already linked to this
        // workspace — that's an expected, specific outcome worth its own
        // message, not a generic failure.
        const isDuplicate = err instanceof ApiError && err.status === 409
        toast({
          title: isDuplicate ? "Already connected" : "Couldn't finish connecting your bank",
          description: isDuplicate ? err.message : undefined,
          variant: "destructive",
        })
      } finally {
        setIsConnecting(false)
      }
    },
    [workspaceId, toast, loadItems]
  )

  // Shared between a brand-new connection and a reconnect (update mode) —
  // both run the identical native-in-app-browser-or-web Link flow, and only
  // differ in what happens with the result. Update mode never issues a new
  // public token to exchange (Plaid marks the existing Item healthy again
  // via its own webhook once the user completes it), so mode determines
  // whether a truthy result gets exchanged or just treated as "done."
  async function runLinkFlow(linkToken: string, mode: "connect" | "reconnect") {
    if (isNative) {
      const exitPromise = waitForPlaidLinkExit()
      await Browser.open({ url: `${STACKIN_APP_HOSTING_URL}/plaid-link?linkToken=${encodeURIComponent(linkToken)}` })
      const exitResult = await exitPromise
      // No-op if the browser was already dismissed by the user (that's what
      // resolved exitPromise in the first place) — closing an already-closed
      // browser is harmless, but guard it so that can never throw here.
      await Browser.close().catch(() => {})
      if (mode === "connect") {
        if (exitResult) {
          await finishExchange(exitResult.publicToken, {
            institutionId: exitResult.institutionId,
            accounts: exitResult.accounts,
          })
        } else {
          setIsConnecting(false)
        }
      } else {
        if (exitResult) {
          toast({ title: "Bank reconnected" })
          await loadItems()
        }
        setIsConnecting(false)
        setReconnectingItemId(null)
      }
    } else {
      // Native fully awaits the flow above before returning; the web branch
      // just hands off to the rendered <WebPlaidLink> below and returns
      // immediately — its onSuccess/onExit callbacks are what actually
      // finish this (including clearing isConnecting/reconnectingItemId),
      // not this function.
      setWebLinkMode(mode)
      setWebLinkToken(linkToken)
    }
  }

  async function handleConnect() {
    setIsConnecting(true)
    try {
      const linkToken = await getPlaidLinkToken()
      await runLinkFlow(linkToken, "connect")
    } catch {
      toast({ title: "Couldn't start bank connection", variant: "destructive" })
      setIsConnecting(false)
    }
  }

  async function handleReconnect(itemId: string) {
    setIsConnecting(true)
    setReconnectingItemId(itemId)
    try {
      const linkToken = await getPlaidUpdateLinkToken(workspaceId, itemId)
      await runLinkFlow(linkToken, "reconnect")
    } catch {
      toast({ title: "Couldn't start reconnect", variant: "destructive" })
      setIsConnecting(false)
      setReconnectingItemId(null)
    }
  }

  async function handleAccountDefaultChange(itemId: string, accountId: string, value: string) {
    const defaultBusiness = value === "business" ? true : value === "personal" ? false : null
    const previousItems = items
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              linkedAccounts: item.linkedAccounts.map((account) =>
                account.accountId === accountId ? { ...account, defaultBusiness } : account
              ),
            }
          : item
      )
    )
    try {
      await updatePlaidAccountDefault(workspaceId, itemId, accountId, defaultBusiness)
    } catch {
      setItems(previousItems)
      toast({ title: "Couldn't save this account's default", variant: "destructive" })
    }
  }

  async function handleUnlink(itemId: string) {
    try {
      await unlinkPlaidItem(workspaceId, itemId)
      await loadItems()
      toast({ title: "Bank disconnected" })
    } catch {
      toast({ title: "Couldn't disconnect this bank", variant: "destructive" })
    } finally {
      setUnlinkPromptItem(null)
    }
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-muted px-3 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{item.institutionName ?? "Connected bank"}</div>
              {item.status === "error" ? (
                <div className="text-xs text-destructive">Connection needs attention</div>
              ) : (
                <div className="text-xs text-muted-foreground">{item.linkedAccounts.length} account(s)</div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {item.status === "error" ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleReconnect(item.id)}
                  disabled={isConnecting}
                  title="Fixes this connection in place (e.g. after a bank password change) without creating a duplicate, separately-tracked connection."
                >
                  {reconnectingItemId === item.id ? "Reconnecting..." : "Reconnect"}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setUnlinkPromptItem(item)}
              >
                Unlink
              </Button>
            </div>
          </div>

          {item.status !== "error" && item.linkedAccounts.length > 0 ? (
            <div className="space-y-1.5 border-t border-muted pt-2">
              {item.linkedAccounts.map((account) => (
                <div key={account.accountId} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ""}
                  </span>
                  <Select
                    value={
                      account.defaultBusiness === true
                        ? "business"
                        : account.defaultBusiness === false
                          ? "personal"
                          : "auto"
                    }
                    onValueChange={(value) => void handleAccountDefaultChange(item.id, account.accountId, value)}
                  >
                    <SelectTrigger className="h-7 w-[150px] text-xs" title="New transactions from this account default to this classification unless a specific merchant has been confirmed or dismissed before.">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="business">Default: Business</SelectItem>
                      <SelectItem value="personal">Default: Personal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <Button variant="outline" className="w-full" onClick={handleConnect} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : "Connect a bank"}
      </Button>

      {webLinkToken ? (
        <WebPlaidLink
          linkToken={webLinkToken}
          onSuccess={(publicToken, metadata) => {
            setWebLinkToken(null)
            if (webLinkMode === "connect") {
              void finishExchange(publicToken, metadata)
            } else {
              toast({ title: "Bank reconnected" })
              setIsConnecting(false)
              setReconnectingItemId(null)
              void loadItems()
            }
          }}
          onExit={() => {
            setWebLinkToken(null)
            setIsConnecting(false)
            setReconnectingItemId(null)
          }}
        />
      ) : null}

      <AlertDialog open={unlinkPromptItem != null} onOpenChange={(open) => !open && setUnlinkPromptItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {unlinkPromptItem?.institutionName ?? "this bank"}?</AlertDialogTitle>
            <AlertDialogDescription>
              StackIn will stop pulling in new transactions from this account. Transactions you've
              already reviewed and confirmed stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlinkPromptItem && void handleUnlink(unlinkPromptItem.id)}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
