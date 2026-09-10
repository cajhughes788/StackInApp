import { App, type URLOpenListenerEvent } from "@capacitor/app"
import { Browser } from "@capacitor/browser"

// Resolves when Plaid Link in the native in-app browser is done, one way or
// another: either frontend/app/plaid-link/page.tsx sends back the
// stackin://plaid/link-complete redirect (success or Plaid's own exit flow),
// OR the user manually dismisses the in-app browser itself (e.g. tapping the
// native "Done" button instead of using Plaid's in-flow exit), which fires
// @capacitor/browser's "browserFinished" event but no redirect at all.
// Without racing both, that second path leaves the caller awaiting forever.
export function waitForPlaidLinkExit(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (publicToken: string | null) => {
      if (settled) return
      settled = true
      urlHandle.then((listener) => listener.remove())
      browserHandle.then((listener) => listener.remove())
      resolve(publicToken)
    }

    const urlHandle = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      if (!event.url.startsWith("stackin://plaid/link-complete")) return
      const publicToken = new URL(event.url).searchParams.get("public_token")
      finish(publicToken)
    })

    const browserHandle = Browser.addListener("browserFinished", () => {
      finish(null)
    })
  })
}
