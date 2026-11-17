import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"

// Siri, Shortcuts and the Action Button ("Ask 521", "Log in 521", "Add an
// expense in 521", "Book in 521"): which mic to open
// (ios/App/App/VoiceLaunchPlugin.swift). takePending() after a cold start;
// a "launch" event while the app is running.

export type VoiceLaunchTarget = "ask" | "entry" | "expense" | "booking"

type VoiceLaunchPlugin = {
  takePending(): Promise<{ target: VoiceLaunchTarget | null }>
  addListener(event: "launch", listener: (data: { target: VoiceLaunchTarget }) => void): Promise<PluginListenerHandle>
}

export const VoiceLaunch = registerPlugin<VoiceLaunchPlugin>("VoiceLaunch")

export function isVoiceLaunchAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    Capacitor.isPluginAvailable("VoiceLaunch")
  )
}

export function isVoiceLaunchTarget(value: unknown): value is VoiceLaunchTarget {
  return value === "ask" || value === "entry" || value === "expense" || value === "booking"
}
