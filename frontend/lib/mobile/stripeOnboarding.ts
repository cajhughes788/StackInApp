import { App, type URLOpenListenerEvent } from "@capacitor/app"
import { Browser } from "@capacitor/browser"

// Runs Stripe's hosted Connect sign-up in the in-app browser and resolves
// once the person is back: either app/stripe-return sends the
// stackin://stripe/onboarding-return redirect, or they close the browser
// themselves (no redirect at all) — same race as plaidLinkDeepLink.ts.
// "refresh" means Stripe's link expired and a new one is needed.
export async function runNativeStripeOnboarding(url: string): Promise<"done" | "refresh" | "closed"> {
  const outcome = new Promise<"done" | "refresh" | "closed">((resolve) => {
    let settled = false
    const finish = (result: "done" | "refresh" | "closed") => {
      if (settled) return
      settled = true
      urlHandle.then((listener) => listener.remove())
      browserHandle.then((listener) => listener.remove())
      resolve(result)
    }
    const urlHandle = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      if (!event.url.startsWith("stackin://stripe/onboarding-return")) return
      finish(new URL(event.url).searchParams.get("result") === "refresh" ? "refresh" : "done")
    })
    const browserHandle = Browser.addListener("browserFinished", () => finish("closed"))
  })
  await Browser.open({ url })
  const result = await outcome
  await Browser.close().catch(() => {})
  return result
}
