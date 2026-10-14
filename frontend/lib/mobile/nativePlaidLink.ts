import { Capacitor, registerPlugin } from "@capacitor/core"

// Bridge to frontend/ios/App/App/NativePlaidLinkPlugin.swift, which runs
// Plaid Link with Plaid's native iOS SDK (LinkKit) — no in-app browser, no
// stackin:// redirect, no /plaid-link page.
export type NativePlaidLinkResult =
  | {
      status: "success"
      publicToken: string
      institutionId: string | null
      accounts: Array<{ name: string; mask: string | null }>
    }
  | { status: "exit"; errorMessage?: string }

interface NativePlaidLinkPlugin {
  preload(options: { token: string }): Promise<void>
  open(options: { token: string }): Promise<NativePlaidLinkResult>
}

const NativePlaidLink = registerPlugin<NativePlaidLinkPlugin>("NativePlaidLink")

// False on web and Android, and in any iOS binary built before this plugin
// existed — callers fall back to the in-app browser flow there.
export function isNativePlaidLinkAvailable(): boolean {
  return Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("NativePlaidLink")
}

// Starts loading Link in the background for this token, so open() shows it
// right away. Best-effort — open() creates the session itself if this
// failed or never ran.
export async function preloadNativePlaidLink(token: string): Promise<void> {
  try {
    await NativePlaidLink.preload({ token })
  } catch {
    // ignore — see above
  }
}

export function openNativePlaidLink(token: string): Promise<NativePlaidLinkResult> {
  return NativePlaidLink.open({ token })
}
