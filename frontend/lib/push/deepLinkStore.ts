import { create } from "zustand"

// Where a notification tap should take the user, held in app state instead
// of being expressed as a URL.
//
// Notification taps used to do window.location.href = "/app/home?mode=…".
// Inside the native app that never worked: Capacitor's local server answers
// any extension-less path with the root index.html (see Router.swift in
// @capacitor/ios), so the tap rebooted the app on the landing page, whose
// redirects (/ → /app → /app/home) dropped the query string — always landing
// on the default Income tab, in whatever workspace was last open.
//
// Now registerPush.ts only records the request here. DeepLinkHandler (mounted
// in the /app layout) switches workspace and navigates client-side once the
// workspace list is loaded; the home page and the review panels react to
// `review` by its nonce, so a tap while the app is already open on the home
// screen still switches tab, re-fetches and expands the list.

export type DeepLinkReviewTab = "income" | "expenses"

export type DeepLinkRequest = {
  // Null for older notifications that predate workspaceId in the payload —
  // those stay in the current workspace.
  workspaceId: string | null
  route: "/app/home" | "/app/banks"
  review: DeepLinkReviewTab | null
}

type DeepLinkState = {
  // Pending navigation; cleared by DeepLinkHandler once performed.
  pending: DeepLinkRequest | null
  // The latest review request, kept after navigation so components that
  // mount later (cold start) still see it. `nonce` changes on every tap.
  review: { tab: DeepLinkReviewTab; workspaceId: string | null; nonce: number } | null
  request: (request: DeepLinkRequest) => void
  clearPending: () => void
}

let nonce = 0

export const useDeepLinkStore = create<DeepLinkState>((set) => ({
  pending: null,
  review: null,
  request: (request) => {
    nonce += 1
    set({
      pending: request,
      review: request.review ? { tab: request.review, workspaceId: request.workspaceId, nonce } : null,
    })
  },
  clearPending: () => set({ pending: null }),
}))

// The nonce of a review request aimed at this tab in the active workspace,
// or null. A request whose workspace the user doesn't belong to has its
// workspaceId cleared by DeepLinkHandler, so it applies to whichever
// workspace is open. Consumers act once per nonce (track the last one).
export function useReviewRequestNonce(tab: DeepLinkReviewTab, activeWorkspaceId: string | null): number | null {
  return useDeepLinkStore((state) => {
    const review = state.review
    if (!review || review.tab !== tab || !activeWorkspaceId) return null
    if (review.workspaceId !== null && review.workspaceId !== activeWorkspaceId) return null
    return review.nonce
  })
}

// Maps a push payload's data to a request; null for anything unrecognized.
// Prefix checks are ordered: "pending-income/" must be tested before
// "pending/" would ever be (they don't overlap today, but keep it explicit).
export function deepLinkRequestFromPushData(data: Record<string, unknown> | undefined): DeepLinkRequest | null {
  const deepLink = typeof data?.deepLink === "string" ? data.deepLink : null
  const workspaceId = typeof data?.workspaceId === "string" && data.workspaceId.length > 0 ? data.workspaceId : null
  if (!deepLink) return null
  if (deepLink.startsWith("stackin://plaid/pending-income/")) {
    return { workspaceId, route: "/app/home", review: "income" }
  }
  if (deepLink.startsWith("stackin://plaid/pending/")) {
    return { workspaceId, route: "/app/home", review: "expenses" }
  }
  if (deepLink.startsWith("stackin://plaid/reconnect")) {
    // Reconnecting a bank happens on the Bank connections page.
    return { workspaceId, route: "/app/banks", review: null }
  }
  return null
}
