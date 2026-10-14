"use client"

import { Plus } from "lucide-react"

import { useCallback, useEffect, useRef, useState } from "react"
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
import { Skeleton } from "@/components/ui/skeleton"
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
  type PlaidLinkClient,
} from "@/lib/api/plaidApi"
import { waitForPlaidLinkExit, type PlaidLinkExitResult } from "@/lib/mobile/plaidLinkDeepLink"
import {
  isNativePlaidLinkAvailable,
  openNativePlaidLink,
  preloadNativePlaidLink,
} from "@/lib/mobile/nativePlaidLink"

type LinkMetadata = { institutionId: string | null; accounts: Array<{ name: string; mask: string | null }> }

// Mirrors useWorkspaceStore's persisted-snapshot pattern: without this, `items`
// always starts at [] and every mount of this component (e.g. opening Account
// Settings) shows "no bank connected" for a beat before loadItems() resolves,
// even when a connection has existed for months. Cache the last-known list
// per workspace so the connected-bank cards render immediately, then let
// loadItems() silently reconcile in the background.
//
// No expiry: the snapshot is always revalidated on mount, so an old one only
// ever shows briefly before being corrected — whereas the 5-minute TTL this
// used to have meant almost every visit (they're rarely 5 minutes apart)
// started from nothing and flashed "Connect a bank" anyway.
const PLAID_ITEMS_CACHE_PREFIX = "plaid_items_snapshot:"

// null = no snapshot for this workspace on this device (vs. a snapshot that
// says "no banks"), so the first load can show a loading state instead of
// an empty, unconnected-looking section.
function loadCachedPlaidItems(workspaceId: string): PlaidItem[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(PLAID_ITEMS_CACHE_PREFIX + workspaceId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { items?: unknown }
    return Array.isArray(parsed.items) ? (parsed.items as PlaidItem[]) : null
  } catch {
    return null
  }
}

function persistCachedPlaidItems(workspaceId: string, items: PlaidItem[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      PLAID_ITEMS_CACHE_PREFIX + workspaceId,
      JSON.stringify({ items, writtenAt: Date.now() })
    )
  } catch {
    // ignore storage failures — cache is a best-effort convenience
  }
}

// window.location.origin inside the native app is Capacitor's internal
// webview origin (e.g. capacitor://localhost), not a real HTTPS URL —
// @capacitor/browser's SFSafariViewController-backed Browser.open() can't
// display it ("Unable to display URL"). Note this is NOT stackin-app.com —
// that domain is a separate GitHub Pages marketing site (used only for
// Stripe checkout redirects and the public signup link) and doesn't serve
// this Next.js app at all. This app's actual Firebase Hosting deploy lives
// at stackin.web.app.
//
// Only used as a fallback now — iOS builds with NativePlaidLinkPlugin run
// Plaid's native SDK instead (see runLinkFlow below).
const STACKIN_APP_HOSTING_URL =
  process.env.NEXT_PUBLIC_STACKIN_APP_HOSTING_URL?.trim() || "https://stackin.web.app"

// Plaid link tokens last 4 hours; anything older than this gets replaced
// rather than risk handing Link one that's about to expire.
const PREFETCHED_LINK_TOKEN_MAX_AGE_MS = 30 * 60 * 1000

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
  // null until either the cached snapshot or the first fetch says what's
  // connected — rendered as a loading state, never as "no banks".
  const [items, setItems] = useState<PlaidItem[] | null>(() => loadCachedPlaidItems(workspaceId))
  const [loadFailed, setLoadFailed] = useState(false)
  // Guards against a slow response for a previous workspace landing after a
  // switch and overwriting the current one's list.
  const activeRequestIdRef = useRef(0)
  const [isConnecting, setIsConnecting] = useState(false)
  const [webLinkToken, setWebLinkToken] = useState<string | null>(null)
  const [webLinkMode, setWebLinkMode] = useState<"connect" | "reconnect">("connect")
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null)
  const [unlinkPromptItem, setUnlinkPromptItem] = useState<PlaidItem | null>(null)
  // Shown once, immediately after a brand-new link succeeds — see
  // handleClassifyChoice below for why this is the single highest-leverage
  // moment to ask, instead of leaving the per-account default buried in a
  // dropdown someone has to notice on their own.
  const [classifyPrompt, setClassifyPrompt] = useState<PlaidItem | null>(null)
  const isNative = Capacitor.isNativePlatform()
  const useNativeSdk = isNativePlaidLinkAvailable()
  const linkClient: PlaidLinkClient = useNativeSdk ? "ios-native" : "browser"

  // A link token for the next "Connect a bank" tap, fetched as soon as this
  // page opens instead of after the tap. Fetching it on tap is what made the
  // button sit on "Connecting..." for seconds: the token request often hit
  // a cold-started server. On iOS the token also lets Plaid's SDK preload
  // Link in the background, so the tap just shows it. Each token is used
  // for a single Link session, so it's cleared when taken.
  const prefetchedLinkTokenRef = useRef<{ promise: Promise<string>; fetchedAt: number } | null>(null)

  const prefetchLinkToken = useCallback(() => {
    const entry = { promise: getPlaidLinkToken(linkClient), fetchedAt: Date.now() }
    prefetchedLinkTokenRef.current = entry
    entry.promise.then(
      (token) => {
        if (useNativeSdk && prefetchedLinkTokenRef.current === entry) void preloadNativePlaidLink(token)
      },
      () => {
        if (prefetchedLinkTokenRef.current === entry) prefetchedLinkTokenRef.current = null
      }
    )
  }, [linkClient, useNativeSdk])

  async function takeLinkToken(): Promise<string> {
    const entry = prefetchedLinkTokenRef.current
    prefetchedLinkTokenRef.current = null
    if (entry && Date.now() - entry.fetchedAt < PREFETCHED_LINK_TOKEN_MAX_AGE_MS) {
      try {
        return await entry.promise
      } catch {
        // fall through to a fresh request
      }
    }
    return getPlaidLinkToken(linkClient)
  }

  // On page open, and again once each Link flow finishes, so the next tap
  // (e.g. "Connect another bank") is just as quick.
  useEffect(() => {
    if (!isConnecting && !prefetchedLinkTokenRef.current) prefetchLinkToken()
  }, [isConnecting, prefetchLinkToken])

  const loadItems = useCallback(async (): Promise<PlaidItem[]> => {
    const requestId = ++activeRequestIdRef.current
    try {
      const fetched = await getPlaidItems(workspaceId)
      if (activeRequestIdRef.current === requestId) {
        setItems(fetched)
        setLoadFailed(false)
      }
      persistCachedPlaidItems(workspaceId, fetched)
      return fetched
    } catch {
      // Keep whatever is showing (the cached list) rather than blanking it —
      // a failed request says nothing about whether banks are connected.
      if (activeRequestIdRef.current === requestId) setLoadFailed(true)
      return []
    }
  }, [workspaceId])

  // On mount and on workspace switch (this component isn't remounted when
  // the active workspace changes): show that workspace's snapshot, then
  // revalidate.
  const mountedWorkspaceIdRef = useRef(workspaceId)
  useEffect(() => {
    if (mountedWorkspaceIdRef.current !== workspaceId) {
      mountedWorkspaceIdRef.current = workspaceId
      setItems(loadCachedPlaidItems(workspaceId))
      setLoadFailed(false)
    }
    void loadItems()
  }, [workspaceId, loadItems])

  const finishExchange = useCallback(
    async (publicToken: string, linkMetadata: LinkMetadata) => {
      try {
        const { itemId } = await exchangePlaidPublicToken(workspaceId, publicToken, linkMetadata)
        const fetched = await loadItems()
        // Ask business-vs-personal right now, while the user is still in the
        // "I just linked this account" mindset — this is what actually feeds
        // the classifier from the very first transaction instead of leaving
        // every one unclassified until someone notices the per-account
        // default buried in this same settings page.
        const newItem = fetched.find((item) => item.id === itemId)
        if (newItem && newItem.linkedAccounts.length > 0) {
          setClassifyPrompt(newItem)
        }
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
      const exitResult = useNativeSdk ? await runNativeSdkLink(linkToken) : await runBrowserLink(linkToken)
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

  // Plaid's native iOS SDK — see NativePlaidLinkPlugin.swift.
  async function runNativeSdkLink(linkToken: string): Promise<PlaidLinkExitResult | null> {
    const result = await openNativePlaidLink(linkToken)
    if (result.status === "success") {
      return { publicToken: result.publicToken, institutionId: result.institutionId, accounts: result.accounts }
    }
    // No message when the user simply closed Link — only when it failed.
    if (result.errorMessage) {
      toast({ title: "Couldn't connect your bank", description: result.errorMessage, variant: "destructive" })
    }
    return null
  }

  // Fallback for native builds without the plugin: Plaid's web Link on the
  // /plaid-link page in an in-app browser, which hands the result back via
  // the stackin:// redirect.
  async function runBrowserLink(linkToken: string): Promise<PlaidLinkExitResult | null> {
    const exitPromise = waitForPlaidLinkExit()
    await Browser.open({ url: `${STACKIN_APP_HOSTING_URL}/plaid-link?linkToken=${encodeURIComponent(linkToken)}` })
    const exitResult = await exitPromise
    // No-op if the browser was already dismissed by the user (that's what
    // resolved exitPromise in the first place) — closing an already-closed
    // browser is harmless, but guard it so that can never throw here.
    await Browser.close().catch(() => {})
    return exitResult
  }

  async function handleConnect() {
    setIsConnecting(true)
    try {
      const linkToken = await takeLinkToken()
      await runLinkFlow(linkToken, "connect")
    } catch {
      toast({ title: "Couldn't start bank connection", variant: "destructive" })
      setIsConnecting(false)
    }
  }

  async function handleReconnect(itemId: string) {
    setIsConnecting(true)
    setReconnectingItemId(itemId)
    // The SDK holds one preloaded session at a time and this reconnect
    // replaces it, so drop the prefetched token too — a fresh one (and
    // preload) follows once this flow finishes.
    if (useNativeSdk) prefetchedLinkTokenRef.current = null
    try {
      const linkToken = await getPlaidUpdateLinkToken(workspaceId, itemId, linkClient)
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
      prev &&
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

  // "Mix" (defaultBusiness === null) needs no API call at all — a freshly
  // linked account already starts on auto-detect, so choosing it (or just
  // dismissing the prompt) simply leaves that alone.
  async function handleClassifyChoice(defaultBusiness: boolean | null) {
    const item = classifyPrompt
    setClassifyPrompt(null)
    if (!item || defaultBusiness === null) return
    try {
      await Promise.all(
        item.linkedAccounts.map((account) =>
          updatePlaidAccountDefault(workspaceId, item.id, account.accountId, defaultBusiness)
        )
      )
      setItems((prev) =>
        prev &&
        prev.map((current) =>
          current.id === item.id
            ? {
                ...current,
                linkedAccounts: current.linkedAccounts.map((account) => ({ ...account, defaultBusiness })),
              }
            : current
        )
      )
    } catch {
      toast({ title: "Couldn't save this account's default", variant: "destructive" })
    }
  }

  async function handleUnlink(itemId: string) {
    try {
      await unlinkPlaidItem(workspaceId, itemId)
      await loadItems()
    } catch {
      toast({ title: "Couldn't disconnect this bank", variant: "destructive" })
    } finally {
      setUnlinkPromptItem(null)
    }
  }

  return (
    <div className="space-y-3">
      {items === null && !loadFailed ? (
        <div className="space-y-2 rounded-2xl bg-muted px-4 py-3" aria-label="Checking your connected banks">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : null}

      {items === null && loadFailed ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">Couldn&apos;t check your connected banks.</span>
          <Button variant="ghost" size="sm" onClick={() => void loadItems()}>
            Try again
          </Button>
        </div>
      ) : null}

      {(items ?? []).map((item) => (
        <div key={item.id} className="space-y-3 rounded-2xl bg-muted p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-base font-semibold text-foreground" aria-hidden="true">
              {(item.institutionName ?? "B").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{item.institutionName ?? "Connected bank"}</div>
              {item.status === "error" ? (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                  Connection needs attention
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  Connected · {item.linkedAccounts.length} account(s)
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {item.status === "error" ? (
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-full"
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
                className="rounded-full text-muted-foreground hover:text-destructive"
                onClick={() => setUnlinkPromptItem(item)}
              >
                Unlink
              </Button>
            </div>
          </div>

          {item.status !== "error" && item.linkedAccounts.length > 0 ? (
            <div className="divide-y divide-border/70 rounded-xl bg-card px-3">
              {item.linkedAccounts.map((account) => (
                <div key={account.accountId} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
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
                    <SelectTrigger className="h-7 w-[150px] shrink-0 rounded-full border-0 bg-muted text-xs shadow-none" title="New transactions from this account default to this classification unless a specific merchant has been confirmed or dismissed before.">
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

      <Button className="h-11 w-full rounded-2xl text-base font-semibold" onClick={handleConnect} disabled={isConnecting}>
        <Plus className="size-4" aria-hidden="true" />
        {isConnecting ? "Connecting..." : items && items.length > 0 ? "Connect another bank" : "Connect a bank"}
      </Button>

      {webLinkToken ? (
        <WebPlaidLink
          linkToken={webLinkToken}
          onSuccess={(publicToken, metadata) => {
            setWebLinkToken(null)
            if (webLinkMode === "connect") {
              void finishExchange(publicToken, metadata)
            } else {
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
              521 will stop pulling in new transactions from this account. Transactions you've
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

      <AlertDialog open={classifyPrompt != null} onOpenChange={(open) => !open && setClassifyPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Is {classifyPrompt && classifyPrompt.linkedAccounts.length === 1
                ? classifyPrompt.linkedAccounts[0].name
                : classifyPrompt?.institutionName ?? "this account"}{" "}
              personal, business, or a mix?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This helps 521 guess right from your very first transaction instead of starting
              from scratch on every one. You can always fine-tune it later per account, or correct
              any individual transaction when you review it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => void handleClassifyChoice(false)}>Personal</AlertDialogAction>
            <AlertDialogAction onClick={() => void handleClassifyChoice(true)}>Business</AlertDialogAction>
            <AlertDialogAction onClick={() => void handleClassifyChoice(null)}>A mix of both</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
